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
  let sb = null, ME = null, CLINICS = [], PEOPLE = [], INVITES = [], LAB = {}, SELLER = {};
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
  .cloud-badge{font-size:10px;color:var(--green)}`;
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
    const [cl, pp, ord, pr, cm, fl, st, inv] = await Promise.all([
      sb.from('clinics').select('*').order('name'),
      sb.from('profiles').select('*').order('full_name'),
      sb.from('orders').select('*').order('created_at', { ascending: false }),
      canPrice() ? sb.from('order_prices').select('*') : none,
      sb.from('order_comments').select('*').order('created_at'),
      sb.from('order_files').select('*').order('created_at'),
      isStaff() ? sb.from('settings').select('*') : none,
      INVITE_ROLES[role()] ? sb.from('invites').select('*').is('used_at', null).order('created_at', { ascending: false }) : none,
    ]);
    for (const r of [cl, pp, ord, pr, cm, fl, st, inv]) if (r.error) throw r.error;
    CLINICS = cl.data; PEOPLE = pp.data; INVITES = inv.data;
    const me = PEOPLE.find(p => p.id === ME.id); if (me) ME = me;
    const prices = Object.fromEntries(pr.data.map(x => [x.order_id, +x.price]));
    const by = (arr, k) => arr.reduce((m, x) => ((m[x[k]] = m[x[k]] || []).push(x), m), {});
    const cms = by(cm.data, 'order_id'), fls = by(fl.data, 'order_id');
    st.data.forEach(s => { if (s.key === 'lab') LAB = s.value; if (s.key === 'seller') SELLER = s.value; });
    Object.assign(SETTINGS, {
      name: ME.full_name || ME.email, initials: initialsOf(ME.full_name || ME.email), role: ROLE_N[ME.role],
      seller: Object.assign({ name: 'OWN Digital Laboratory' }, SELLER), vat: SELLER.vat || 'none',
      prices: LAB.prices || {}, docNum: LAB.docNum || { nak: 1, sf: 1 }, buyers: LAB.buyers || {},
      techs: techs().map(t => t.full_name),
    });
    ORDERS = ord.data.map(r => toOrder(r, prices[r.id], cms[r.id] || [], fls[r.id] || []));
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
      cr: d.cr || ruDT(r.created_at), price: price ?? 0, units: +d.units || 1,
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_files' }, () => reload()).subscribe();
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
    let nu = document.querySelector('.nav-item[data-view="users"]');
    if (!nu) {
      nu = document.createElement('div'); nu.className = 'nav-item'; nu.dataset.view = 'users'; nu.textContent = '👥 Пользователи';
      nu.onclick = () => showView('users');
      document.querySelector('.nav-item[data-view="settings"]').before(nu);
      const pg = document.createElement('div'); pg.id = 'view-users'; pg.className = $('view-settings').className.replace(/\bopen\b/, '');
      $('view-settings').after(pg);
    }
    nu.style.display = INVITE_ROLES[r] ? '' : 'none';
  }

  window.showView = function (v) {
    if (v === 'analytics' && !canPrice()) v = 'orders';
    if (v === 'users' && !INVITE_ROLES[role()]) v = 'orders';
    const up = $('view-users');
    if (v === 'users') {
      orig.showView('settings'); $('view-settings').classList.remove('open');
      curView = 'users'; up.classList.add('open'); renderUsers(); updateCounts();
      document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === 'users'));
      return;
    }
    if (up) up.classList.remove('open');
    orig.showView(v);
  };
  window.allTechs = () => uniq(techs().map(t => t.full_name).concat(ORDERS.map(o => o.tech)));
  window.renderUserMenu = function () {
    $('pop-user').innerHTML = `<div class="pop-head">${esc(SETTINGS.name)} · ${esc(ROLE_N[role()])}<span class="pop-sub">${esc(ME.email)}</span></div>
      <div class="pop-item ico" onclick="closePops();showView('settings')">⚙️ Профиль и настройки</div>
      ${INVITE_ROLES[role()] ? `<div class="pop-item ico" onclick="closePops();showView('users')">👥 Пользователи</div>` : ''}
      ${canPrice() ? `<div class="pop-item ico" onclick="closePops();showView('analytics')">📊 Аналитика</div>` : ''}
      <div class="pop-item ico" onclick="closePops();showView('deadlines')">⏱ Сроки</div>
      <div class="pop-item ico" onclick="CLOUD_UI.logout()">🚪 Выйти</div>`;
  };
  window.renderAnalytics = function () {
    orig.renderAnalytics();
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
    $('dp-team').innerHTML = h;
  };
  // Кнопки этапов по ролям
  window.renderTL = function (o) {
    orig.renderTL(o);
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
      const svc = v('f-type'), types = { veneers_emax: 'Виниры (е.мах)', crown_zirconia: 'Коронки (цирконий)', crown_emax: 'Коронки (е.мах)', bridge: 'Мостовидный протез', implant_crown: 'Имплант-корона', full_mouth: 'Полная реставрация', temp: 'Временные (ПММА)' };
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
      const data = { patient: v('f-patient'), clinic: clinic.name, doctor: doctor?.full_name || docName || '—', tech: tech?.full_name || '—', type: types[svc] || svc, svc,
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
        await q(sb.from('settings').update({ value: { prices: SETTINGS.prices, docNum: SETTINGS.docNum, buyers: SETTINGS.buyers }, updated_at: new Date().toISOString() }).eq('key', 'lab'));
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
    const priceCard = `<div class="p-card"><div class="p-card-ttl">Прайс-лист (цена за единицу)</div>
      ${SERVICES.map(x => `<div class="set-row"><label style="width:240px">${esc(x.n)}</label><input class="set-input" type="number" min="0" step="100" style="max-width:140px" value="${priceOf(x.k)}" onchange="setPrice('${x.k}',this.value)"> ₽</div>`).join('')}
      <div class="set-note">Цена подставляется в новые заказы. Техники и врачи цены не видят.</div></div>`;
    $('view-settings').innerHTML = `
      <div class="page-ttl">⚙️ Настройки</div><div class="page-sub">Данные хранятся на сервере и общие для всех сотрудников.</div>
      <div class="p-card"><div class="p-card-ttl">Профиль</div>
        <div class="set-row"><label for="set-name">Имя</label><input class="set-input" id="set-name" value="${esc(ME.full_name || '')}"></div>
        <div class="set-row"><label>Почта</label><span>${esc(ME.email)}</span></div>
        <div class="set-row"><label>Роль</label><span class="au-badge">${ROLE_N[role()]}</span>${ME.clinic_id ? '&nbsp;' + esc(clinicName(ME.clinic_id) || '') : ''}</div>
        <div class="set-row"><label></label><button class="set-btn" onclick="saveProfile()">Сохранить</button><button class="set-btn sec" onclick="CLOUD_UI.changePassword()">Сменить пароль</button><button class="set-btn sec" onclick="CLOUD_UI.logout()">Выйти</button></div>
      </div>
      ${role() === 'owner' ? sellerCard() : role() === 'lab_admin' ? priceCard : ''}
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
      const rows = DEMO_ORDERS.map(o => ({ clinic_id: id(o.clinic), stage: o.stage, created_at: toIso(o.cr), data: Object.assign(pickData(o), { demo: true }) }));
      const ins = await q(sb.from('orders').insert(rows).select('id'));
      await q(sb.from('order_prices').upsert(ins.map((r, i) => ({ order_id: r.id, price: DEMO_ORDERS[i].price }))));
      showToast('Демо-заказы добавлены', ins.length + ' шт.'); reload(0);
    } catch (e) { err('Не удалось добавить', e); }
  };

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
