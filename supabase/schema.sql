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
alter table public.orders add column if not exists cancelled_at timestamptz;  -- заказ отменён
alter table public.orders add column if not exists cancel_reason text not null default '';
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

-- Договорные цены и скидка клиники (видит и меняет только лаборатория)
create table if not exists public.clinic_pricing (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  discount numeric not null default 0 check (discount between 0 and 100),
  prices jsonb not null default '{}'::jsonb,      -- {"код услуги": цена}
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
alter table public.settings add constraint settings_key_check check (key in ('seller','lab','catalog','bot'));
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
-- Если собственник включил обязательную 2FA, роль собственника/админа действует только после входа с кодом (aal2)
create table if not exists public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;
create or replace function public.mfa_required() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'on' from public.app_config where key = 'require_mfa_staff'), false)
$$;
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select case when p.role in ('owner','lab_admin') and public.mfa_required()
                   and coalesce(auth.jwt()->>'aal', '') <> 'aal2' then null else p.role end
  from public.profiles p where p.id = auth.uid() and p.active
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
    -- Техник и клиника не меняют поля заказа после того, как лаборатория его приняла
    if not public.is_staff() and (public.my_role() = 'tech' or old.stage > 2)
       and coalesce(current_setting('ownlab.trusted', true), '') <> 'on' then
      if new.data is distinct from old.data then
        raise exception 'Изменить заказ после принятия лабораторией может только лаборатория — напишите в чат заказа';
      end if;
      if new.cancelled_at is distinct from old.cancelled_at then
        raise exception 'Отменить заказ после принятия может только лаборатория';
      end if;
    end if;
    if old.cancelled_at is not null and new.cancelled_at is not null and new.stage <> old.stage then
      raise exception 'Заказ отменён — сначала верните его в работу';
    end if;
    if new.cancelled_at is null then new.cancel_reason := ''; end if;
    new.num := old.num;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  else
    if not public.is_staff() then
      new.tech_id := null;                       -- техника назначает лаборатория
      new.clinic_id := public.my_clinic();       -- клиника всегда своя
      if public.my_role() = 'doctor' then new.doctor_id := auth.uid(); end if;
      new.cancelled_at := null; new.cancel_reason := '';
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
declare p numeric; cp public.clinic_pricing;
begin
  select coalesce((value->'prices'->>(new.data->>'svc'))::numeric, 0) into p from public.settings where key = 'lab';
  select * into cp from public.clinic_pricing where clinic_id = new.clinic_id;
  if cp.clinic_id is not null then
    p := coalesce(nullif(cp.prices->>(new.data->>'svc'), '')::numeric, round(coalesce(p, 0) * (1 - cp.discount / 100), 2));
  end if;
  if new.data ? 'remakeOf' and coalesce(new.data->>'remakeBy', 'lab') = 'lab' then p := 0; end if;
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
alter table public.clinic_pricing enable row level security;
drop policy if exists clinic_pricing_all on public.clinic_pricing;
create policy clinic_pricing_all on public.clinic_pricing for all to authenticated using (public.is_staff()) with check (public.is_staff());

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
  using (public.is_staff() or (key in ('catalog','bot') and public.my_role() is not null));
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
  where o.done_at is not null and o.tech_id is not null and o.cancelled_at is null
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
  public.order_comments, public.order_files, public.invites, public.settings, public.tech_rates, public.clinic_pricing to authenticated;
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

-- ══ 1. ИСТОРИЯ ЭТАПОВ ═══════════════════════════════════════════════════════
create table if not exists public.order_events (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null,
  from_stage int, to_stage int, info text not null default '',
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null default '', actor_role text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events(order_id, created_at);
alter table public.order_events drop constraint if exists order_events_kind_check;
alter table public.order_events add constraint order_events_kind_check check (kind in ('created','stage','tech','edit','cancel','restore','remake','return'));
alter table public.order_events enable row level security;
drop policy if exists events_select on public.order_events;
create policy events_select on public.order_events for select to authenticated using (public.can_see_order(order_id));
grant select on public.order_events to authenticated;

-- Каждое создание, смена этапа и назначение техника записывается автоматически
create or replace function public.orders_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.profiles; t text; orig uuid;
begin
  select * into a from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    insert into public.order_events(order_id, kind, to_stage, actor_id, actor_name, actor_role, created_at)
    values (new.id, 'created', new.stage, a.id, coalesce(a.full_name, ''), coalesce(a.role, ''), new.created_at);
    if new.data ? 'remakeOf' then
      begin orig := (new.data->>'remakeOf')::uuid; exception when others then orig := null; end;
      if orig is not null and exists (select 1 from public.orders where id = orig) then
        insert into public.order_events(order_id, kind, info, actor_id, actor_name, actor_role)
        values (orig, 'remake', new.num || coalesce(' · ' || nullif(new.data->>'remakeReason', ''), ''), a.id, coalesce(a.full_name, ''), coalesce(a.role, ''));
      end if;
    end if;
    if new.tech_id is not null then
      select full_name into t from public.profiles where id = new.tech_id;
      insert into public.order_events(order_id, kind, info, actor_id, actor_name, actor_role)
      values (new.id, 'tech', coalesce(t, ''), a.id, coalesce(a.full_name, ''), coalesce(a.role, ''));
    end if;
  else
    if new.stage <> old.stage then
      insert into public.order_events(order_id, kind, from_stage, to_stage, actor_id, actor_name, actor_role)
      values (new.id, 'stage', old.stage, new.stage, a.id, coalesce(a.full_name, ''), coalesce(a.role, ''));
    end if;
    if new.tech_id is distinct from old.tech_id then
      select full_name into t from public.profiles where id = new.tech_id;
      insert into public.order_events(order_id, kind, info, actor_id, actor_name, actor_role)
      values (new.id, 'tech', coalesce(t, 'снят'), a.id, coalesce(a.full_name, ''), coalesce(a.role, ''));
    end if;
    if new.data is distinct from old.data then
      select string_agg(key, ',' order by key) into t from (
        select coalesce(n.key, o.key) key from jsonb_each(new.data) n full join jsonb_each(old.data) o on o.key = n.key
        where n.value is distinct from o.value) x where key not in ('tech', 'doctor', 'clinic', 'corrections', 'lastCorrection');
      if t is not null then
        insert into public.order_events(order_id, kind, info, actor_id, actor_name, actor_role)
        values (new.id, 'edit', t, a.id, coalesce(a.full_name, ''), coalesce(a.role, ''));
      end if;
    end if;
    if new.cancelled_at is distinct from old.cancelled_at then
      insert into public.order_events(order_id, kind, info, actor_id, actor_name, actor_role)
      values (new.id, case when new.cancelled_at is null then 'restore' else 'cancel' end, coalesce(new.cancel_reason, ''),
              a.id, coalesce(a.full_name, ''), coalesce(a.role, ''));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists orders_log on public.orders;
create trigger orders_log after insert or update on public.orders
  for each row execute function public.orders_log();

-- ══ 2. УВЕДОМЛЕНИЯ В TELEGRAM ═══════════════════════════════════════════════
-- Привязка Telegram — отдельно от профиля, чтобы chat_id не видели другие пользователи
create table if not exists public.user_telegram (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  chat_id bigint, link_code text unique, enabled boolean not null default true,
  linked_at timestamptz
);
alter table public.user_telegram enable row level security;
drop policy if exists tg_select on public.user_telegram;
create policy tg_select on public.user_telegram for select to authenticated using (user_id = auth.uid());
grant select on public.user_telegram to authenticated;

-- Очередь сообщений: читает только серверная функция notify (service role)
create table if not exists public.notify_queue (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz, error text
);
alter table public.notify_queue enable row level security;


create or replace function public.tg_link_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text := replace(gen_random_uuid()::text, '-', '');
begin
  if public.my_role() is null then raise exception 'Нет доступа'; end if;
  insert into public.user_telegram(user_id, link_code) values (auth.uid(), c)
  on conflict (user_id) do update set link_code = c;
  return c;
end $$;
create or replace function public.tg_set_enabled(p_on boolean) returns void
language sql security definer set search_path = public as $$
  update public.user_telegram set enabled = p_on where user_id = auth.uid()
$$;
create or replace function public.tg_unlink() returns void
language sql security definer set search_path = public as $$
  update public.user_telegram set chat_id = null, linked_at = null where user_id = auth.uid()
$$;

-- Поставить сообщение в очередь для пользователей (только с подключённым Telegram)
create or replace function public.enqueue(p_users uuid[], p_body text, p_except uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.notify_queue(user_id, body)
  select distinct t.user_id, p_body from public.user_telegram t join public.profiles p on p.id = t.user_id
  where t.user_id = any(p_users) and t.user_id is distinct from p_except
    and t.chat_id is not null and t.enabled and p.active
$$;
create or replace function public.staff_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.profiles where role in ('owner','lab_admin') and active
$$;
create or replace function public.clinic_side_ids(p_order public.orders) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[p_order.doctor_id] || coalesce((select array_agg(id) from public.profiles
    where role = 'clinic_admin' and clinic_id = p_order.clinic_id and active), '{}'), null)
$$;

create or replace function public.notify_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.orders; head text; stages text[] := array['Заказ создан','Заказ принят лабораторией','Техническая проверка','Планирование работы',
  'Цифровое моделирование (CAD)','Согласование дизайна','Производство','Индивидуальная работа техника','Контроль качества',
  'Работа готова','Передана в доставку','В пути','Получена клиникой','Заказ завершён'];
begin
  -- смену этапа при возврате на коррекцию не дублируем: придёт одно уведомление «возвращена на коррекцию»
  if new.kind in ('stage', 'edit') and coalesce(current_setting('ownlab.trusted', true), '') = 'on' then return null; end if;
  select * into o from public.orders where id = new.order_id;
  head := o.num || ' · ' || coalesce(o.data->>'patient', '') || E'\n' || coalesce(o.data->>'type', '');
  if new.kind = 'created' then
    perform public.enqueue(public.staff_ids(), '🆕 Новый заказ ' || head || E'\nСрок: ' || coalesce(o.data->>'dl', '—')
      || case when new.actor_name <> '' then E'\nСоздал: ' || new.actor_name else '' end, new.actor_id);
  elsif new.kind = 'cancel' then
    perform public.enqueue(array_remove(array[o.tech_id], null) || public.clinic_side_ids(o) || public.staff_ids(),
      '❌ Заказ отменён: ' || head || coalesce(E'\nПричина: ' || nullif(new.info, ''), ''), new.actor_id);
  elsif new.kind = 'return' then
    perform public.enqueue(array_remove(array[o.tech_id], null) || public.staff_ids() || public.clinic_side_ids(o),
      '↩ Работа возвращена на коррекцию: ' || head || coalesce(E'\nПричина: ' || nullif(new.info, ''), ''), new.actor_id);
  elsif new.kind = 'edit' and o.tech_id is not null then
    perform public.enqueue(array[o.tech_id], '✏️ Изменён заказ ' || head, new.actor_id);
  elsif new.kind = 'tech' and o.tech_id is not null then
    perform public.enqueue(array[o.tech_id], '🔧 Вам назначен заказ ' || head || E'\nСрок: ' || coalesce(o.data->>'dl', '—'), new.actor_id);
  elsif new.kind = 'stage' then
    if new.to_stage = 6 then
      perform public.enqueue(public.clinic_side_ids(o), '⏳ Дизайн ждёт согласования: ' || head, new.actor_id);
    elsif new.to_stage = 7 and new.from_stage = 6 then
      perform public.enqueue(array_remove(array[o.tech_id], null) || public.staff_ids(), '✅ Дизайн согласован: ' || head, new.actor_id);
    elsif new.to_stage = 11 then
      perform public.enqueue(public.clinic_side_ids(o), '🚚 Работа передана в доставку: ' || head
        || coalesce(E'\nТрек: ' || nullif(o.data->>'trackNum', ''), ''), new.actor_id);
    elsif new.to_stage = 13 then
      perform public.enqueue(array_remove(array[o.tech_id], null) || public.staff_ids(), '📦 Клиника получила работу: ' || head, new.actor_id);
    elsif o.tech_id is not null and new.actor_id is distinct from o.tech_id then
      perform public.enqueue(array[o.tech_id], '➡️ ' || head || E'\nЭтап: ' || stages[new.to_stage], new.actor_id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists notify_event on public.order_events;
create trigger notify_event after insert on public.order_events for each row execute function public.notify_event();

create or replace function public.notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.orders; r uuid[];
begin
  select * into o from public.orders where id = new.order_id;
  r := array_remove(array[o.tech_id, o.created_by], null) || public.clinic_side_ids(o);
  if new.author_role not in ('owner','lab_admin') then r := r || public.staff_ids(); end if;
  perform public.enqueue(r, '💬 ' || o.num || ' · ' || coalesce(o.data->>'patient', '') || E'\n'
    || new.author_name || ': ' || left(new.body, 500), new.author_id);
  return null;
end $$;
drop trigger if exists notify_comment on public.order_comments;
create trigger notify_comment after insert on public.order_comments for each row execute function public.notify_comment();

-- Разбудить функцию отправки (через pg_net). Ошибки сети никогда не ломают сохранение заказа.
create extension if not exists pg_net;
create or replace function public.notify_ping() returns trigger
language plpgsql security definer set search_path = public as $$
declare u text;
begin
  select value into u from public.app_config where key = 'notify_url';
  if u is not null then
    begin perform net.http_post(url := u, body := '{}'::jsonb); exception when others then null; end;
  end if;
  return null;
end $$;
drop trigger if exists notify_ping on public.notify_queue;
create trigger notify_ping after insert on public.notify_queue for each statement execute function public.notify_ping();

-- Забрать пачку сообщений для отправки (только для service role)
create or replace function public.claim_notifications() returns table(id bigint, chat_id bigint, body text)
language sql security definer set search_path = public as $$
  update public.notify_queue q set sent_at = now()
  from public.user_telegram t
  where q.id in (select id from public.notify_queue where sent_at is null order by id limit 50 for update skip locked)
    and t.user_id = q.user_id
  returning q.id, t.chat_id, q.body
$$;
revoke all on function public.claim_notifications() from public, anon, authenticated;
revoke all on function public.enqueue(uuid[], text, uuid) from public, anon, authenticated;
grant execute on function public.tg_link_code(), public.tg_set_enabled(boolean), public.tg_unlink() to authenticated;

-- ══ 4. РАСЧЁТЫ С КЛИНИКАМИ ══════════════════════════════════════════════════
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  kind text not null check (kind in ('inv','nak','sf')),
  number text not null, doc_date date not null,
  total numeric not null default 0, vat numeric not null default 0,
  order_ids uuid[] not null default '{}', title text not null default '', html text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists documents_clinic_idx on public.documents(clinic_id, doc_date);
alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in ('inv','nak','sf','act','upd'));
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  amount numeric not null check (amount > 0),
  paid_at date not null default current_date,
  method text not null default 'безналичный', note text not null default '',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists payments_clinic_idx on public.payments(clinic_id, paid_at);
alter table public.payments alter column paid_at set default ((now() at time zone 'Europe/Moscow')::date);
alter table public.documents enable row level security;
alter table public.payments enable row level security;
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (public.is_staff() or (public.my_role() = 'clinic_admin' and clinic_id = public.my_clinic()));
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated with check (public.is_staff());
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete to authenticated using (public.my_role() = 'owner');
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (public.is_staff() or (public.my_role() = 'clinic_admin' and clinic_id = public.my_clinic()));
drop policy if exists payments_write on public.payments;
create policy payments_write on public.payments for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, delete on public.documents to authenticated;
grant select, insert, update, delete on public.payments to authenticated;

-- Начисления = выполненные работы (по дате получения клиникой), оплаты = поступления
create or replace function public.ledger_rows(p_clinic uuid)
returns table(clinic_id uuid, d date, kind text, ref text, debit numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  select o.clinic_id, (o.done_at at time zone 'Europe/Moscow')::date, 'accrual',
         o.num || ' · ' || coalesce(o.data->>'patient', '') || ' · ' || coalesce(o.data->>'type', ''),
         coalesce(pr.price, 0) * coalesce(nullif(o.data->>'units', '')::numeric, 1), 0::numeric
  from public.orders o left join public.order_prices pr on pr.order_id = o.id
  where o.done_at is not null and o.cancelled_at is null and (p_clinic is null or o.clinic_id = p_clinic)
    and (public.is_staff() or (public.my_role() = 'clinic_admin' and o.clinic_id = public.my_clinic()))
  union all
  select p.clinic_id, p.paid_at, 'payment',
         'Оплата' || case when p.method <> '' then ' (' || p.method || ')' else '' end
           || coalesce(' по ' || case d.kind when 'inv' then 'счёту' when 'nak' then 'накладной' when 'act' then 'акту' when 'upd' then 'УПД' else 'счёту-фактуре' end || ' № ' || d.number, '')
           || case when p.note <> '' then ' · ' || p.note else '' end,
         0::numeric, p.amount
  from public.payments p left join public.documents d on d.id = p.document_id
  where (p_clinic is null or p.clinic_id = p_clinic)
    and (public.is_staff() or (public.my_role() = 'clinic_admin' and p.clinic_id = public.my_clinic()))
$$;
create or replace function public.clinic_balances(p_from date, p_to date)
returns table(clinic_id uuid, name text, opening numeric, accrued numeric, paid numeric, closing numeric, last_payment date)
language sql stable security definer set search_path = public as $$
  with l as (select * from public.ledger_rows(null))
  select c.id, c.name,
    coalesce(sum(l.debit - l.credit) filter (where p_from is not null and l.d < p_from), 0),
    coalesce(sum(l.debit) filter (where (p_from is null or l.d >= p_from) and (p_to is null or l.d <= p_to)), 0),
    coalesce(sum(l.credit) filter (where (p_from is null or l.d >= p_from) and (p_to is null or l.d <= p_to)), 0),
    coalesce(sum(l.debit - l.credit) filter (where p_to is null or l.d <= p_to), 0),
    max(l.d) filter (where l.kind = 'payment')
  from public.clinics c left join l on l.clinic_id = c.id
  where public.is_staff() or (public.my_role() = 'clinic_admin' and c.id = public.my_clinic())
  group by c.id, c.name order by c.name
$$;
create or replace function public.clinic_ledger(p_clinic uuid, p_from date, p_to date)
returns table(d date, kind text, ref text, debit numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  select d, kind, ref, debit, credit from public.ledger_rows(p_clinic)
  where (p_from is null or d >= p_from) and (p_to is null or d <= p_to)
  order by d, kind, ref
$$;
revoke all on function public.ledger_rows(uuid) from public, anon;
revoke all on function public.clinic_balances(date, date), public.clinic_ledger(uuid, date, date) from public, anon;
grant execute on function public.ledger_rows(uuid), public.clinic_balances(date, date), public.clinic_ledger(uuid, date, date) to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.order_events; exception when others then null; end;
  begin alter publication supabase_realtime add table public.payments; exception when others then null; end;
end $$;

-- ══ 10. ШАБЛОНЫ ЗАКАЗОВ ═════════════════════════════════════════════════════
create table if not exists public.order_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  name text not null check (length(name) between 1 and 100),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.order_templates enable row level security;
drop policy if exists templates_own on public.order_templates;
create policy templates_own on public.order_templates for all to authenticated
  using (user_id = auth.uid() and public.my_role() is not null)
  with check (user_id = auth.uid() and public.my_role() is not null);
grant select, insert, update, delete on public.order_templates to authenticated;

-- ══ 12. ВЫПЛАТЫ ТЕХНИКАМ ════════════════════════════════════════════════════
create table if not exists public.tech_payouts (
  id uuid primary key default gen_random_uuid(),
  tech_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null check (amount > 0),
  paid_at date not null default ((now() at time zone 'Europe/Moscow')::date),
  note text not null default '',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists tech_payouts_tech_idx on public.tech_payouts(tech_id, paid_at);
alter table public.tech_payouts enable row level security;
drop policy if exists payouts_select on public.tech_payouts;
create policy payouts_select on public.tech_payouts for select to authenticated
  using (public.is_staff() or (public.my_role() = 'tech' and tech_id = auth.uid()));
drop policy if exists payouts_write on public.tech_payouts;
create policy payouts_write on public.tech_payouts for all to authenticated
  using (public.is_staff()) with check (public.is_staff()
    and exists (select 1 from public.profiles where id = tech_id and role = 'tech'));
grant select, insert, update, delete on public.tech_payouts to authenticated;

-- ══ 15. ДВУХФАКТОРНЫЙ ВХОД ══════════════════════════════════════════════════
create or replace function public.security_status() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('require_mfa_staff', public.mfa_required(), 'aal', coalesce(auth.jwt()->>'aal', ''))
$$;
-- Включать и выключать обязательную 2FA может только собственник, сам вошедший с кодом
create or replace function public.set_require_mfa(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'owner' and active) then raise exception 'Только собственник'; end if;
  if coalesce(auth.jwt()->>'aal', '') <> 'aal2' then raise exception 'Сначала войдите с кодом из приложения-аутентификатора'; end if;
  insert into public.app_config(key, value) values ('require_mfa_staff', case when p_on then 'on' else 'off' end)
  on conflict (key) do update set value = excluded.value;
end $$;
revoke all on function public.set_require_mfa(boolean) from public, anon;
grant execute on function public.set_require_mfa(boolean), public.security_status() to authenticated;

-- ══ ВОЗВРАТ НА КОРРЕКЦИЮ ════════════════════════════════════════════════════
-- Работа отправлена (этапы 11–12) или получена клиникой (13), но не подошла — клиника или лаборатория
-- возвращает её в лабораторию. Клиника всегда возвращает на этап 8 «Индивидуальная работа техника»,
-- лаборатория может выбрать этап 3–10. Начисление и зарплата за работу снимаются до повторной сдачи.
create or replace function public.return_for_correction(p_order uuid, p_reason text, p_stage int, p_dl text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; r text := public.my_role(); a public.profiles; target int;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null or not public.can_see_order(p_order) then raise exception 'Заказ не найден'; end if;
  if r not in ('owner','lab_admin','clinic_admin','doctor') then raise exception 'Вернуть работу может клиника или лаборатория'; end if;
  if o.cancelled_at is not null then raise exception 'Заказ отменён'; end if;
  if o.stage not between 11 and 13 then raise exception 'Вернуть на коррекцию можно после отправки работы в клинику'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Укажите причину'; end if;
  target := case when public.is_staff() then coalesce(p_stage, 8) else 8 end;
  if target not between 3 and 10 then raise exception 'Недопустимый этап'; end if;
  select * into a from public.profiles where id = auth.uid();
  perform set_config('ownlab.trusted', 'on', true);
  update public.orders set stage = target,
    data = data || jsonb_build_object('corrections', coalesce((data->>'corrections')::int, 0) + 1,
                                      'lastCorrection', jsonb_build_object('reason', trim(p_reason), 'at', now(), 'by', coalesce(a.full_name, '')))
                || case when coalesce(p_dl, '') <> '' then jsonb_build_object('dl', p_dl) else '{}'::jsonb end
  where id = p_order;
  perform set_config('ownlab.trusted', 'off', true);
  insert into public.order_events(order_id, kind, from_stage, to_stage, info, actor_id, actor_name, actor_role)
  values (p_order, 'return', o.stage, target, trim(p_reason), a.id, coalesce(a.full_name, ''), coalesce(a.role, ''));
end $$;
revoke all on function public.return_for_correction(uuid, text, int, text) from public, anon;
grant execute on function public.return_for_correction(uuid, text, int, text) to authenticated;

-- ── ДОЗАПОЛНЕНИЕ ДЛЯ УЖЕ СОЗДАННЫХ ЗАКАЗОВ ──────────────────────────────────
alter table public.orders disable trigger orders_guard;
update public.orders set done_at = coalesce(done_at, updated_at), tech_percent = coalesce(tech_percent, public.tech_percent_for(tech_id))
 where stage >= 13 and done_at is null;
alter table public.orders enable trigger orders_guard;
insert into public.order_events(order_id, kind, to_stage, created_at)
select o.id, 'created', o.stage, o.created_at from public.orders o
where not exists (select 1 from public.order_events e where e.order_id = o.id);

-- Адрес функции отправки уведомлений этого проекта
insert into public.app_config(key, value) values ('notify_url', 'https://ncvsivphvnuftvczaogu.supabase.co/functions/v1/notify')
on conflict (key) do update set value = excluded.value;
