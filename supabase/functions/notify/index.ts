// OWNLAB · отправка уведомлений в Telegram (Supabase Edge Function "notify").
// Секрет TELEGRAM_BOT_TOKEN задаётся в Supabase → Edge Functions → Secrets.
// Проверку JWT для функции нужно выключить: её вызывают Telegram и база данных.
//
// Три режима:
//   POST ?setup=1  (с токеном собственника/админа) — подключить бота: webhook + имя бота в настройки
//   POST от Telegram (заголовок X-Telegram-Bot-Api-Secret-Token) — /start <код> привязывает чат
//   POST без параметров — отправить накопившиеся сообщения из очереди
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const URL_BASE = Deno.env.get('SUPABASE_URL')!;
// Ключ сервиса: старый формат (SUPABASE_SERVICE_ROLE_KEY) или новый (SUPABASE_SECRET_KEYS)
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || (() => {
  try { const j = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'); return j.default ?? Object.values(j)[0] ?? ''; } catch { return ''; }
})();
const sb = createClient(URL_BASE, SERVICE_KEY as string, { auth: { persistSession: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const tg = (method: string, p: unknown) =>
  fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(r => r.json());

async function hookSecret() {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ownlab:' + TOKEN));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

async function setup(req: Request) {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user) return json({ error: 'Нужно войти' }, 401);
  const { data: p } = await sb.from('profiles').select('role, active').eq('id', user.id).single();
  if (!p?.active || !['owner', 'lab_admin'].includes(p.role)) return json({ error: 'Только собственник или администратор лаборатории' }, 403);
  const me = await tg('getMe', {});
  if (!me.ok) return json({ error: 'Telegram не принял токен бота: ' + (me.description ?? '') }, 400);
  const hook = await tg('setWebhook', { url: `${URL_BASE}/functions/v1/notify`, secret_token: await hookSecret(), allowed_updates: ['message'] });
  if (!hook.ok) return json({ error: 'Не удалось подключить webhook: ' + (hook.description ?? '') }, 400);
  await sb.from('settings').upsert({ key: 'bot', value: { username: me.result.username, name: me.result.first_name }, updated_at: new Date().toISOString() });
  return json({ ok: true, username: me.result.username });
}

async function onTelegram(body: any) {
  const msg = body?.message; const chat = msg?.chat?.id; const text: string = msg?.text ?? '';
  if (!chat) return json({ ok: true });
  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1];
    if (!code) { await tg('sendMessage', { chat_id: chat, text: 'Откройте ссылку «Подключить Telegram» в настройках профиля OWNLAB.' }); return json({ ok: true }); }
    const { data: row } = await sb.from('user_telegram').select('user_id').eq('link_code', code).maybeSingle();
    if (!row) { await tg('sendMessage', { chat_id: chat, text: 'Ссылка устарела. Нажмите «Подключить Telegram» в настройках ещё раз.' }); return json({ ok: true }); }
    await sb.from('user_telegram').update({ chat_id: chat, link_code: null, enabled: true, linked_at: new Date().toISOString() }).eq('user_id', row.user_id);
    const { data: p } = await sb.from('profiles').select('full_name').eq('id', row.user_id).single();
    await tg('sendMessage', { chat_id: chat, text: `✅ Готово, ${p?.full_name ?? ''}! Сюда будут приходить уведомления по заказам OWNLAB.\nОтключить: /stop` });
  } else if (text.startsWith('/stop')) {
    await sb.from('user_telegram').update({ enabled: false }).eq('chat_id', chat);
    await tg('sendMessage', { chat_id: chat, text: 'Уведомления выключены. Включить снова можно в настройках профиля OWNLAB.' });
  }
  return json({ ok: true });
}

async function flush() {
  let sent = 0;
  for (let round = 0; round < 5; round++) {
    const { data, error } = await sb.rpc('claim_notifications');
    if (error) return json({ error: error.message }, 500);
    if (!data?.length) break;
    for (const m of data) {
      const r = await tg('sendMessage', { chat_id: m.chat_id, text: m.body, disable_web_page_preview: true });
      if (r.ok) sent++; else await sb.from('notify_queue').update({ error: String(r.description ?? 'error') }).eq('id', m.id);
    }
  }
  return json({ ok: true, sent });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!TOKEN) return json({ error: 'Не задан секрет TELEGRAM_BOT_TOKEN' }, 500);
  const url = new URL(req.url);
  if (url.searchParams.get('setup')) return setup(req);
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (secret !== null) {
    if (secret !== await hookSecret()) return json({ error: 'forbidden' }, 403);
    return onTelegram(await req.json().catch(() => ({})));
  }
  return flush();
});
