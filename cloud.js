// OWNLAB · облачный режим: вход, роли и общие данные через Supabase.
// Подключается, только если в config.js заполнены url и key. Иначе сайт остаётся демо.
(function () {
  const CFG = window.OWNLAB_CONFIG || {};
  if (!CFG.url || !CFG.key) return;
  window.CLOUD = true;

  const ROLE_N = { owner: 'Собственник', lab_admin: 'Администратор лаборатории', tech: 'Техник', clinic_admin: 'Администратор клиники', doctor: 'Врач' };
  const INVITE_ROLES = { owner: ['lab_admin', 'tech', 'clinic_admin', 'doctor'], lab_admin: ['tech', 'clinic_admin', 'doctor'], clinic_admin: ['doctor'] };
  const BUCKET = 'order-files', MAX_CLOUD_FILE = 50 * 1024 * 1024;
  const TOKEN_KEY = 'ownlab_pending_invite';
  const DEMO_ORDERS = ORDERS.slice();
  let sb = null, ME = null, CLINICS = [], PEOPLE = [], INVITES = [], LAB = {}, SELLER = {}, TECH_RATES = {}, BOT = null, MY_TG = null;
  const orig = { renderInfoTab, renderTL, renderAnalytics, showView, renderUserMenu, updateCounts, doAction, openModal };

  const $ = id => document.getElementById(id);
  const role = () => ME?.role;
  const isStaff = () => ['owner', 'lab_admin'].includes(role());
  const isClinic = () => ['clinic_admin', 'doctor'].includes(role());
  const canPrice = () => isStaff() || role() === 'clinic_admin';
  const clinicName = id => CLINICS.find(c => c.id === id)?.name;
  const person = id => PEOPLE.find(p => p.id === id);
  const techs = () => PEOPLE.filter(p => p.role === 'tech' && p.active);
  const doctorsOf = cid => PEOPLE.filter(p => p.role === 'doctor' && p.active && (!cid || p.clinic_id === cid));
  const ruDT = s => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const err = (t, e) => { console.error(e); showToast(t, (e && (e.message || e.error_description)) || String(e || ''), 'error'); };
  const q = async p => { const r = await p; if (r.error) throw r.error; return r.data; };
  window.CLOUD_API = { get sb() { return sb; }, get me() { return ME; } };

  // ── СТИЛИ ЭКРАНА ВХОДА И СТРАНИЦЫ ПОЛЬЗОВАТЕЛЕЙ ──────────────────────────
  const css = document.createElement('style');
  css.textContent = `
  #auth{position:fixed;inset:0;z-index:500;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}
  #auth.hide{display:none}
  .au-card{width:100%;max-width:380px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px}
  .au-logo{margin-bottom:18px}.au-ttl{font-size:17px;font-weight:700;color:var(--t1);margin-bottom:4px}
  .au-sub{font-size:12px;color:var(--t3);margin-bottom:18px;line-height:1.5}
  .au-card .form-group{margin-bottom:12px}.au-card .modal-btn{width:100%;margin-top:6px}
  .au-link{display:block;margin-top:14px;font-size:12px;color:var(--org);cursor:pointer;text-align:center;background:none;border:0;width:100%}
  .au-err{font-size:12px;color:var(--red);min-height:16px;margin-top:8px}
  .au-note{font-size:11px;color:var(--t4);margin-top:16px;line-height:1.5;border-top:1px solid var(--border);padding-top:12px}
  .au-badge{display:inline-block;padding:3px 8px;border-radius:5px;background:var(--org-d);color:var(--org);font-size:11px;font-weight:600}
  .u-table{width:100%;border-collapse:collapse;font-size:12px}
  .u-table th{text-align:left;color:var(--t4);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;border-bottom:1px solid var(--border)}
  .u-table td{padding:8px;border-bottom:1px solid var(--border);color:var(--t2);vertical-align:middle}
  .u-table .set-input{padding:5px 7px;font-size:11px;min-width:0}
  .u-off{opacity:.5}.u-link{font-family:monospace;font-size:10px;color:var(--t3);word-break:break-all}
  .u-scroll{overflow-x:auto}
  .cloud-badge{font-size:10px;color:var(--green)}
  .tl-who{font-size:10px;color:var(--t4);margin:-2px 0 4px}
  .ev-row{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:11px}
  .ev-t{font-family:var(--mono);color:var(--t4);white-space:nowrap;font-size:10px;padding-top:1px}
  .ev-x{color:var(--t2)}.ev-x small{display:block;color:var(--t4);font-size:10px}
  .tg-ok{color:var(--green);font-weight:600}
  .bal-neg{color:var(--red)}.bal-pos{color:var(--green)}
  .bal-panel{background:var(--card2);border-radius:8px;padding:12px;margin:4px 0 10px}`;
  document.head.appendChild(css);

  // ── ЭКРАН ВХОДА ─────────────────────────────────────────────────────────────
  const auth = document.createElement('div');
  auth.id = 'auth';
  document.body.appendChild(auth);
  const field = (id, label, type = 'text', extra = '') =>
    `<div class="form-group"><label class="form-label" for="${id}">${label}</label><input class="form-input" id="${id}" type="${type}" ${extra}></div>`;
  function authScreen(html) {
    auth.classList.remove('hide');
    auth.innerHTML = `<div class="au-card"><div class="au-logo"><span class="logo-own">OWN</span><span class="logo-sub">Digital Laboratory</span></div>${html}<div class="au-err" id="au-err"></div></div>`;
    const first = auth.querySelector('input:not([readonly])'); if (first) first.focus();
    auth.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') auth.querySelector('.modal-btn.primary')?.click(); }));
  }
  const authErr = m => { const e = $('au-err'); if (e) e.textContent = m; };
  const busy = (on) => auth.querySelectorAll('button').forEach(b => b.disabled = on);
  const v = id => ($(id)?.value || '').trim();

  async function showLogin(msg) {
    let owner = true;
    try { owner = await q(sb.rpc('has_owner')); } catch (e) { authScreen(`<div class="au-ttl">Нет связи с сервером</div><div class="au-sub">${esc(e.message || e)}</div><div class="au-note">Проверьте, что в Supabase выполнен файл supabase/schema.sql, а в config.js указаны правильные url и key.</div>`); return; }
    authScreen(`<div class="au-ttl">Вход</div><div class="au-sub">${msg ? esc(msg) : 'Система заказов лаборатории'}</div>
      ${field('au-email', 'Почта', 'email', 'autocomplete="username"')}${field('au-pass', 'Пароль', 'password', 'autocomplete="current-password"')}
      <button class="modal-btn primary" onclick="CLOUD_UI.login()">Войти</button>
      <button class="au-link" onclick="CLOUD_UI.forgot()">Забыли пароль?</button>
      ${owner ? '' : '<button class="au-link" onclick="CLOUD_UI.ownerForm()">Первичная настройка: зарегистрировать собственника</button>'}
      <div class="au-note">Регистрация — по приглашению. Ссылку присылает администратор лаборатории или клиники.</div>`);
  }
  function ownerForm() {
    authScreen(`<div class="au-ttl">Регистрация собственника</div><div class="au-sub">Доступно один раз: первый зарегистрированный становится собственником лаборатории.</div>
      ${field('au-name', 'Имя и фамилия', 'text', 'placeholder="Иван Жегало"')}${field('au-email', 'Почта', 'email', 'autocomplete="username"')}${field('au-pass', 'Пароль (от 8 символов)', 'password', 'autocomplete="new-password"')}
      <button class="modal-btn primary" onclick="CLOUD_UI.registerOwner()">Зарегистрироваться</button>
      <button class="au-link" onclick="CLOUD_UI.showLogin()">← Ко входу</button>`);
  }
  async function inviteForm(token) {
    let inf = null;
    try { inf = await q(sb.rpc('invite_info', { p_token: token })); } catch (e) { }
    if (!inf) { localStorage.removeItem(TOKEN_KEY); return showLogin('Приглашение недействительно, уже использовано или истекло. Попросите новое.'); }
    authScreen(`<div class="au-ttl">Приглашение</div>
      <div class="au-sub"><span class="au-badge">${ROLE_N[inf.role]}</span>${inf.clinic ? ' · ' + esc(inf.clinic) : ''}</div>
      ${field('au-name', 'Имя и фамилия', 'text', `value="${esc(inf.full_name || '')}"`)}${field('au-email', 'Почта', 'email', `value="${esc(inf.email)}" readonly`)}
      ${field('au-pass', 'Придумайте пароль (от 8 символов)', 'password', 'autocomplete="new-password"')}
      <button class="modal-btn primary" onclick="CLOUD_UI.registerInvite('${token}')">Зарегистрироваться</button>
      <div class="au-note">Если у вас уже есть аккаунт с этой почтой, введите его пароль — приглашение добавится к нему.</div>`);
  }
  function resetForm() {
    authScreen(`<div class="au-ttl">Новый пароль</div>${field('au-pass', 'Новый пароль (от 8 символов)', 'password', 'autocomplete="new-password"')}
      <button class="modal-btn primary" onclick="CLOUD_UI.setPassword()">Сохранить</button>`);
  }
  function noAccess() {
    authScreen(`<div class="au-ttl">Нет доступа</div><div class="au-sub">Вы вошли как ${esc(ME?.email || '')}, но у аккаунта нет роли или он отключён. Попросите администратора прислать приглашение.</div>
      <button class="modal-btn" onclick="CLOUD_UI.logout()">Выйти</button>`);
  }

  async function signUpOrIn(email, pass, name) {
    if (pass.length < 8) throw new Error('Пароль должен быть не короче 8 символов');
    const up = await sb.auth.signUp({ email, password: pass, options: { data: { full_name: name }, emailRedirectTo: location.origin + location.pathname } });
    if (up.error && !/registered|exists/i.test(up.error.message)) throw up.error;
    if (up.data?.session) return true;
    const inn = await sb.auth.signInWithPassword({ email, password: pass });
    if (!inn.error) return true;
    if (/confirm/i.test(inn.error.message)) return false;           // нужно подтвердить почту
    if (up.data?.user && !up.error) return false;
    throw new Error(/invalid/i.test(inn.error.message) ? 'Аккаунт с этой почтой уже есть, а пароль не подходит' : inn.error.message);
  }

  window.CLOUD_UI = {
    showLogin, ownerForm,
    async login() {
      busy(true); authErr('');
      const { error } = await sb.auth.signInWithPassword({ email: v('au-email'), password: $('au-pass').value });
      busy(false);
      if (error) return authErr(/invalid/i.test(error.message) ? 'Неверная почта или пароль' : /confirm/i.test(error.message) ? 'Почта не подтверждена — откройте ссылку из письма' : error.message);
      start();
    },
    async forgot() {
      const email = v('au-email'); if (!email) return authErr('Введите почту, затем нажмите «Забыли пароль?»');
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) return authErr(error.message);
      authErr(''); showToast('Письмо отправлено', 'Проверьте почту ' + email);
    },
    async setPassword() {
      const p = $('au-pass').value; if (p.length < 8) return authErr('От 8 символов');
      const { error } = await sb.auth.updateUser({ password: p });
      if (error) return authErr(error.message);
      showToast('Пароль изменён'); start();
    },
    async registerOwner() {
      const name = v('au-name'); if (!name) return authErr('Укажите имя');
      busy(true); authErr('');
      try {
        localStorage.setItem('ownlab_pending_owner', name);
        const ready = await signUpOrIn(v('au-email'), $('au-pass').value, name);
        if (!ready) { busy(false); return showLogin('Мы отправили письмо со ссылкой. Подтвердите почту и войдите.'); }
        await q(sb.rpc('claim_owner', { p_name: name })); localStorage.removeItem('ownlab_pending_owner');
        start();
      } catch (e) { busy(false); authErr(e.message || String(e)); }
    },
    async registerInvite(token) {
      busy(true); authErr('');
      try {
        localStorage.setItem(TOKEN_KEY, token);
        const ready = await signUpOrIn(v('au-email'), $('au-pass').value, v('au-name'));
        if (!ready) { busy(false); return showLogin('Мы отправили письмо со ссылкой. Подтвердите почту и войдите — приглашение применится автоматически.'); }
        await q(sb.rpc('accept_invite', { p_token: token, p_name: v('au-name') }));
        localStorage.removeItem(TOKEN_KEY); history.replaceState(null, '', location.pathname);
        start();
      } catch (e) { busy(false); authErr(e.message || String(e)); }
    },
    async logout() { await sb.auth.signOut(); location.replace(location.pathname); },
  };

  // ── ЗАПУСК ─────────────────────────────────────────────────────────────────
  authScreen('<div class="au-sub">Загрузка…</div>');
  const lib = document.createElement('script');
  lib.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.min.js';
  lib.onload = () => {
    sb = window.supabase.createClient(CFG.url, CFG.key);
    sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') resetForm(); });
    const tok = new URLSearchParams(location.search).get('invite');
    if (tok) localStorage.setItem(TOKEN_KEY, tok);
    if (/type=recovery/.test(location.hash)) return;   // покажем форму нового пароля по событию
    start();
  };
  lib.onerror = () => authScreen('<div class="au-ttl">Не удалось загрузить модуль входа</div><div class="au-sub">Проверьте интернет и обновите страницу.</div>');
  document.head.appendChild(lib);

  let started = false;
  async function start() {
    const { data: { session } } = await sb.auth.getSession();
    const tok = localStorage.getItem(TOKEN_KEY);
    if (!session) return tok ? inviteForm(tok) : showLogin();
    try {
      if (tok) {   // приглашение после подтверждения почты или для существующего аккаунта
        try { await q(sb.rpc('accept_invite', { p_token: tok, p_name: session.user.user_metadata?.full_name || '' })); }
        catch (e) { showToast('Приглашение не применено', e.message, 'warning'); }
        localStorage.removeItem(TOKEN_KEY); history.replaceState(null, '', location.pathname);
      }
      const pendingOwner = localStorage.getItem('ownlab_pending_owner');
      if (pendingOwner) { try { await q(sb.rpc('claim_owner', { p_name: pendingOwner })); } catch (e) { } localStorage.removeItem('ownlab_pending_owner'); }
      ME = (await q(sb.from('profiles').select('*').eq('id', session.user.id))).at(0) || { email: session.user.email };
      if (!ME.role || !ME.active) return noAccess();
      await loadAll();
      applyRoleUI();
      auth.classList.add('hide');
      if (!started) { started = true; subscribe(); }
      selId = null; $('detPanel').classList.remove('open'); showView('orders');
    } catch (e) { err('Ошибка загрузки', e); showLogin(e.message); }
  }

  // ── ЗАГРУЗКА ДАННЫХ ─────────────────────────────────────────────────────────
  async function loadAll() {
    const none = Promise.resolve({ data: [] });
    const [cl, pp, ord, pr, cm, fl, st, inv, tr, evs, tgr] = await Promise.all([
      sb.from('clinics').select('*').order('name'),
      sb.from('profiles').select('*').order('full_name'),
      sb.from('orders').select('*').order('created_at', { ascending: false }),
      canPrice() ? sb.from('order_prices').select('*') : none,
      sb.from('order_comments').select('*').order('created_at'),
      sb.from('order_files').select('*').order('created_at'),
      sb.from('settings').select('*'),
      INVITE_ROLES[role()] ? sb.from('invites').select('*').is('used_at', null).order('created_at', { ascending: false }) : none,
      isStaff() || role() === 'tech' ? sb.from('tech_rates').select('*') : none,
      sb.from('order_events').select('*').order('created_at'),
      sb.from('user_telegram').select('*'),
    ]);
    for (const r of [cl, pp, ord, pr, cm, fl, st, inv, tr, evs, tgr]) if (r.error) throw r.error;
    MY_TG = tgr.data[0] || null;
    TECH_RATES = Object.fromEntries(tr.data.map(x => [x.tech_id, +x.percent]));
    CLINICS = cl.data; PEOPLE = pp.data; INVITES = inv.data;
    const me = PEOPLE.find(p => p.id === ME.id); if (me) ME = me;
    const prices = Object.fromEntries(pr.data.map(x => [x.order_id, +x.price]));
    const by = (arr, k) => arr.reduce((m, x) => ((m[x[k]] = m[x[k]] || []).push(x), m), {});
    const cms = by(cm.data, 'order_id'), fls = by(fl.data, 'order_id'), ev = by(evs.data, 'order_id');
    let catalog = null;
    st.data.forEach(s => { if (s.key === 'lab') LAB = s.value; if (s.key === 'seller') SELLER = s.value; if (s.key === 'catalog') catalog = s.value.items; if (s.key === 'bot') BOT = s.value; });
    if (Array.isArray(catalog) && catalog.length) SERVICES.splice(0, SERVICES.length, ...catalog.map(i => ({ k: i.k, n: i.n, u: i.u || 'шт', p: +(LAB.prices || {})[i.k] || 0 })));
    Object.assign(SETTINGS, {
      name: ME.full_name || ME.email, initials: initialsOf(ME.full_name || ME.email), role: ROLE_N[ME.role],
      seller: Object.assign({ name: 'OWN Digital Laboratory' }, SELLER), vat: SELLER.vat || 'none',
      prices: LAB.prices || {}, docNum: Object.assign({ inv: 1, nak: 1, sf: 1 }, LAB.docNum), buyers: LAB.buyers || {},
      techs: techs().map(t => t.full_name), techPercent: LAB.techPercent ?? 30, techRates: {},
    });
    ORDERS = ord.data.map(r => Object.assign(toOrder(r, prices[r.id], cms[r.id] || [], fls[r.id] || []), { events: ev[r.id] || [] }));
    DICT.clinic = uniq(CLINICS.map(c => c.name));
    DICT.tech = uniq(techs().map(t => t.full_name));
    DICT.doctor = uniq(doctorsOf().map(d => d.full_name).concat(ORDERS.map(o => o.doctor)));
    DICT.patient = uniq(ORDERS.map(o => o.patient));
    applySettings();
  }
  function toOrder(r, price, comments, files) {
    const d = r.data || {}, st = r.stage, techName = person(r.tech_id)?.full_name || d.tech || '—';
    return Object.assign({}, d, {
      id: r.id, num: r.num, clinic_id: r.clinic_id, doctor_id: r.doctor_id, tech_id: r.tech_id,
      clinic: clinicName(r.clinic_id) || d.clinic || '—', doctor: person(r.doctor_id)?.full_name || d.doctor || '—',
      tech: techName, tk: techName.split(' ')[0], stage: st, color: STAGES[st - 1].c, prog: st === 14 ? 100 : Math.max(4, Math.round(st / 14 * 100)),
      cr: d.cr || ruDT(r.created_at), price: price ?? 0, units: +d.units || 1, doneAt: r.done_at ? ruDT(r.done_at) : '',
      comments: comments.map(c => ({ av: initialsOf(c.author_name || '?'), rc: c.author_role === 'tech' ? 'tech' : 'admin', au: c.author_name || '—', role: ROLE_N[c.author_role] || '', t: c.body, time: new Date(c.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })),
      files: files.map(f => ({ n: f.name, size: f.size, path: f.path })),
    });
  }
  let reloadT = null;
  function reload(delay = 300) {
    clearTimeout(reloadT);
    reloadT = setTimeout(async () => {
      try { await loadAll(); } catch (e) { return err('Не удалось обновить данные', e); }
      if (curView === 'orders') { renderOrders(); if (selId && ORDERS.some(o => o.id === selId)) refreshDetail(); else if (selId) closeDetail(); }
      else showView(curView);
    }, delay);
  }
  function refreshDetail() {
    const o = ORDERS.find(x => x.id === selId); if (!o) return;
    const tab = document.querySelector('.tab-pane.active')?.id;
    $('dp-title').textContent = o.patient; $('dp-sub').textContent = o.num + ' · ' + o.clinic;
    $('dp-meta').innerHTML = [o.num, '🦷 ' + o.type, '👤 ' + o.tech, o.urgent ? '⚡ Срочный' : null].filter(Boolean).map(t => `<span class="meta-tag">${esc(t)}</span>`).join('');
    renderInfoTab(o); renderTL(o); renderFiles(o); renderComments(o);
    if (tab) switchTab(tab.replace('tab-', ''), [...document.querySelectorAll('.det-tab')].find(b => (b.getAttribute('onclick') || '').includes("'" + tab.replace('tab-', '') + "'")));
  }
  function subscribe() {
    sb.channel('ownlab').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_comments' }, () => reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_files' }, () => reload())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_events' }, () => reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => { if (curView === 'balance') renderBalance(); }).subscribe();
  }

  // ── ИНТЕРФЕЙС ПО РОЛИ ───────────────────────────────────────────────────────
  function applyRoleUI() {
    const r = role();
    $('avatar').textContent = SETTINGS.initials; $('avatar').title = SETTINGS.name + ' · ' + ROLE_N[r];
    document.querySelector('.env-badge').innerHTML = esc(ROLE_N[r]) + (ME.clinic_id ? ' · ' + esc(clinicName(ME.clinic_id) || '') : '') + ' <span class="cloud-badge">● онлайн</span>';
    document.querySelector('.btn-new').style.display = r === 'tech' ? 'none' : '';
    const techLbl = $('tech-nav').previousElementSibling;
    [$('tech-nav'), techLbl, techLbl.previousElementSibling].forEach(el => el.style.display = isStaff() ? '' : 'none');
    document.querySelector('.nav-item[data-view="analytics"]').style.display = canPrice() ? '' : 'none';
    const np = document.querySelector('.nav-item[data-view="pay"]');
    np.style.display = isStaff() || r === 'tech' ? '' : 'none';
    np.textContent = r === 'tech' ? '💰 Мой заработок' : '💰 Зарплата';
    let nu = document.querySelector('.nav-item[data-view="users"]');
    if (!nu) {
      nu = document.createElement('div'); nu.className = 'nav-item'; nu.dataset.view = 'users'; nu.textContent = '👥 Пользователи';
      nu.onclick = () => showView('users');
      document.querySelector('.nav-item[data-view="settings"]').before(nu);
      const pg = document.createElement('div'); pg.id = 'view-users'; pg.className = $('view-settings').className.replace(/\bopen\b/, '');
      $('view-settings').after(pg);
    }
    nu.style.display = INVITE_ROLES[r] ? '' : 'none';
    let nb = document.querySelector('.nav-item[data-view="balance"]');
    if (!nb) {
      nb = document.createElement('div'); nb.className = 'nav-item'; nb.dataset.view = 'balance'; nb.textContent = '💳 Расчёты';
      nb.onclick = () => showView('balance');
      document.querySelector('.nav-item[data-view="pay"]').after(nb);
      const pg = document.createElement('div'); pg.id = 'view-balance'; pg.className = 'page';
      $('view-settings').after(pg);
    }
    nb.style.display = canPrice() ? '' : 'none';
  }

  window.showView = function (v) {
    if (v === 'analytics' && !canPrice()) v = 'orders';
    if (v === 'pay' && !(isStaff() || role() === 'tech')) v = 'orders';
    if (v === 'users' && !INVITE_ROLES[role()]) v = 'orders';
    if (v === 'balance' && !canPrice()) v = 'orders';
    const extra = { users: renderUsers, balance: renderBalance };
    ['users', 'balance'].forEach(k => $('view-' + k)?.classList.remove('open'));
    if (extra[v]) {
      orig.showView('settings'); $('view-settings').classList.remove('open');
      curView = v; $('view-' + v).classList.add('open'); extra[v](); updateCounts();
      document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === v));
      return;
    }
    orig.showView(v);
  };
  window.allTechs = () => uniq(techs().map(t => t.full_name).concat(ORDERS.map(o => o.tech)));
  window.renderUserMenu = function () {
    $('pop-user').innerHTML = `<div class="pop-head">${esc(SETTINGS.name)} · ${esc(ROLE_N[role()])}<span class="pop-sub">${esc(ME.email)}</span></div>
      <div class="pop-item ico" onclick="closePops();showView('settings')">⚙️ Профиль и настройки</div>
      ${INVITE_ROLES[role()] ? `<div class="pop-item ico" onclick="closePops();showView('users')">👥 Пользователи</div>` : ''}
      ${canPrice() ? `<div class="pop-item ico" onclick="closePops();showView('analytics')">📊 Аналитика</div>` : ''}
      ${canPrice() ? `<div class="pop-item ico" onclick="closePops();showView('balance')">💳 Расчёты</div>` : ''}
      ${isStaff() || role() === 'tech' ? `<div class="pop-item ico" onclick="closePops();showView('pay')">💰 ${role() === 'tech' ? 'Мой заработок' : 'Зарплата'}</div>` : ''}
      <div class="pop-item ico" onclick="closePops();showView('deadlines')">⏱ Сроки</div>
      <div class="pop-item ico" onclick="CLOUD_UI.logout()">🚪 Выйти</div>`;
  };
  // Среднее время на этапах и срок от создания до получения клиникой — по истории
  function stageStats(list) {
    const acc = {}, lead = [];
    list.forEach(o => {
      const ev = (o.events || []).filter(e => e.kind !== 'tech');
      for (let i = 0; i < ev.length - 1; i++) {
        const s = ev[i].to_stage, d = (new Date(ev[i + 1].created_at) - new Date(ev[i].created_at)) / 36e5;
        if (s && d >= 0) (acc[s] = acc[s] || []).push(d);
      }
      const c = ev.find(e => e.kind === 'created'), done = ev.find(e => e.to_stage >= 13 && e.kind === 'stage');
      if (c && done) lead.push((new Date(done.created_at) - new Date(c.created_at)) / 36e5);
    });
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    return { rows: Object.keys(acc).map(Number).sort((a, b) => a - b).map(s => [STAGES[s - 1].n, avg(acc[s]), acc[s].length]), lead: lead.length ? avg(lead) : null, leadN: lead.length };
  }
  const dur = h => h < 1 ? Math.round(h * 60) + ' мин' : h < 48 ? h.toFixed(1).replace('.0', '') + ' ч' : (h / 24).toFixed(1).replace('.0', '') + ' дн.';
  window.renderAnalytics = function () {
    orig.renderAnalytics();
    if (isStaff()) {
      const st = stageStats(reportOrders()), mx = Math.max(1, ...st.rows.map(r => r[1]));
      const card = document.createElement('div'); card.className = 'p-card';
      card.innerHTML = `<div class="p-card-ttl">⏱ Время на этапах (по истории)${st.lead !== null ? ' · от создания до получения клиникой в среднем ' + dur(st.lead) + ' (' + st.leadN + ' зак.)' : ''}</div>`
        + (st.rows.length ? st.rows.map(([l, v, n]) => `<div class="bar-row" title="${n} переходов"><span class="bar-lbl">${esc(l)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(v / mx * 100)}%"></div></div><span class="bar-val">${dur(v)}</span></div>`).join('')
          : '<div class="pop-empty">Данные появятся, когда заказы начнут проходить этапы</div>');
      document.querySelector('#view-analytics .p-grid')?.before(card);
    }
    if (!isStaff()) document.querySelectorAll('#view-analytics [onclick="openDocModal()"]').forEach(b => b.remove());
  };

  // Карточка заказа: цены — только кому положено; назначение техника и врача — лаборатории
  window.renderInfoTab = function (o) {
    orig.renderInfoTab(o);
    if (!canPrice()) $('dp-info-rows').querySelectorAll('.info-row').forEach(r => { if (/Цена|Сумма/.test(r.querySelector('.ik')?.textContent)) r.remove(); });
    const team = [['Техник', o.tech], ['Врач', o.doctor], ['Клиника', o.clinic]];
    let h = team.map(([k, val]) => `<div class="info-row"><span class="ik">${k}</span><span class="iv">${esc(val || '—')}</span></div>`).join('');
    if (isStaff()) {
      const opt = (list, cur) => '<option value="">— не назначен —</option>' + list.map(p => `<option value="${p.id}"${p.id === cur ? ' selected' : ''}>${esc(p.full_name)}</option>`).join('');
      h += `<div class="set-row" style="margin-top:8px"><label style="width:90px">Техник</label><select class="set-input" onchange="CLOUD_UI.assign('${o.id}','tech_id',this.value)">${opt(techs(), o.tech_id)}</select></div>
        <div class="set-row"><label style="width:90px">Врач</label><select class="set-input" onchange="CLOUD_UI.assign('${o.id}','doctor_id',this.value)">${opt(doctorsOf(o.clinic_id), o.doctor_id)}</select></div>
        <div class="set-row"><label style="width:90px">Цена за ед.</label><input class="set-input" type="number" min="0" step="100" value="${o.price || 0}" onchange="CLOUD_UI.setOrderPrice('${o.id}',this.value)"> ₽</div>
        ${role() === 'owner' ? `<div class="set-row"><label style="width:90px"></label><button class="set-btn danger" onclick="CLOUD_UI.deleteOrder('${o.id}')">Удалить заказ</button></div>` : ''}`;
    }
    const evs = (o.events || []).slice().reverse();
    if (evs.length) h += `<div class="p-card-ttl" style="margin:14px 0 6px">История · ${evs.length}</div>` + evs.slice(0, 30).map(e =>
      `<div class="ev-row"><span class="ev-t">${fmtDT(e.created_at)}</span><span class="ev-x">${esc(eventText(e))}<small>${esc(e.actor_name || 'система')}${e.actor_role ? ' · ' + ROLE_N[e.actor_role] : ''}</small></span></div>`).join('');
    $('dp-team').innerHTML = h;
  };
  // Кнопки этапов по ролям
  const fmtDT = t => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  // Когда заказ вошёл в этап n (последний переход) и кто его перевёл
  function stageEntry(o, n) {
    const evs = (o.events || []).filter(e => (e.kind === 'stage' && e.to_stage === n) || (e.kind === 'created' && e.to_stage === n));
    return evs[evs.length - 1];
  }
  function eventText(e) {
    if (e.kind === 'created') return 'Заказ создан' + (e.to_stage > 1 ? ' на этапе ' + e.to_stage : '');
    if (e.kind === 'tech') return e.info === 'снят' ? 'Техник снят с заказа' : 'Назначен техник: ' + e.info;
    return (e.to_stage < e.from_stage ? '↩ Возврат на этап ' : 'Этап ') + e.to_stage + ': ' + STAGES[e.to_stage - 1].n;
  }
  window.renderTL = function (o) {
    orig.renderTL(o);
    $('dp-tl').querySelectorAll('.tl-item').forEach((it, i) => {
      const n = i + 1, e = n <= o.stage ? stageEntry(o, n) : null, ts = it.querySelector('.tl-ts');
      if (!ts) return;
      if (e) { ts.textContent = (n === o.stage ? 'с ' : '') + fmtDT(e.created_at); ts.title = (e.actor_name || 'система') + (e.actor_role ? ' · ' + ROLE_N[e.actor_role] : ''); }
      else if (n < o.stage) { ts.textContent = '—'; ts.title = 'Дата не записана (заказ создан до включения истории)'; }
      if (e?.actor_name) { const w = document.createElement('div'); w.className = 'tl-who'; w.textContent = '👤 ' + e.actor_name; it.querySelector('.tl-row')?.after(w); }
    });
    const r = role(), deny = isClinic() ? /'(next|needsData)'/ : r === 'tech' ? /'(approved|received)'/ : null;
    if (deny) $('dp-tl').querySelectorAll('.tl-btn').forEach(b => { if (deny.test(b.getAttribute('onclick') || '')) b.remove(); });
  };

  window.CLOUD_UI.assign = async function (id, col, val) {
    const o = ORDERS.find(x => x.id === id); const p = person(val);
    const data = Object.assign(pickData(o), col === 'tech_id' ? { tech: p?.full_name || '—' } : { doctor: p?.full_name || '—' });
    try { await q(sb.from('orders').update({ [col]: val || null, data }).eq('id', id)); showToast(col === 'tech_id' ? 'Техник назначен' : 'Врач назначен', p?.full_name || 'не назначен'); reload(0); }
    catch (e) { err('Не удалось сохранить', e); }
  };
  window.CLOUD_UI.setOrderPrice = async function (id, val) {
    try { await q(sb.from('order_prices').upsert({ order_id: id, price: Math.max(0, +val || 0) })); showToast('Цена заказа обновлена', rub(+val)); reload(0); }
    catch (e) { err('Не удалось сохранить цену', e); }
  };
  window.CLOUD_UI.deleteOrder = async function (id) {
    const o = ORDERS.find(x => x.id === id);
    if (!confirm('Удалить заказ ' + o.num + ' безвозвратно? Комментарии и файлы тоже удалятся.')) return;
    try {
      if (o.files.length) await sb.storage.from(BUCKET).remove(o.files.map(f => f.path));
      await q(sb.from('orders').delete().eq('id', id)); closeDetail(); showToast('Заказ удалён', o.num, 'warning'); reload(0);
    } catch (e) { err('Не удалось удалить', e); }
  };

  // ── ЗАПИСЬ ИЗМЕНЕНИЙ ────────────────────────────────────────────────────────
  const DATA_KEYS = ['patient', 'clinic', 'doctor', 'tech', 'type', 'units', 'shade', 'material', 'teeth', 'dl', 'cr', 'svc', 'urgent', 'priority', 'notes', 'trackNum', 'trackSt', 'needsData'];
  const pickData = o => Object.fromEntries(DATA_KEYS.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

  window.doAction = async function (action, id) {
    if (action !== 'next') return orig.doAction(action, id);
    const o = ORDERS.find(x => x.id === id); if (!o || o.stage >= 14) return;
    try {
      const st = (await q(sb.from('orders').update({ stage: o.stage + 1 }).eq('id', id).select('stage'))).at(0)?.stage;
      if (!st) throw new Error('Нет прав менять этап этого заказа');
      stagesToday++; showToast('Этап обновлён', 'Этап ' + st + ': ' + STAGES[st - 1].n); reload(0);
    } catch (e) { err('Этап не изменён', e); }
  };

  window.sendComment = async function () {
    const inp = $('commentInput'), txt = inp.value.trim(); if (!txt || !selId) return;
    inp.disabled = true;
    try { await q(sb.from('order_comments').insert({ order_id: selId, body: txt })); inp.value = ''; showToast('Отправлено', 'Сообщение видно всем участникам заказа'); reload(0); }
    catch (e) { err('Не отправлено', e); }
    inp.disabled = false; inp.focus();
  };

  async function uploadFiles(orderId, list) {
    let n = 0;
    for (const f of list) {
      if (f.size > MAX_CLOUD_FILE) { showToast('Файл слишком большой', f.name + ' — больше 50 МБ (лимит бесплатного тарифа)', 'error'); continue; }
      const safe = f.name.replace(/[^\w.\-]+/g, '_').slice(-80), path = `${orderId}/${crypto.randomUUID()}-${safe}`;
      showToast('Загрузка…', f.name);
      const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream' });
      if (up.error) { err('Файл не загружен: ' + f.name, up.error); continue; }
      const ins = await sb.from('order_files').insert({ order_id: orderId, name: f.name, size: f.size, path });
      if (ins.error) { err('Файл не сохранён: ' + f.name, ins.error); continue; }
      n++;
    }
    return n;
  }
  window.addFilesToOrder = async function (list) {
    if (!selId) return; const files = [...list]; if (!files.length) return;
    const n = await uploadFiles(selId, files);
    if (n) { showToast('Файлы добавлены', n + ' шт.'); reload(0); }
  };
  window.openFile = async function (oid, i) {
    const f = ORDERS.find(x => x.id === oid)?.files?.[i]; if (!f?.path) return;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(f.path, 600, /\.(jpe?g|png|pdf)$/i.test(f.n) ? undefined : { download: f.n });
    if (error) return err('Файл недоступен', error);
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  // Новый заказ: поля по роли
  window.openModal = function () {
    const r = role(), cl = $('f-clinic'), dc = $('f-doctor');
    cl.readOnly = isClinic(); dc.readOnly = r === 'doctor';
    if (isClinic()) cl.value = clinicName(ME.clinic_id) || '';
    if (r === 'doctor') dc.value = ME.full_name;
    $('f-tech').closest('.form-group').style.display = isStaff() ? '' : 'none';
    $('f-price').closest('.form-row').style.display = isStaff() ? '' : 'none';
    orig.openModal();
  };
  window.submitOrder = async function () {
    const req = [['f-patient', 'Пациент'], ['f-clinic', 'Клиника'], ['f-type', 'Тип работы'], ['f-units', 'Количество'], ['f-deadline', 'Срок']];
    for (const [id, l] of req) if (!v(id)) { showToast('Заполните поле', l + ' — обязательное', 'error'); $(id).focus(); return; }
    const btn = document.querySelector('#modalOverlay .modal-btn.primary'); if (btn) btn.disabled = true;
    try {
      const svc = v('f-type');
      let clinic = isClinic() ? CLINICS.find(c => c.id === ME.clinic_id) : CLINICS.find(c => c.name.toLowerCase() === v('f-clinic').toLowerCase());
      if (!clinic) {
        if (!isStaff()) throw new Error('Клиника не найдена');
        if (!confirm('Клиники «' + v('f-clinic') + '» ещё нет. Создать?')) { if (btn) btn.disabled = false; return; }
        clinic = (await q(sb.from('clinics').insert({ name: v('f-clinic') }).select())).at(0); CLINICS.push(clinic);
      }
      const docName = v('f-doctor'), tName = v('f-tech');
      const doctor = role() === 'doctor' ? ME : doctorsOf(clinic.id).find(p => p.full_name.toLowerCase() === docName.toLowerCase());
      const tech = isStaff() ? techs().find(p => p.full_name.toLowerCase() === tName.toLowerCase()) : null;
      if (isStaff() && tName && !tech) showToast('Техник не найден среди пользователей', 'Заказ создан без назначения — пригласите техника на странице «Пользователи»', 'warning');
      const dl = new Date(v('f-deadline')).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const data = { patient: v('f-patient'), clinic: clinic.name, doctor: doctor?.full_name || docName || '—', tech: tech?.full_name || '—', type: svcName(svc), svc,
        units: parseInt(v('f-units')) || 1, shade: v('f-shade') || '—', material: v('f-material') || '—', teeth: v('f-teeth') || '—', dl,
        urgent: v('f-priority') === 'urgent', priority: v('f-priority'), notes: v('f-notes') };
      const row = (await q(sb.from('orders').insert({ clinic_id: clinic.id, doctor_id: doctor?.id || null, tech_id: tech?.id || null, data }).select())).at(0);
      if (isStaff() && v('f-price')) await q(sb.from('order_prices').upsert({ order_id: row.id, price: +v('f-price') || 0 }));
      if (data.notes) await sb.from('order_comments').insert({ order_id: row.id, body: 'ТЗ: ' + data.notes });
      const files = pendingFiles.slice(); pendingFiles = []; renderPending();
      if (files.length) await uploadFiles(row.id, files);
      ['f-patient', 'f-units', 'f-shade', 'f-teeth', 'f-notes', 'f-price', 'f-tech', 'f-deadline'].forEach(id => $(id).value = '');
      if (!isClinic()) $('f-clinic').value = ''; if (role() !== 'doctor') $('f-doctor').value = '';
      closeModal(); showToast('✅ Заказ создан · ' + row.num, clinic.name);
      await loadAll(); renderOrders(); openDetail(row.id);
    } catch (e) { err('Заказ не создан', e); }
    if (btn) btn.disabled = false;
  };

  // Настройки лаборатории пишутся в базу
  let saveT = null;
  window.saveSettings = function () {
    applySettings();
    if (!isStaff()) return;
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      try {
        const now = new Date().toISOString();
        LAB = Object.assign({}, LAB, { prices: SETTINGS.prices, docNum: SETTINGS.docNum, buyers: SETTINGS.buyers, techPercent: SETTINGS.techPercent });
        await q(sb.from('settings').update({ value: LAB, updated_at: now }).eq('key', 'lab'));
        await q(sb.from('settings').update({ value: { items: SERVICES.map(({ k, n, u }) => ({ k, n, u })) }, updated_at: now }).eq('key', 'catalog'));
        if (role() === 'owner') await q(sb.from('settings').update({ value: Object.assign({}, SETTINGS.seller, { vat: SETTINGS.vat }), updated_at: new Date().toISOString() }).eq('key', 'seller'));
      } catch (e) { err('Настройки не сохранены', e); }
    }, 400);
  };
  window.saveProfile = async function () {
    const n = v('set-name'); if (!n) return showToast('Укажите имя', '', 'error');
    try { await q(sb.rpc('update_my_name', { p_name: n })); ME.full_name = n; SETTINGS.name = n; SETTINGS.initials = initialsOf(n); applySettings(); applyRoleUI(); showToast('Профиль сохранён', n); }
    catch (e) { err('Не сохранено', e); }
  };
  window.renderSettings = function () {
    $('view-settings').innerHTML = `
      <div class="page-ttl">⚙️ Настройки</div><div class="page-sub">Данные хранятся на сервере и общие для всех сотрудников.</div>
      <div class="p-card"><div class="p-card-ttl">Профиль</div>
        <div class="set-row"><label for="set-name">Имя</label><input class="set-input" id="set-name" value="${esc(ME.full_name || '')}"></div>
        <div class="set-row"><label>Почта</label><span>${esc(ME.email)}</span></div>
        <div class="set-row"><label>Роль</label><span class="au-badge">${ROLE_N[role()]}</span>${ME.clinic_id ? '&nbsp;' + esc(clinicName(ME.clinic_id) || '') : ''}</div>
        ${role() === 'tech' ? `<div class="set-row"><label>Ставка</label><span>${TECH_RATES[ME.id] ?? SETTINGS.techPercent ?? 0}% от суммы выполненной работы</span></div>` : ''}
        <div class="set-row"><label></label><button class="set-btn" onclick="saveProfile()">Сохранить</button><button class="set-btn sec" onclick="CLOUD_UI.changePassword()">Сменить пароль</button><button class="set-btn sec" onclick="CLOUD_UI.logout()">Выйти</button></div>
      </div>
      ${tgCard()}
      ${role() === 'owner' ? sellerCard() : ''}${isStaff() ? priceCard() + payCard() : ''}
      <div class="p-card"><div class="p-card-ttl">Данные</div>
        <div class="set-row"><button class="set-btn sec" onclick="exportCSV()">⬇️ Экспорт заказов в CSV</button>
        ${role() === 'owner' ? '<button class="set-btn sec" onclick="CLOUD_UI.seedDemo()">Загрузить демо-заказы</button>' : ''}</div>
        <div class="set-note">${role() === 'owner' ? 'Демо-заказы — 42 вымышленных заказа, чтобы проверить отчёты. Удалить их можно в карточке заказа.' : 'В выгрузку попадают только заказы, которые вам доступны.'}</div>
      </div>`;
  };
  window.CLOUD_UI.changePassword = async function () {
    const p = prompt('Новый пароль (от 8 символов):'); if (!p) return;
    if (p.length < 8) return showToast('Слишком короткий пароль', 'Нужно от 8 символов', 'error');
    const { error } = await sb.auth.updateUser({ password: p });
    error ? err('Пароль не изменён', error) : showToast('Пароль изменён');
  };
  window.CLOUD_UI.seedDemo = async function () {
    if (!confirm('Добавить 42 демо-заказа с вымышленными пациентами?')) return;
    try {
      const names = uniq(DEMO_ORDERS.map(o => o.clinic));
      const have = new Set(CLINICS.map(c => c.name));
      const add = names.filter(n => !have.has(n)).map(name => ({ name }));
      if (add.length) await q(sb.from('clinics').insert(add));
      const cl = await q(sb.from('clinics').select('*'));
      const id = n => cl.find(c => c.name === n).id;
      const toIso = s => { const d = parseDl(s); return d ? d.toISOString() : new Date().toISOString(); };
      const tl = techs(), techFor = (o, i) => tl.find(t => t.full_name === o.tech) || tl[i % (tl.length || 1)];
      const rows = DEMO_ORDERS.map((o, i) => ({ clinic_id: id(o.clinic), stage: o.stage, created_at: toIso(o.cr), tech_id: techFor(o, i)?.id || null,
        done_at: o.stage >= 13 ? toIso(o.dl) : null, data: Object.assign(pickData(o), { demo: true }, techFor(o, i) ? { tech: techFor(o, i).full_name } : {}) }));
      const ins = await q(sb.from('orders').insert(rows).select('id'));
      await q(sb.from('order_prices').upsert(ins.map((r, i) => ({ order_id: r.id, price: DEMO_ORDERS[i].price }))));
      showToast('Демо-заказы добавлены', ins.length + ' шт.'); reload(0);
    } catch (e) { err('Не удалось добавить', e); }
  };

  // ── ЗАРПЛАТА ТЕХНИКОВ ───────────────────────────────────────────────────────
  window.techList = () => techs().map(t => ({ id: t.id, name: t.full_name }));
  window.techRate = id => TECH_RATES[id];
  window.setTechRate = async function (id, val) {
    try {
      if (val === '' || val === null) { await q(sb.from('tech_rates').delete().eq('tech_id', id)); delete TECH_RATES[id]; }
      else { const pc = Math.min(100, Math.max(0, +val || 0)); await q(sb.from('tech_rates').upsert({ tech_id: id, percent: pc, updated_at: new Date().toISOString() })); TECH_RATES[id] = pc; }
      showToast('Ставка сохранена', (person(id)?.full_name || '') + ': ' + (TECH_RATES[id] ?? 'по умолчанию') + (id in TECH_RATES ? '%' : ''));
    } catch (e) { err('Ставка не сохранена', e); }
  };
  window.payMode = () => role() === 'tech' ? 'tech' : 'staff';
  window.payRows = async function () {
    const [f, t] = payPeriod();
    const data = await q(sb.rpc('tech_pay', { p_from: f ? f.toISOString() : null, p_to: t ? t.toISOString() : null }));
    return data.map(r => ({ id: r.order_id, num: r.num, patient: r.patient, work: r.work || svcName(r.svc), units: +r.units, done: new Date(r.done_at),
      tech_id: r.tech_id, tech: r.tech_name || '—', amount: r.amount === null ? null : +r.amount, percent: +r.percent, pay: +r.pay }));
  };
  window.recalcPay = async function () {
    const [f, t] = payPeriod();
    if (!confirm('Применить текущие ставки техников ко всем работам, выполненным за выбранный период?')) return;
    try { const n = await q(sb.rpc('recalc_tech_pay', { p_from: f ? f.toISOString() : null, p_to: t ? t.toISOString() : null })); showToast('Пересчитано', n + ' работ'); renderPay(); }
    catch (e) { err('Не пересчитано', e); }
  };

  // ── УВЕДОМЛЕНИЯ В TELEGRAM ──────────────────────────────────────────────────
  function tgCard() {
    const linked = MY_TG?.chat_id;
    let body;
    if (!BOT?.username) {
      body = isStaff()
        ? `<div class="set-note" style="margin-bottom:10px">Бот ещё не подключён. Нужно один раз: создать бота у @BotFather в Telegram, добавить его токен в Supabase (Edge Functions → Secrets → <b>TELEGRAM_BOT_TOKEN</b>) и нажать кнопку ниже.</div>
           <button class="set-btn" onclick="CLOUD_UI.setupBot()">Подключить бота</button>`
        : '<div class="set-note">Лаборатория ещё не подключила Telegram-бота.</div>';
    } else if (linked) {
      body = `<div class="set-row"><span class="tg-ok">✓ Подключено</span><span class="set-note" style="margin:0">бот @${esc(BOT.username)}</span></div>
        <label class="chk"><input type="checkbox"${MY_TG.enabled ? ' checked' : ''} onchange="CLOUD_UI.tgEnable(this.checked)"> Присылать уведомления</label>
        <div class="set-row" style="margin-top:8px"><button class="set-btn sec" onclick="CLOUD_UI.tgUnlink()">Отвязать Telegram</button>${isStaff() ? '<button class="set-btn sec" onclick="CLOUD_UI.setupBot()">Переподключить бота</button>' : ''}</div>`;
    } else {
      body = `<div class="set-row"><button class="set-btn" onclick="CLOUD_UI.tgLink()">Подключить Telegram</button><button class="set-btn sec" onclick="CLOUD_UI.tgRefresh()">Обновить статус</button></div>
        <div class="set-note">Откроется бот @${esc(BOT.username)} — нажмите в нём «Start», затем вернитесь сюда.</div>`;
    }
    const what = { owner: 'новые заказы, согласования, получение работ клиникой, сообщения от клиник', lab_admin: 'новые заказы, согласования, получение работ клиникой, сообщения от клиник', tech: 'назначенные вам заказы, смена этапов, согласование дизайна, сообщения в чате', clinic_admin: 'согласование дизайна, отправка работ, сообщения в чате', doctor: 'согласование дизайна, отправка работы, сообщения в чате' }[role()];
    return `<div class="p-card"><div class="p-card-ttl">🔔 Уведомления в Telegram</div>${body}<div class="set-note">Приходят: ${what}.</div></div>`;
  }
  Object.assign(window.CLOUD_UI, {
    async setupBot() {
      const { data: { session } } = await sb.auth.getSession();
      try {
        const r = await fetch(CFG.url + '/functions/v1/notify?setup=1', { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, apikey: CFG.key } });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || ('Ошибка ' + r.status + (r.status === 404 ? ': функция notify не развёрнута' : '')));
        BOT = { username: j.username }; showToast('Бот подключён', '@' + j.username); renderSettings();
      } catch (e) { err('Бот не подключён', e); }
    },
    async tgLink() {
      try {
        const code = await q(sb.rpc('tg_link_code'));
        window.open('https://t.me/' + BOT.username + '?start=' + code, '_blank', 'noopener');
        showToast('Откройте Telegram', 'Нажмите «Start» у бота, затем «Обновить статус»');
      } catch (e) { err('Не удалось', e); }
    },
    async tgRefresh() { MY_TG = (await q(sb.from('user_telegram').select('*'))).at(0) || null; renderSettings(); showToast(MY_TG?.chat_id ? 'Telegram подключён' : 'Пока не подключено', MY_TG?.chat_id ? '' : 'Нажмите «Start» в боте', MY_TG?.chat_id ? 'success' : 'warning'); },
    async tgEnable(on) { try { await q(sb.rpc('tg_set_enabled', { p_on: on })); MY_TG.enabled = on; showToast(on ? 'Уведомления включены' : 'Уведомления выключены'); } catch (e) { err('Не сохранено', e); } },
    async tgUnlink() { if (!confirm('Отвязать Telegram?')) return; try { await q(sb.rpc('tg_unlink')); MY_TG.chat_id = null; renderSettings(); showToast('Telegram отвязан', '', 'warning'); } catch (e) { err('Не удалось', e); } },
  });

  // ── РАСЧЁТЫ С КЛИНИКАМИ ─────────────────────────────────────────────────────
  const BAL = { preset: 'ytd', from: '', to: '', open: null };
  [BAL.from, BAL.to] = presetRange(BAL.preset);
  let BAL_DATA = [], BAL_DOCS = [], BAL_PAYS = [];
  const KIND_N = { inv: 'Счёт на оплату', nak: 'Накладная', sf: 'Счёт-фактура' };
  window.onDocMade = async function (d) {
    if (!isStaff()) return;
    const c = CLINICS.find(x => x.name === d.clinic); if (!c) return;
    const r = await sb.from('documents').insert({ clinic_id: c.id, kind: d.kind, number: String(d.number), doc_date: d.date, total: d.total, vat: d.vat, order_ids: d.orders, title: d.title, html: d.html });
    if (r.error) err('Документ не сохранён в архив', r.error);
  };
  window.CLOUD_UI.setBal = function (k, v) {
    if (k === 'preset') { BAL.preset = v; if (v !== 'custom') [BAL.from, BAL.to] = presetRange(v); }
    else { BAL[k] = v; BAL.preset = 'custom'; }
    renderBalance();
  };
  async function renderBalance() {
    const el = $('view-balance'); if (!el.innerHTML) el.innerHTML = '<div class="page-sub">Загрузка…</div>';
    try {
      const [b, d, p] = await Promise.all([
        q(sb.rpc('clinic_balances', { p_from: BAL.from || null, p_to: BAL.to || null })),
        q(sb.from('documents').select('id,clinic_id,kind,number,doc_date,total,title').order('doc_date', { ascending: false })),
        q(sb.from('payments').select('*').order('paid_at', { ascending: false })),
      ]);
      BAL_DATA = b; BAL_DOCS = d; BAL_PAYS = p;
    } catch (e) { el.innerHTML = `<div class="page-ttl">💳 Расчёты</div><div class="p-card">Не удалось загрузить: ${esc(e.message || e)}</div>`; return; }
    if (curView !== 'balance') return;
    if (role() === 'clinic_admin') BAL.open = ME.clinic_id;
    const S = k => BAL_DATA.reduce((x, r) => x + +r[k], 0), debt = S('closing');
    const sel = `<select class="set-input" onchange="CLOUD_UI.setBal('preset',this.value)">${Object.entries(PRESETS).map(([v, l]) => `<option value="${v}"${BAL.preset === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const cls = n => n > 0.004 ? 'bal-neg' : n < -0.004 ? 'bal-pos' : '';
    const rows = BAL_DATA.map(r => `<tr class="rep-g" onclick="CLOUD_UI.balOpen('${r.clinic_id}')"><td>${BAL.open === r.clinic_id ? '▾' : '▸'} ${esc(r.name)}</td><td class="n">${rub(+r.opening)}</td><td class="n">${rub(+r.accrued)}</td><td class="n">${rub(+r.paid)}</td><td class="n ${cls(+r.closing)}"><b>${rub(+r.closing)}</b></td><td class="n">${r.last_payment ? ruDT(r.last_payment) : '—'}</td></tr>`
      + (BAL.open === r.clinic_id ? `<tr class="rep-d"><td colspan="6">${clinicPanel(r)}</td></tr>` : '')).join('');
    el.innerHTML = `<div class="page-ttl">💳 Расчёты с клиниками</div>
      <div class="page-sub">Начисление — выполненная работа на дату получения клиникой (этап 13). Сальдо больше нуля — долг клиники перед лабораторией.</div>
      <div class="p-card"><div class="p-card-ttl">Период</div><div class="r-grid">
        <label>Период${sel}</label>
        <label>С даты<input type="date" class="set-input" value="${BAL.from}" onchange="CLOUD_UI.setBal('from',this.value)"></label>
        <label>По дату<input type="date" class="set-input" value="${BAL.to}" onchange="CLOUD_UI.setBal('to',this.value)"></label></div>
        <div class="r-actions"><button class="set-btn sec" onclick="CLOUD_UI.balCSV()">⬇️ Выгрузить в Excel</button></div></div>
      ${isStaff() ? `<div class="kpi-row">
        <div class="kpi"><div class="kn" style="color:var(--org)">${rub(S('accrued'))}</div><div class="kl">Начислено за период</div></div>
        <div class="kpi"><div class="kn" style="color:var(--green)">${rub(S('paid'))}</div><div class="kl">Оплачено за период</div></div>
        <div class="kpi"><div class="kn" style="color:${debt > 0 ? 'var(--red)' : 'var(--green)'}">${rub(debt)}</div><div class="kl">Долг клиник на конец периода</div></div>
        <div class="kpi"><div class="kn">${BAL_DATA.filter(r => +r.closing > 0.004).length}</div><div class="kl">Клиник с долгом</div></div></div>` : ''}
      <div class="p-card"><div style="overflow-x:auto"><table class="rep"><thead><tr><th>Клиника</th><th class="n">Сальдо на начало</th><th class="n">Начислено</th><th class="n">Оплачено</th><th class="n">Сальдо на конец</th><th class="n">Посл. оплата</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="pop-empty">Клиник нет</td></tr>'}</tbody>
        ${BAL_DATA.length > 1 ? `<tfoot><tr><td>Итого</td><td class="n">${rub(S('opening'))}</td><td class="n">${rub(S('accrued'))}</td><td class="n">${rub(S('paid'))}</td><td class="n">${rub(debt)}</td><td></td></tr></tfoot>` : ''}</table></div></div>`;
  }
  function clinicPanel(r) {
    const docs = BAL_DOCS.filter(d => d.clinic_id === r.clinic_id), pays = BAL_PAYS.filter(p => p.clinic_id === r.clinic_id);
    const paidBy = id => pays.filter(p => p.document_id === id).reduce((x, p) => x + +p.amount, 0);
    return `<div class="bal-panel" onclick="event.stopPropagation()">
      <div class="r-actions" style="margin-bottom:10px"><button class="set-btn" onclick="CLOUD_UI.actSverki('${r.clinic_id}')">📄 Акт сверки за период</button></div>
      ${isStaff() ? `<div class="p-card-ttl">Внести оплату</div><div class="set-row">
        <input class="set-input" id="pay-sum" type="number" min="0.01" step="0.01" placeholder="Сумма, ₽" style="flex:0 0 130px;min-width:0">
        <input class="set-input" id="pay-date" type="date" value="${iso(new Date())}" style="flex:0 0 150px;min-width:0">
        <select class="set-input" id="pay-method" style="flex:0 0 150px;min-width:0"><option>безналичный</option><option>наличные</option><option>карта</option></select>
        <select class="set-input" id="pay-doc" style="flex:1 1 180px"><option value="">— без привязки к документу —</option>${docs.filter(d => d.kind !== 'sf').map(d => `<option value="${d.id}">${KIND_N[d.kind]} № ${esc(d.number)} от ${ruDT(d.doc_date)} · ${rub(+d.total)}</option>`).join('')}</select>
        <input class="set-input" id="pay-note" placeholder="Комментарий (п/п №…)" style="flex:1 1 160px">
        <button class="set-btn" onclick="CLOUD_UI.addPayment('${r.clinic_id}')">＋ Добавить</button></div>` : ''}
      <div class="p-card-ttl" style="margin-top:8px">Документы · ${docs.length}</div>
      ${docs.length ? `<table class="rep-in">${docs.map(d => `<tr onclick="CLOUD_UI.openStored('${d.id}')"><td>${ruDT(d.doc_date)}</td><td>${KIND_N[d.kind]} № ${esc(d.number)}</td><td class="n">${rub(+d.total)}</td><td>${d.kind === 'sf' ? '' : (paidBy(d.id) >= +d.total - 0.004 ? '<span class="tg-ok">оплачен</span>' : paidBy(d.id) > 0 ? 'частично · ' + rub(paidBy(d.id)) : '<span class="bal-neg">не оплачен</span>')}</td><td>открыть →</td></tr>`).join('')}</table>`
        : '<div class="set-note">Документы появятся здесь, когда вы сформируете счёт, накладную или счёт-фактуру в «Аналитике».</div>'}
      <div class="p-card-ttl" style="margin-top:12px">Оплаты · ${pays.length}</div>
      ${pays.length ? `<table class="rep-in">${pays.map(p => `<tr><td>${ruDT(p.paid_at)}</td><td class="n"><b>${rub(+p.amount)}</b></td><td>${esc(p.method)}</td><td>${esc(p.note || '')}${p.document_id ? ' · ' + esc((d => d ? KIND_N[d.kind] + ' № ' + d.number : '')(BAL_DOCS.find(d => d.id === p.document_id))) : ''}</td><td>${isStaff() ? `<button class="picked-del" title="Удалить оплату" onclick="CLOUD_UI.delPayment('${p.id}')">✕</button>` : ''}</td></tr>`).join('')}</table>` : '<div class="set-note">Оплат пока нет</div>'}
    </div>`;
  }
  Object.assign(window.CLOUD_UI, {
    balOpen(id) { if (role() === 'clinic_admin') return; BAL.open = BAL.open === id ? null : id; renderBalance(); },
    async addPayment(cid) {
      const amount = +v('pay-sum'); if (!(amount > 0)) return showToast('Укажите сумму', '', 'error');
      try {
        await q(sb.from('payments').insert({ clinic_id: cid, amount, paid_at: v('pay-date') || iso(new Date()), method: v('pay-method'), note: v('pay-note'), document_id: v('pay-doc') || null }));
        showToast('Оплата внесена', rub(amount) + ' · ' + (clinicName(cid) || '')); renderBalance();
      } catch (e) { err('Оплата не внесена', e); }
    },
    async delPayment(id) {
      if (!confirm('Удалить эту оплату?')) return;
      try { await q(sb.from('payments').delete().eq('id', id)); showToast('Оплата удалена', '', 'warning'); renderBalance(); } catch (e) { err('Не удалось', e); }
    },
    async openStored(id) {
      try { const d = (await q(sb.from('documents').select('title,html').eq('id', id))).at(0); if (d) showStoredDoc(d.title, d.html); }
      catch (e) { err('Документ не открылся', e); }
    },
    balCSV() {
      const rows = [['Клиника', 'Сальдо на начало', 'Начислено', 'Оплачено', 'Сальдо на конец', 'Последняя оплата']]
        .concat(BAL_DATA.map(r => [r.name, num2(+r.opening), num2(+r.accrued), num2(+r.paid), num2(+r.closing), r.last_payment ? ruDT(r.last_payment) : '']));
      downloadCSV(rows, 'ownlab-raschety-' + (BAL.from || '') + '_' + (BAL.to || '') + '.csv'); showToast('Выгружено', 'CSV для Excel');
    },
    async actSverki(cid) {
      try {
        const rows = await q(sb.rpc('clinic_ledger', { p_clinic: cid, p_from: BAL.from || null, p_to: BAL.to || null }));
        const b = BAL_DATA.find(x => x.clinic_id === cid), s = SETTINGS.seller, c = clinicName(cid) || '';
        const open = +b.opening, deb = rows.reduce((x, r) => x + +r.debit, 0), cred = rows.reduce((x, r) => x + +r.credit, 0), close = open + deb - cred;
        const per = (BAL.from ? ruDT(BAL.from) : 'начала работы') + ' — ' + (BAL.to ? ruDT(BAL.to) : ruDT(new Date()));
        const side = n => n >= 0 ? [money(n), ''] : ['', money(-n)];
        const title = 'Акт сверки · ' + c + ' · ' + per;
        openDocWindow(title, `<h1>Акт сверки взаимных расчётов</h1>
          <p>за период: ${per}<br>между <b>${esc(s.name || '')}</b> и <b>${esc(c)}</b></p>
          <p class="small">Мы, нижеподписавшиеся, составили настоящий акт сверки в том, что состояние взаимных расчётов по данным учёта следующее:</p>
          <table><tr><th colspan="4">По данным ${esc(s.name || 'лаборатории')}, руб.</th></tr>
            <tr><th style="width:90px">Дата</th><th>Документ</th><th style="width:110px">Дебет</th><th style="width:110px">Кредит</th></tr>
            <tr class="g"><td colspan="2">Сальдо начальное</td><td class="r">${side(open)[0]}</td><td class="r">${side(open)[1]}</td></tr>
            ${rows.map(r => `<tr><td>${ruDT(r.d)}</td><td>${r.kind === 'accrual' ? 'Выполнены работы: ' : ''}${esc(r.ref)}</td><td class="r">${+r.debit ? money(+r.debit) : ''}</td><td class="r">${+r.credit ? money(+r.credit) : ''}</td></tr>`).join('')}
            <tr class="g"><td colspan="2">Обороты за период</td><td class="r">${money(deb)}</td><td class="r">${money(cred)}</td></tr>
            <tr class="g"><td colspan="2">Сальдо конечное</td><td class="r">${side(close)[0]}</td><td class="r">${side(close)[1]}</td></tr></table>
          <p>По данным ${esc(s.name || 'лаборатории')} на ${BAL.to ? ruDT(BAL.to) : ruDT(new Date())} ${Math.abs(close) < 0.005 ? '<b>задолженность отсутствует</b>' : `задолженность в пользу <b>${esc(close > 0 ? (s.name || 'лаборатории') : c)}</b> составляет <b>${money(Math.abs(close))} руб.</b> (${rubWords(Math.abs(close))})`}.</p>
          <div class="sign"><div>От ${esc(s.name || 'лаборатории')}<br><br>Руководитель <span class="ln"></span> / ${esc(s.head || '')} /<br><br>Главный бухгалтер <span class="ln"></span> / ${esc(s.acc || '')} /<br><br>М.П.</div>
          <div>От ${esc(c)}<br><br>Руководитель <span class="ln"></span> / <span class="ln"></span> /<br><br>Главный бухгалтер <span class="ln"></span> / <span class="ln"></span> /<br><br>М.П.</div></div>`);
      } catch (e) { err('Акт не сформирован', e); }
    },
  });

  // ── ПОЛЬЗОВАТЕЛИ И ПРИГЛАШЕНИЯ ──────────────────────────────────────────────
  const inviteLink = t => location.origin + location.pathname + '?invite=' + t;
  function renderUsers() {
    const r = role(), roles = INVITE_ROLES[r] || [];
    const clinicSel = (id, cur, attrs = '') => `<select class="set-input" id="${id}" ${attrs}><option value="">— клиника —</option>${CLINICS.map(c => `<option value="${c.id}"${c.id === cur ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
    const editable = p => p.id !== ME.id && p.role !== 'owner' && (r === 'owner' || (r === 'lab_admin' && p.role !== 'lab_admin') || (r === 'clinic_admin' && p.role === 'doctor' && p.clinic_id === ME.clinic_id));
    const list = PEOPLE.filter(p => r !== 'clinic_admin' || p.clinic_id === ME.clinic_id);
    $('view-users').innerHTML = `
      <div class="page-ttl">👥 Пользователи</div><div class="page-sub">Регистрация — только по приглашениям. Ссылку отправьте сотруднику любым удобным способом.</div>
      <div class="p-card"><div class="p-card-ttl">Пригласить</div>
        <div class="set-row"><label>Почта</label><input class="set-input" id="i-email" type="email" placeholder="name@clinic.ru"></div>
        <div class="set-row"><label>Имя</label><input class="set-input" id="i-name" placeholder="Фамилия И.О."></div>
        <div class="set-row"><label>Роль</label><select class="set-input" id="i-role" onchange="CLOUD_UI.syncInviteClinic()">${roles.map(x => `<option value="${x}">${ROLE_N[x]}</option>`).join('')}</select></div>
        ${r === 'clinic_admin' ? '' : `<div class="set-row" id="i-clinic-row"><label>Клиника</label>${clinicSel('i-clinic', '')}</div>`}
        <div class="set-row"><label></label><button class="set-btn" onclick="CLOUD_UI.invite()">Создать приглашение</button></div>
        <div id="i-result"></div>
        <div class="set-note">Ссылка действует 14 дней и только для указанной почты.</div>
      </div>
      ${INVITES.length ? `<div class="p-card"><div class="p-card-ttl">Ожидают регистрации · ${INVITES.length}</div><div class="u-scroll"><table class="u-table"><tr><th>Почта</th><th>Роль</th><th>Клиника</th><th>Ссылка</th><th></th></tr>
        ${INVITES.map(i => `<tr><td>${esc(i.email)}<br><small>${esc(i.full_name)}</small></td><td>${ROLE_N[i.role]}</td><td>${esc(clinicName(i.clinic_id) || '—')}</td>
          <td><button class="set-btn sec" onclick="CLOUD_UI.copy('${inviteLink(i.token)}')">Копировать</button></td>
          <td><button class="set-btn danger" onclick="CLOUD_UI.revoke('${i.token}')">Отозвать</button></td></tr>`).join('')}</table></div></div>` : ''}
      <div class="p-card"><div class="p-card-ttl">Пользователи · ${list.length}</div><div class="u-scroll"><table class="u-table"><tr><th>Имя</th><th>Роль</th><th>Клиника</th><th>Доступ</th></tr>
        ${list.map(p => editable(p) ? `<tr class="${p.active ? '' : 'u-off'}"><td>${esc(p.full_name)}<br><small>${esc(p.email)}</small></td>
          <td><select class="set-input" id="u-role-${p.id}" onchange="CLOUD_UI.saveUser('${p.id}')">${(r === 'clinic_admin' ? ['doctor'] : INVITE_ROLES[r]).map(x => `<option value="${x}"${x === p.role ? ' selected' : ''}>${ROLE_N[x]}</option>`).join('')}</select></td>
          <td>${r === 'clinic_admin' || !['clinic_admin', 'doctor'].includes(p.role) ? esc(clinicName(p.clinic_id) || '—') : clinicSel('u-clinic-' + p.id, p.clinic_id, `onchange="CLOUD_UI.saveUser('${p.id}')"`)}</td>
          <td><button class="set-btn ${p.active ? 'danger' : 'sec'}" onclick="CLOUD_UI.saveUser('${p.id}',${!p.active})">${p.active ? 'Отключить' : 'Включить'}</button></td></tr>`
          : `<tr class="${p.active ? '' : 'u-off'}"><td>${esc(p.full_name)}${p.id === ME.id ? ' (вы)' : ''}<br><small>${esc(p.email)}</small></td><td>${ROLE_N[p.role]}</td><td>${esc(clinicName(p.clinic_id) || '—')}</td><td>${p.active ? 'активен' : 'отключён'}</td></tr>`).join('')}
      </table></div></div>
      ${isStaff() ? `<div class="p-card"><div class="p-card-ttl">Клиники · ${CLINICS.length}</div>
        ${CLINICS.map(c => `<div class="sb-stat"><span class="sk">${esc(c.name)}</span><span class="sv">${PEOPLE.filter(p => p.clinic_id === c.id).length} польз. · ${ORDERS.filter(o => o.clinic_id === c.id).length} заказов</span></div>`).join('') || '<div class="set-note">Клиник пока нет</div>'}
        <div class="set-row" style="margin-top:10px"><input class="set-input" id="c-name" placeholder="Название новой клиники" onkeydown="if(event.key==='Enter')CLOUD_UI.addClinic()"><button class="set-btn" onclick="CLOUD_UI.addClinic()">＋ Добавить</button></div></div>` : ''}`;
    CLOUD_UI.syncInviteClinic();
  }
  Object.assign(window.CLOUD_UI, {
    syncInviteClinic() { const row = $('i-clinic-row'); if (row) row.style.display = ['clinic_admin', 'doctor'].includes($('i-role')?.value) ? '' : 'none'; },
    async invite() {
      const email = v('i-email'), roleV = v('i-role'), clinic = $('i-clinic')?.value || null;
      if (!/^\S+@\S+\.\S+$/.test(email)) return showToast('Укажите почту', '', 'error');
      try {
        const t = await q(sb.rpc('create_invite', { p_email: email, p_name: v('i-name'), p_role: roleV, p_clinic: clinic }));
        const link = inviteLink(t);
        INVITES = await q(sb.from('invites').select('*').is('used_at', null).order('created_at', { ascending: false }));
        renderUsers();
        $('i-result').innerHTML = `<div class="set-row"><label>Ссылка</label><span class="u-link">${esc(link)}</span></div><div class="set-row"><label></label><button class="set-btn" onclick="CLOUD_UI.copy('${link}')">Копировать ссылку</button></div>`;
        CLOUD_UI.copy(link);
      } catch (e) { err('Приглашение не создано', e); }
    },
    async copy(text) { try { await navigator.clipboard.writeText(text); showToast('Ссылка скопирована', 'Отправьте её сотруднику'); } catch (e) { prompt('Скопируйте ссылку:', text); } },
    async revoke(t) {
      if (!confirm('Отозвать приглашение?')) return;
      try { await q(sb.from('invites').delete().eq('token', t)); INVITES = INVITES.filter(i => i.token !== t); renderUsers(); showToast('Приглашение отозвано', '', 'warning'); }
      catch (e) { err('Не удалось', e); }
    },
    async saveUser(id, active) {
      const p = person(id);
      const roleV = $('u-role-' + id)?.value || p.role, clinic = $('u-clinic-' + id) ? ($('u-clinic-' + id).value || null) : p.clinic_id;
      if (['clinic_admin', 'doctor'].includes(roleV) && !clinic && role() !== 'clinic_admin') {
        const c = prompt('Для этой роли нужна клиника. Введите название точно как в списке:\n' + CLINICS.map(x => x.name).join('\n'));
        const found = CLINICS.find(x => x.name.toLowerCase() === (c || '').trim().toLowerCase());
        if (!found) { showToast('Клиника не выбрана', 'Роль не изменена', 'warning'); return renderUsers(); }
        return CLOUD_UI.saveUserWith(id, roleV, found.id, active ?? p.active);
      }
      try {
        await q(sb.rpc('set_user', { p_id: id, p_role: roleV, p_clinic: clinic, p_active: active ?? p.active }));
        showToast('Пользователь обновлён', p.full_name + ' · ' + ROLE_N[roleV] + ((active ?? p.active) ? '' : ' · отключён'));
        await loadAll(); renderUsers();
      } catch (e) { err('Не сохранено', e); renderUsers(); }
    },
    async saveUserWith(id, roleV, clinic, active) {
      try { await q(sb.rpc('set_user', { p_id: id, p_role: roleV, p_clinic: clinic, p_active: active })); showToast('Пользователь обновлён', person(id).full_name + ' · ' + ROLE_N[roleV]); await loadAll(); renderUsers(); }
      catch (e) { err('Не сохранено', e); renderUsers(); }
    },
    async addClinic() {
      const n = v('c-name'); if (!n) return;
      try { await q(sb.from('clinics').insert({ name: n })); showToast('Клиника добавлена', n); await loadAll(); renderUsers(); }
      catch (e) { err('Не добавлено', e.code === '23505' ? new Error('Такая клиника уже есть') : e); }
    },
  });
})();
