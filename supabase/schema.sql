-- OWNLAB · схема базы для Supabase
-- Запуск: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Повторный запуск безопасен: объекты создаются заново, данные в таблицах сохраняются.

-- ── РОЛИ ─────────────────────────────────────────────────────────────────────
-- owner         собственник: всё, включая реквизиты и удаление
-- lab_admin     администратор лаборатории: все заказы, цены, отчёты, приглашения
-- tech          техник: только назначенные ему заказы, без цен
-- clinic_admin  администратор клиники: заказы, суммы и отчёты своей клиники, приглашает врачей
-- doctor        врач: только свои заказы, без цен


-- ── ТАБЛИЦЫ ──────────────────────────────────────────────────────────────────
create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  inn text default '', kpp text default '', addr text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null check (role in ('owner','lab_admin','tech','clinic_admin','doctor')),
  clinic_id uuid references public.clinics(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint clinic_roles_need_clinic check (role not in ('clinic_admin','doctor') or clinic_id is not null)
);

create sequence if not exists public.order_num_seq start 55;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  num text not null unique default ('#OWN-' || lpad(nextval('public.order_num_seq')::text, 4, '0')),
  clinic_id uuid not null references public.clinics(id),
  doctor_id uuid references public.profiles(id) on delete set null,
  tech_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  stage int not null default 1 check (stage between 1 and 14),
  data jsonb not null default '{}'::jsonb,   -- пациент, тип работы, зубы, оттенок, срок и т.д.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.orders add column if not exists done_at timestamptz;       -- когда работа выполнена (этап 13+)
alter table public.orders add column if not exists tech_percent numeric;      -- ставка техника на момент выполнения
create index if not exists orders_done_idx on public.orders(done_at);
create index if not exists orders_clinic_idx on public.orders(clinic_id);
create index if not exists orders_tech_idx on public.orders(tech_id);
create index if not exists orders_doctor_idx on public.orders(doctor_id);

-- Цены отдельно, чтобы техник и врач не могли прочитать их даже через API
create table if not exists public.order_prices (
  order_id uuid primary key references public.orders(id) on delete cascade,
  price numeric not null default 0
);

create table if not exists public.order_comments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null default auth.uid(),
  author_name text not null default '',
  author_role text not null default '',
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists order_comments_order_idx on public.order_comments(order_id);

create table if not exists public.order_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  name text not null,
  size bigint not null default 0,
  path text not null unique,             -- путь в хранилище: <order_id>/<uuid>-<имя>
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists order_files_order_idx on public.order_files(order_id);

create table if not exists public.invites (
  token uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null default '',
  role text not null check (role in ('lab_admin','tech','clinic_admin','doctor')),
  clinic_id uuid references public.clinics(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_at timestamptz,
  used_by uuid references public.profiles(id) on delete set null
);

-- Ставка оплаты труда техника, % от суммы выполненной работы
create table if not exists public.tech_rates (
  tech_id uuid primary key references public.profiles(id) on delete cascade,
  percent numeric not null check (percent between 0 and 100),
  updated_at timestamptz not null default now()
);

-- key: 'seller' — реквизиты и НДС (меняет только собственник)
--      'lab'    — прайс, нумерация документов, реквизиты покупателей (собственник и админ лаборатории)
create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.settings drop constraint if exists settings_key_check;
alter table public.settings add constraint settings_key_check check (key in ('seller','lab','catalog'));
-- 'catalog' — список услуг без цен (видят все, чтобы выбрать услугу в заказе); цены — в 'lab'
insert into public.settings(key, value) values
  ('catalog', '{"items":[{"k":"veneers_emax","n":"Винир (е.мах / фельспат)","u":"шт"},{"k":"crown_zirconia","n":"Коронка (цирконий)","u":"шт"},{"k":"crown_emax","n":"Коронка (е.мах)","u":"шт"},{"k":"bridge","n":"Мостовидный протез (за ед.)","u":"ед."},{"k":"implant_crown","n":"Имплант-корона","u":"шт"},{"k":"full_mouth","n":"Полная реставрация (за ед.)","u":"ед."},{"k":"temp","n":"Временная конструкция (ПММА)","u":"шт"}]}')
on conflict (key) do nothing;
insert into public.settings(key, value) values
  ('seller', '{"name":"OWN Digital Laboratory","vat":"none"}'),
  ('lab', '{"prices":{"veneers_emax":25000,"crown_zirconia":18000,"crown_emax":20000,"bridge":16000,"implant_crown":30000,"full_mouth":22000,"temp":5000},"docNum":{"nak":1,"sf":1},"buyers":{}}')
on conflict (key) do nothing;

-- ── ФУНКЦИИ-ПОМОЩНИКИ ДЛЯ ПРАВ ───────────────────────────────────────────────
-- security definer, чтобы не было рекурсии в политиках profiles
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;
create or replace function public.my_clinic() returns uuid
language sql stable security definer set search_path = public as $$
  select clinic_id from public.profiles where id = auth.uid() and active
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner','lab_admin'), false)
$$;
create or replace function public.can_see_order(oid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o where o.id = oid and (
      public.is_staff()
      or (public.my_role() = 'tech' and o.tech_id = auth.uid())
      or (public.my_role() = 'clinic_admin' and o.clinic_id = public.my_clinic())
      or (public.my_role() = 'doctor' and o.doctor_id = auth.uid())
    ))
$$;

-- Ставка техника: личная, иначе общая из настроек лаборатории, иначе 0
create or replace function public.tech_percent_for(uid uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when uid is null then null else coalesce(
    (select percent from public.tech_rates where tech_id = uid),
    (select nullif(value->>'techPercent', '')::numeric from public.settings where key = 'lab'),
    0) end
$$;

-- ── ТРИГГЕРЫ ─────────────────────────────────────────────────────────────────
-- Не-сотрудники лаборатории не могут перепривязать заказ к другой клинике, врачу или технику
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if not public.is_staff() then
      new.clinic_id := old.clinic_id;
      new.tech_id := old.tech_id;
      new.doctor_id := old.doctor_id;
    end if;
    new.num := old.num;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  else
    if not public.is_staff() then
      new.tech_id := null;                       -- техника назначает лаборатория
      new.clinic_id := public.my_clinic();       -- клиника всегда своя
      if public.my_role() = 'doctor' then new.doctor_id := auth.uid(); end if;
    end if;
    new.created_by := auth.uid();
  end if;
  -- Дата выполнения и ставка техника фиксируются, когда заказ доходит до этапа «Получена клиникой»
  if new.stage >= 13 then
    if tg_op = 'INSERT' or old.stage < 13 then
      new.done_at := case when tg_op = 'INSERT' and public.is_staff() and new.done_at is not null then new.done_at else now() end;
      new.tech_percent := public.tech_percent_for(new.tech_id);
    else
      new.done_at := old.done_at;
      if new.tech_id is distinct from old.tech_id then new.tech_percent := public.tech_percent_for(new.tech_id);
      elsif not public.is_staff() then new.tech_percent := old.tech_percent; end if;
    end if;
  else
    new.done_at := null; new.tech_percent := null;
  end if;
  if new.tech_id is not null and not exists (select 1 from public.profiles where id = new.tech_id and role = 'tech') then
    raise exception 'Назначить можно только техника';
  end if;
  if new.doctor_id is not null and not exists (select 1 from public.profiles where id = new.doctor_id and role = 'doctor' and clinic_id = new.clinic_id) then
    raise exception 'Врач должен быть из клиники заказа';
  end if;
  return new;
end $$;
drop trigger if exists orders_guard on public.orders;
create trigger orders_guard before insert or update on public.orders
  for each row execute function public.orders_guard();

-- Имя и роль автора комментария берутся из профиля, подделать их нельзя
create or replace function public.comments_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select id, full_name, role into new.author_id, new.author_name, new.author_role from public.profiles where id = auth.uid();
  new.created_at := now();
  return new;
end $$;
drop trigger if exists comments_author on public.order_comments;
create trigger comments_author before insert on public.order_comments
  for each row execute function public.comments_author();

-- Цена из прайса подставляется сервером при создании заказа
create or replace function public.orders_default_price() returns trigger
language plpgsql security definer set search_path = public as $$
declare p numeric;
begin
  select coalesce((value->'prices'->>(new.data->>'svc'))::numeric, 0) into p from public.settings where key = 'lab';
  insert into public.order_prices(order_id, price) values (new.id, coalesce(p, 0)) on conflict do nothing;
  return new;
end $$;
drop trigger if exists orders_default_price on public.orders;
create trigger orders_default_price after insert on public.orders
  for each row execute function public.orders_default_price();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.clinics enable row level security;
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_prices enable row level security;
alter table public.order_comments enable row level security;
alter table public.order_files enable row level security;
alter table public.invites enable row level security;
alter table public.settings enable row level security;
alter table public.tech_rates enable row level security;

-- clinics
drop policy if exists clinics_select on public.clinics;
create policy clinics_select on public.clinics for select to authenticated
  using (public.is_staff() or public.my_role() = 'tech' or id = public.my_clinic());
drop policy if exists clinics_insert on public.clinics;
create policy clinics_insert on public.clinics for insert to authenticated with check (public.is_staff());
drop policy if exists clinics_update on public.clinics;
create policy clinics_update on public.clinics for update to authenticated
  using (public.is_staff() or (public.my_role() = 'clinic_admin' and id = public.my_clinic()))
  with check (public.is_staff() or (public.my_role() = 'clinic_admin' and id = public.my_clinic()));
drop policy if exists clinics_delete on public.clinics;
create policy clinics_delete on public.clinics for delete to authenticated using (public.my_role() = 'owner');

-- profiles: читать — себя; лаборатория — всех; клиника — своих; все — техников (имя в карточке)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff()
         or (public.my_role() is not null and role = 'tech')
         or (public.my_clinic() is not null and clinic_id = public.my_clinic()));
-- изменения профилей — только через функции ниже

-- orders
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using (public.is_staff()
         or (public.my_role() = 'tech' and tech_id = auth.uid())
         or (public.my_role() = 'clinic_admin' and clinic_id = public.my_clinic())
         or (public.my_role() = 'doctor' and doctor_id = auth.uid()));
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert to authenticated
  with check (public.is_staff()
              or (public.my_role() in ('clinic_admin','doctor') and clinic_id = public.my_clinic()));
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders for update to authenticated
  using (public.is_staff()
         or (public.my_role() = 'tech' and tech_id = auth.uid())
         or (public.my_role() = 'clinic_admin' and clinic_id = public.my_clinic())
         or (public.my_role() = 'doctor' and doctor_id = auth.uid()))
  with check (true);
drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders for delete to authenticated using (public.my_role() = 'owner');

-- order_prices
drop policy if exists prices_select on public.order_prices;
create policy prices_select on public.order_prices for select to authenticated
  using (public.is_staff() or (public.my_role() = 'clinic_admin'
         and exists (select 1 from public.orders o where o.id = order_id and o.clinic_id = public.my_clinic())));
drop policy if exists prices_write on public.order_prices;
create policy prices_write on public.order_prices for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- comments и files: видит и пишет тот, кто видит заказ
drop policy if exists comments_select on public.order_comments;
create policy comments_select on public.order_comments for select to authenticated using (public.can_see_order(order_id));
drop policy if exists comments_insert on public.order_comments;
create policy comments_insert on public.order_comments for insert to authenticated
  with check (public.can_see_order(order_id) and author_id = auth.uid());
drop policy if exists comments_delete on public.order_comments;
create policy comments_delete on public.order_comments for delete to authenticated
  using (author_id = auth.uid() or public.my_role() = 'owner');

drop policy if exists files_select on public.order_files;
create policy files_select on public.order_files for select to authenticated using (public.can_see_order(order_id));
drop policy if exists files_insert on public.order_files;
create policy files_insert on public.order_files for insert to authenticated
  with check (public.can_see_order(order_id) and uploaded_by = auth.uid());
drop policy if exists files_delete on public.order_files;
create policy files_delete on public.order_files for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_staff());

-- invites: видят создатель и лаборатория; создаются и принимаются функциями
drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites for select to authenticated
  using (public.is_staff() or created_by = auth.uid());
drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites for delete to authenticated
  using ((public.is_staff() or created_by = auth.uid()) and used_at is null);

-- settings
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated
  using (public.is_staff() or (key = 'catalog' and public.my_role() is not null));
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for update to authenticated
  using (case key when 'seller' then public.my_role() = 'owner' else public.is_staff() end)
  with check (case key when 'seller' then public.my_role() = 'owner' else public.is_staff() end);

-- tech_rates: техник видит свою ставку, лаборатория — все и меняет их
drop policy if exists tech_rates_select on public.tech_rates;
create policy tech_rates_select on public.tech_rates for select to authenticated
  using (public.is_staff() or tech_id = auth.uid());
drop policy if exists tech_rates_write on public.tech_rates;
create policy tech_rates_write on public.tech_rates for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ── ФУНКЦИИ (RPC) ────────────────────────────────────────────────────────────
-- Первый зарегистрированный становится собственником (только пока собственника нет)
create or replace function public.claim_owner(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Нужно войти'; end if;
  perform pg_advisory_xact_lock(4242);
  if exists (select 1 from public.profiles where role = 'owner') then
    raise exception 'Собственник уже назначен';
  end if;
  insert into public.profiles(id, email, full_name, role)
  select auth.uid(), u.email, coalesce(nullif(trim(p_name), ''), u.email), 'owner' from auth.users u where u.id = auth.uid()
  on conflict (id) do update set role = 'owner', active = true, clinic_id = null;
end $$;

create or replace function public.has_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where role = 'owner')
$$;

-- Создать приглашение. Кто кого может пригласить:
--   owner → lab_admin, tech, clinic_admin, doctor
--   lab_admin → tech, clinic_admin, doctor
--   clinic_admin → doctor (только в свою клинику)
create or replace function public.create_invite(p_email text, p_name text, p_role text, p_clinic uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(); c uuid := p_clinic; t uuid;
begin
  if r is null then raise exception 'Нет доступа'; end if;
  if p_email is null or position('@' in p_email) = 0 then raise exception 'Укажите почту'; end if;
  if r = 'owner' and p_role not in ('lab_admin','tech','clinic_admin','doctor') then raise exception 'Недопустимая роль'; end if;
  if r = 'lab_admin' and p_role not in ('tech','clinic_admin','doctor') then raise exception 'Админ лаборатории не может приглашать с этой ролью'; end if;
  if r = 'clinic_admin' then
    if p_role <> 'doctor' then raise exception 'Админ клиники может приглашать только врачей'; end if;
    c := public.my_clinic();
  end if;
  if r in ('tech','doctor') then raise exception 'Нет прав на приглашения'; end if;
  if p_role in ('clinic_admin','doctor') and c is null then raise exception 'Выберите клинику'; end if;
  if p_role in ('lab_admin','tech') then c := null; end if;
  insert into public.invites(email, full_name, role, clinic_id)
    values (lower(trim(p_email)), coalesce(trim(p_name), ''), p_role, c) returning token into t;
  return t;
end $$;

-- Данные приглашения для страницы регистрации (доступно без входа)
create or replace function public.invite_info(p_token uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('email', i.email, 'full_name', i.full_name, 'role', i.role, 'clinic', c.name)
  from public.invites i left join public.clinics c on c.id = i.clinic_id
  where i.token = p_token and i.used_at is null and i.expires_at > now()
$$;

-- Принять приглашение после регистрации или входа
create or replace function public.accept_invite(p_token uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.invites; em text;
begin
  if auth.uid() is null then raise exception 'Нужно войти'; end if;
  select * into i from public.invites where token = p_token for update;
  if i.token is null or i.used_at is not null or i.expires_at <= now() then
    raise exception 'Приглашение недействительно или уже использовано';
  end if;
  select lower(email) into em from auth.users where id = auth.uid();
  if em <> lower(i.email) then raise exception 'Приглашение выписано на другую почту: %', i.email; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and role = 'owner') then
    raise exception 'Собственник не может сменить роль по приглашению';
  end if;
  insert into public.profiles(id, email, full_name, role, clinic_id)
    values (auth.uid(), em, coalesce(nullif(trim(p_name), ''), nullif(i.full_name, ''), em), i.role, i.clinic_id)
  on conflict (id) do update set role = excluded.role, clinic_id = excluded.clinic_id,
    full_name = excluded.full_name, active = true;
  update public.invites set used_at = now(), used_by = auth.uid() where token = p_token;
end $$;

create or replace function public.update_my_name(p_name text) returns void
language sql security definer set search_path = public as $$
  update public.profiles set full_name = trim(p_name) where id = auth.uid() and length(trim(p_name)) > 0
$$;

-- Изменить пользователя (роль, клинику, активность)
create or replace function public.set_user(p_id uuid, p_role text, p_clinic uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(); target public.profiles;
begin
  select * into target from public.profiles where id = p_id;
  if target.id is null then raise exception 'Пользователь не найден'; end if;
  if p_id = auth.uid() then raise exception 'Свою роль менять нельзя'; end if;
  if target.role = 'owner' then raise exception 'Собственника изменить нельзя'; end if;
  if r = 'owner' then
    if p_role not in ('lab_admin','tech','clinic_admin','doctor') then raise exception 'Недопустимая роль'; end if;
  elsif r = 'lab_admin' then
    if target.role = 'lab_admin' or p_role not in ('tech','clinic_admin','doctor') then raise exception 'Недостаточно прав'; end if;
  elsif r = 'clinic_admin' then
    if target.role <> 'doctor' or target.clinic_id <> public.my_clinic() or p_role <> 'doctor' then raise exception 'Недостаточно прав'; end if;
    p_clinic := public.my_clinic();
  else
    raise exception 'Недостаточно прав';
  end if;
  if p_role in ('lab_admin','tech') then p_clinic := null; end if;
  if p_role in ('clinic_admin','doctor') and p_clinic is null then raise exception 'Выберите клинику'; end if;
  update public.profiles set role = p_role, clinic_id = p_clinic, active = coalesce(p_active, true) where id = p_id;
end $$;

-- Следующий номер документа (атомарно, чтобы два бухгалтера не получили один номер)
create or replace function public.next_doc_num(p_kind text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() then raise exception 'Нет доступа'; end if;
  if p_kind not in ('nak','sf') then raise exception 'Неизвестный документ'; end if;
  update public.settings
     set value = jsonb_set(value, array['docNum', p_kind], to_jsonb(coalesce((value->'docNum'->>p_kind)::int, 1) + 1))
   where key = 'lab'
  returning (value->'docNum'->>p_kind)::int - 1 into n;
  return n;
end $$;

-- Выполненные работы и заработок техников за период.
-- Лаборатория видит всех и суммы; техник — только свои работы и свой заработок (без цены заказа).
create or replace function public.tech_pay(p_from timestamptz, p_to timestamptz)
returns table(order_id uuid, num text, patient text, svc text, work text, units numeric, done_at timestamptz,
              tech_id uuid, tech_name text, amount numeric, percent numeric, pay numeric)
language sql stable security definer set search_path = public as $$
  select o.id, o.num, o.data->>'patient', o.data->>'svc', o.data->>'type',
         coalesce(nullif(o.data->>'units', '')::numeric, 1), o.done_at, o.tech_id, p.full_name,
         case when public.is_staff() then coalesce(pr.price, 0) * coalesce(nullif(o.data->>'units', '')::numeric, 1) end,
         coalesce(o.tech_percent, 0),
         round(coalesce(pr.price, 0) * coalesce(nullif(o.data->>'units', '')::numeric, 1) * coalesce(o.tech_percent, 0) / 100, 2)
  from public.orders o
  left join public.order_prices pr on pr.order_id = o.id
  left join public.profiles p on p.id = o.tech_id
  where o.done_at is not null and o.tech_id is not null
    and (p_from is null or o.done_at >= p_from) and (p_to is null or o.done_at < p_to)
    and (public.is_staff() or (public.my_role() = 'tech' and o.tech_id = auth.uid()))
  order by o.done_at desc
$$;

-- Применить текущие ставки к работам, выполненным за период
create or replace function public.recalc_tech_pay(p_from timestamptz, p_to timestamptz) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() then raise exception 'Нет доступа'; end if;
  update public.orders set tech_percent = public.tech_percent_for(tech_id)
   where done_at is not null and tech_id is not null
     and (p_from is null or done_at >= p_from) and (p_to is null or done_at < p_to);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.claim_owner(text), public.create_invite(text,text,text,uuid), public.accept_invite(uuid,text),
  public.update_my_name(text), public.set_user(uuid,text,uuid,boolean), public.next_doc_num(text),
  public.tech_pay(timestamptz,timestamptz), public.recalc_tech_pay(timestamptz,timestamptz) from public, anon;
grant execute on function public.claim_owner(text), public.create_invite(text,text,text,uuid), public.accept_invite(uuid,text),
  public.update_my_name(text), public.set_user(uuid,text,uuid,boolean), public.next_doc_num(text),
  public.tech_pay(timestamptz,timestamptz), public.recalc_tech_pay(timestamptz,timestamptz) to authenticated;
grant execute on function public.invite_info(uuid), public.has_owner() to anon, authenticated;

-- Доступ к таблицам через API (строки всё равно фильтруются RLS)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.clinics, public.profiles, public.orders, public.order_prices,
  public.order_comments, public.order_files, public.invites, public.settings, public.tech_rates to authenticated;
grant usage, select on sequence public.order_num_seq to authenticated;

-- ── ХРАНИЛИЩЕ ФАЙЛОВ ─────────────────────────────────────────────────────────
-- Приватный бакет; путь файла начинается с id заказа
insert into storage.buckets (id, name, public, file_size_limit)
values ('order-files', 'order-files', false, 52428800)   -- 50 МБ: лимит бесплатного тарифа
on conflict (id) do nothing;

drop policy if exists order_files_read on storage.objects;
create policy order_files_read on storage.objects for select to authenticated
  using (bucket_id = 'order-files' and public.can_see_order(((storage.foldername(name))[1])::uuid));
drop policy if exists order_files_write on storage.objects;
create policy order_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'order-files' and public.can_see_order(((storage.foldername(name))[1])::uuid));
drop policy if exists order_files_remove on storage.objects;
create policy order_files_remove on storage.objects for delete to authenticated
  using (bucket_id = 'order-files' and public.is_staff());

-- ── ОБНОВЛЕНИЯ В РЕАЛЬНОМ ВРЕМЕНИ ────────────────────────────────────────────
do $$ begin
  begin alter publication supabase_realtime add table public.orders; exception when others then null; end;
  begin alter publication supabase_realtime add table public.order_comments; exception when others then null; end;
  begin alter publication supabase_realtime add table public.order_files; exception when others then null; end;
end $$;

-- ── ДОЗАПОЛНЕНИЕ ДЛЯ УЖЕ СОЗДАННЫХ ЗАКАЗОВ ──────────────────────────────────
alter table public.orders disable trigger orders_guard;
update public.orders set done_at = coalesce(done_at, updated_at), tech_percent = coalesce(tech_percent, public.tech_percent_for(tech_id))
 where stage >= 13 and done_at is null;
alter table public.orders enable trigger orders_guard;
