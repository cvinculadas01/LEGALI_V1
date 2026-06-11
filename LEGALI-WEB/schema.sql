-- ============================================================
-- LEGALI v2.0 — schema.sql
-- PostgreSQL / Supabase
-- ============================================================

-- ─────────────────────────────────────────────
-- SECCIÓN 1: EXTENSIONES
-- ─────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";
create extension if not exists "unaccent";
create extension if not exists "pg_cron";

-- ─────────────────────────────────────────────
-- SECCIÓN 2: FUNCIÓN INMUTABLE PARA ÍNDICE GIN
-- ─────────────────────────────────────────────
create or replace function immutable_unaccent(text)
returns text language sql immutable strict parallel safe as
$$ select unaccent($1) $$;

-- ─────────────────────────────────────────────
-- SECCIÓN 3: TABLAS
-- ─────────────────────────────────────────────

-- 3.1 Perfiles de usuario
create table if not exists public.legali_profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  nombre            text,
  apellido          text,
  email             text,
  plan              text not null default 'gratis'
                    check (plan in ('gratis','consultorio','profesional','firma','admin')),
  provider_assigned text not null default 'groq'
                    check (provider_assigned in ('groq','openai','anthropic')),
  quota_used        integer not null default 0,
  quota_total       integer not null default 5,
  active            boolean not null default true,
  plan_expires_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 3.2 Conversaciones
create table if not exists public.conversations (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.legali_profiles(id) on delete cascade,
  session_id  text not null,
  role        text not null check (role in ('user','assistant','system')),
  content     text not null,
  tokens_used integer default 0,
  created_at  timestamptz not null default now()
);

-- 3.3 Documentos jurídicos (biblioteca global, admin)
create table if not exists public.legal_documents (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  content     text not null,
  category    text,
  source      text,
  active      boolean not null default true,
  search_vec  tsvector generated always as (
                to_tsvector('spanish', immutable_unaccent(coalesce(title,'') || ' ' || coalesce(content,'')))
              ) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3.4 Documentos de sesión (subidos por usuario)
create table if not exists public.session_documents (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.legali_profiles(id) on delete cascade,
  session_id  text not null,
  filename    text not null,
  content     text not null,
  size_bytes  integer default 0,
  search_vec  tsvector generated always as (
                to_tsvector('spanish', immutable_unaccent(coalesce(filename,'') || ' ' || coalesce(content,'')))
              ) stored,
  created_at  timestamptz not null default now()
);

-- 3.5 Memoria legal (fragmentos RAG extraídos)
create table if not exists public.legal_memory (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.legali_profiles(id) on delete cascade,
  session_id  text,
  fragment    text not null,
  source      text,
  search_vec  tsvector generated always as (
                to_tsvector('spanish', immutable_unaccent(coalesce(fragment,'')))
              ) stored,
  created_at  timestamptz not null default now()
);

-- 3.6 Pagos
create table if not exists public.legali_payments (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.legali_profiles(id) on delete cascade,
  provider        text not null check (provider in ('wompi','mercadopago','manual')),
  external_id     text,
  plan            text not null,
  amount_usd      numeric(10,2),
  amount_cop      numeric(14,0),
  status          text not null default 'pending'
                  check (status in ('pending','approved','rejected','refunded')),
  raw_payload     jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 3.7 Logs de uso / auditoría
create table if not exists public.audit_logs (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.legali_profiles(id) on delete set null,
  action      text not null,
  provider    text,
  model       text,
  tokens_in   integer default 0,
  tokens_out  integer default 0,
  session_id  text,
  ip_address  text,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

-- 3.8 Configuración global (admin)
create table if not exists public.legali_config (
  key         text primary key,
  value       text,
  description text,
  updated_at  timestamptz not null default now()
);

insert into public.legali_config (key, value, description) values
  ('default_provider',    'groq',                   'Proveedor IA por defecto para plan gratis'),
  ('groq_model',          'llama-3.3-70b-versatile', 'Modelo Groq'),
  ('openai_model',        'gpt-4o-mini',             'Modelo OpenAI'),
  ('anthropic_model',     'claude-sonnet-4-20250514','Modelo Anthropic estándar'),
  ('anthropic_model_pro', 'claude-opus-4-6',         'Modelo Anthropic premium'),
  ('rag_max_results',     '5',                       'Fragmentos RAG máximos por consulta'),
  ('rag_max_chars',       '4000',                    'Caracteres máximos inyectados en prompt'),
  ('maintenance_mode',    'false',                   'Modo mantenimiento')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────
-- SECCIÓN 4: ÍNDICES
-- ─────────────────────────────────────────────
create index if not exists idx_legal_documents_search  on public.legal_documents  using gin(search_vec);
create index if not exists idx_session_documents_search on public.session_documents using gin(search_vec);
create index if not exists idx_legal_memory_search      on public.legal_memory      using gin(search_vec);
create index if not exists idx_conversations_user       on public.conversations(user_id);
create index if not exists idx_conversations_session    on public.conversations(session_id);
create index if not exists idx_session_docs_session     on public.session_documents(session_id);
create index if not exists idx_audit_logs_user          on public.audit_logs(user_id);
create index if not exists idx_audit_logs_created       on public.audit_logs(created_at desc);
create index if not exists idx_payments_user            on public.legali_payments(user_id);

-- ─────────────────────────────────────────────
-- SECCIÓN 5: TRIGGER — crear perfil al registrarse
-- ─────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _plan  text := coalesce(new.raw_user_meta_data->>'plan', 'gratis');
  _quota integer;
begin
  _quota := case _plan
    when 'consultorio'  then 50
    when 'profesional'  then 200
    when 'firma'        then 9999
    when 'admin'        then 9999
    else 5
  end;

  insert into public.legali_profiles (
    id, nombre, apellido, email, plan,
    provider_assigned, quota_used, quota_total, active
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', ''),
    coalesce(new.raw_user_meta_data->>'apellido', ''),
    new.email,
    _plan,
    case _plan
      when 'profesional' then 'anthropic'
      when 'firma'       then 'anthropic'
      when 'admin'       then 'anthropic'
      when 'consultorio' then 'openai'
      else 'groq'
    end,
    0,
    _quota,
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────────
-- SECCIÓN 6: TRIGGER — updated_at automático
-- ─────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at  before update on public.legali_profiles  for each row execute procedure public.set_updated_at();
create trigger trg_payments_updated_at  before update on public.legali_payments   for each row execute procedure public.set_updated_at();
create trigger trg_docs_updated_at      before update on public.legal_documents   for each row execute procedure public.set_updated_at();
create trigger trg_config_updated_at    before update on public.legali_config     for each row execute procedure public.set_updated_at();

-- ─────────────────────────────────────────────
-- SECCIÓN 7: RPCs
-- ─────────────────────────────────────────────

-- 7.1 Buscar documentos RAG
create or replace function public.search_legal_docs(
  query_text  text,
  p_session_id text default null,
  max_results integer default 5
)
returns table (
  id         uuid,
  title      text,
  content    text,
  category   text,
  source     text,
  rank       real
)
language sql stable security definer set search_path = public as $$
  select
    ld.id,
    ld.title,
    left(ld.content, 1200) as content,
    ld.category,
    ld.source,
    ts_rank(ld.search_vec, query) as rank
  from public.legal_documents ld,
       to_tsquery('spanish', regexp_replace(
         immutable_unaccent(trim(query_text)),
         '\s+', ':* & ', 'g'
       ) || ':*') as query
  where ld.active = true
    and ld.search_vec @@ query

  union all

  select
    sd.id,
    sd.filename as title,
    left(sd.content, 1200) as content,
    'session' as category,
    'usuario' as source,
    ts_rank(sd.search_vec, query) as rank
  from public.session_documents sd,
       to_tsquery('spanish', regexp_replace(
         immutable_unaccent(trim(query_text)),
         '\s+', ':* & ', 'g'
       ) || ':*') as query
  where (p_session_id is null or sd.session_id = p_session_id)
    and sd.search_vec @@ query

  order by rank desc
  limit max_results;
$$;

-- 7.2 Verificar cuota
create or replace function public.check_user_quota(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rec record;
begin
  select plan, quota_used, quota_total, active, provider_assigned
  into rec
  from public.legali_profiles
  where id = p_user_id;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'profile_not_found');
  end if;

  if not rec.active then
    return jsonb_build_object('allowed', false, 'reason', 'account_suspended');
  end if;

  if rec.quota_total <> 9999 and rec.quota_used >= rec.quota_total then
    return jsonb_build_object(
      'allowed',   false,
      'reason',    'quota_exhausted',
      'used',      rec.quota_used,
      'total',     rec.quota_total
    );
  end if;

  return jsonb_build_object(
    'allowed',   true,
    'plan',      rec.plan,
    'provider',  rec.provider_assigned,
    'used',      rec.quota_used,
    'total',     rec.quota_total
  );
end;
$$;

-- 7.3 Incrementar cuota (atómica)
create or replace function public.increment_quota_used(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.legali_profiles
  set quota_used = quota_used + 1,
      updated_at = now()
  where id = p_user_id;
end;
$$;

-- 7.4 Reset mensual de cuotas
create or replace function public.reset_monthly_quotas()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.legali_profiles
  set quota_used = 0,
      updated_at = now()
  where active = true;
end;
$$;

-- 7.5 Activar plan tras pago
create or replace function public.activate_plan(
  p_user_id     uuid,
  p_plan        text,
  p_payment_id  uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  _quota    integer;
  _provider text;
begin
  _quota := case p_plan
    when 'consultorio' then 50
    when 'profesional' then 200
    when 'firma'       then 9999
    else 5
  end;

  _provider := case p_plan
    when 'profesional' then 'anthropic'
    when 'firma'       then 'anthropic'
    when 'consultorio' then 'openai'
    else 'groq'
  end;

  update public.legali_profiles
  set plan              = p_plan,
      provider_assigned = _provider,
      quota_total       = _quota,
      quota_used        = 0,
      plan_expires_at   = now() + interval '1 month',
      active            = true,
      updated_at        = now()
  where id = p_user_id;

  if p_payment_id is not null then
    update public.legali_payments
    set status     = 'approved',
        updated_at = now()
    where id = p_payment_id;
  end if;
end;
$$;

-- ─────────────────────────────────────────────
-- SECCIÓN 8: ROW LEVEL SECURITY
-- ─────────────────────────────────────────────

alter table public.legali_profiles    enable row level security;
alter table public.conversations      enable row level security;
alter table public.legal_documents    enable row level security;
alter table public.session_documents  enable row level security;
alter table public.legal_memory       enable row level security;
alter table public.legali_payments    enable row level security;
alter table public.audit_logs         enable row level security;
alter table public.legali_config      enable row level security;

-- Helper: es admin
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.legali_profiles
    where id = auth.uid() and plan = 'admin'
  );
$$;

-- legali_profiles
create policy "user_read_own_profile"    on public.legali_profiles for select using (id = auth.uid());
create policy "user_update_own_profile"  on public.legali_profiles for update using (id = auth.uid());
create policy "admin_all_profiles"       on public.legali_profiles for all    using (public.is_admin());

-- conversations
create policy "user_own_conversations"   on public.conversations for all    using (user_id = auth.uid());
create policy "admin_all_conversations"  on public.conversations for all    using (public.is_admin());

-- legal_documents (biblioteca global)
create policy "auth_read_docs"           on public.legal_documents for select using (auth.uid() is not null and active = true);
create policy "admin_manage_docs"        on public.legal_documents for all    using (public.is_admin());

-- session_documents
create policy "user_own_session_docs"    on public.session_documents for all using (user_id = auth.uid());
create policy "admin_all_session_docs"   on public.session_documents for all using (public.is_admin());

-- legal_memory
create policy "user_own_memory"          on public.legal_memory for all    using (user_id = auth.uid() or user_id is null);
create policy "admin_all_memory"         on public.legal_memory for all    using (public.is_admin());

-- legali_payments
create policy "user_own_payments"        on public.legali_payments for select using (user_id = auth.uid());
create policy "admin_all_payments"       on public.legali_payments for all    using (public.is_admin());

-- audit_logs
create policy "user_read_own_logs"       on public.audit_logs for select using (user_id = auth.uid());
create policy "admin_all_logs"           on public.audit_logs for all    using (public.is_admin());

-- legali_config
create policy "admin_manage_config"      on public.legali_config for all    using (public.is_admin());
create policy "auth_read_config"         on public.legali_config for select using (auth.uid() is not null);

-- ─────────────────────────────────────────────
-- SECCIÓN 9: PERMISOS PARA RPCs
-- ─────────────────────────────────────────────
grant execute on function public.search_legal_docs    to authenticated;
grant execute on function public.check_user_quota     to authenticated;
grant execute on function public.increment_quota_used to authenticated;
grant execute on function public.reset_monthly_quotas to service_role;
grant execute on function public.activate_plan        to service_role;

-- ─────────────────────────────────────────────
-- SECCIÓN 10: STORAGE BUCKETS
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('legal-docs',     'legal-docs',     false, 52428800,  array['application/pdf','text/plain','text/markdown']),
  ('session-uploads','session-uploads', false, 104857600, array['application/pdf','text/plain','text/markdown','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- Storage RLS: legal-docs
create policy "admin_upload_legal_docs"
  on storage.objects for insert
  with check (bucket_id = 'legal-docs' and public.is_admin());

create policy "auth_read_legal_docs"
  on storage.objects for select
  using (bucket_id = 'legal-docs' and auth.uid() is not null);

-- Storage RLS: session-uploads
create policy "user_upload_session"
  on storage.objects for insert
  with check (bucket_id = 'session-uploads' and auth.uid() is not null);

create policy "user_read_own_session_upload"
  on storage.objects for select
  using (bucket_id = 'session-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "user_delete_own_session_upload"
  on storage.objects for delete
  using (bucket_id = 'session-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- ─────────────────────────────────────────────
-- SECCIÓN 11: PG_CRON — reset mensual
-- ─────────────────────────────────────────────
select cron.schedule(
  'legali-reset-monthly-quotas',
  '0 0 1 * *',
  $$ select public.reset_monthly_quotas(); $$
);

-- ─────────────────────────────────────────────
-- SECCIÓN 12: DATOS INICIALES — usuario admin
-- ─────────────────────────────────────────────
-- Ejecutar DESPUÉS de crear el usuario admin en Supabase Auth Dashboard:
-- update public.legali_profiles
--   set plan = 'admin', provider_assigned = 'anthropic', quota_total = 9999, active = true
--   where email = 'admin@legali.co';
