-- ============================================================
-- LEGALI v2.0 — Migración 005: audit_logs + legali_config
--
-- Estas tablas están definidas en schema.sql (creación inicial),
-- pero NO tenían migración incremental. Esta migración las crea
-- de forma idempotente (IF NOT EXISTS) para proyectos que
-- fueron inicializados sin el schema.sql completo, o para
-- asegurar que existan tras un restore parcial.
--
-- También agrega:
--   - increment_quota_used() — RPC invocada por quota.js
--   - Índices de rendimiento para audit_logs
--   - Configuración inicial de legali_config si está vacía
--
-- Ejecutar: supabase db push
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Tabla audit_logs
-- ─────────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.legali_profiles(id) on delete set null,
  action      text not null,           -- 'query', 'login', 'plan_change', etc.
  provider    text,
  model       text,
  tokens_in   integer default 0,
  tokens_out  integer default 0,
  session_id  text,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_logs_user
  on public.audit_logs (user_id);

create index if not exists idx_audit_logs_created
  on public.audit_logs (created_at desc);

create index if not exists idx_audit_logs_action
  on public.audit_logs (action);

alter table public.audit_logs enable row level security;

-- Políticas RLS (idempotente: DROP + CREATE para evitar duplicados)
do $$ begin
  drop policy if exists "user_read_own_logs" on public.audit_logs;
  drop policy if exists "admin_all_logs"     on public.audit_logs;
exception when others then null;
end $$;

create policy "user_read_own_logs"
  on public.audit_logs for select
  using (user_id = auth.uid());

create policy "admin_all_logs"
  on public.audit_logs for all
  using (public.is_admin());

-- Permisos
grant select on public.audit_logs to authenticated;
grant insert on public.audit_logs to authenticated;
grant all    on public.audit_logs to service_role;

-- ─────────────────────────────────────────────────────────────
-- 2. Tabla legali_config (configuración del sistema)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.legali_config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

alter table public.legali_config enable row level security;

do $$ begin
  drop policy if exists "admin_manage_config" on public.legali_config;
  drop policy if exists "auth_read_config"    on public.legali_config;
exception when others then null;
end $$;

create policy "admin_manage_config"
  on public.legali_config for all
  using (public.is_admin());

create policy "auth_read_config"
  on public.legali_config for select
  using (auth.uid() is not null);

grant select on public.legali_config to authenticated;
grant all    on public.legali_config to service_role;

-- Trigger updated_at (reutiliza la función existente set_updated_at)
do $$ begin
  create trigger trg_config_updated_at
    before update on public.legali_config
    for each row execute procedure public.set_updated_at();
exception when duplicate_object then null;
end $$;

-- Valores iniciales (solo si la tabla está vacía)
insert into public.legali_config (key, value, description)
values
  ('groq_model',           '"llama-3.3-70b-versatile"',
   'Modelo Groq para plan gratis'),
  ('anthropic_model_pro',  '"claude-sonnet-4-6"',
   'Modelo Anthropic para plan profesional'),
  ('anthropic_model_firma','"claude-opus-4-8"',
   'Modelo Anthropic para plan firma/admin'),
  ('openai_model',         '"gpt-4o-mini"',
   'Modelo OpenAI para plan consultorio'),
  ('site_notice',          '"null"',
   'Aviso global para mostrar en la UI (null = sin aviso)')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 3. RPC increment_quota_used — invocada por quota.js
--    (puede no existir si schema.sql no se ejecutó completo)
-- ─────────────────────────────────────────────────────────────
create or replace function public.increment_quota_used(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.legali_profiles
  set
    quota_used = quota_used + 1,
    updated_at = now()
  where id = p_user_id
    and active = true
    and quota_total <> 9999;  -- no incrementar en planes ilimitados
end;
$$;

grant execute on function public.increment_quota_used(uuid) to authenticated;
grant execute on function public.increment_quota_used(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 4. Función is_admin() — puede no existir en instalaciones
--    parciales. Creación segura (no sobreescribe si existe).
-- ─────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.legali_profiles
    where id = auth.uid()
      and plan = 'admin'
      and active = true
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. Función set_updated_at() — trigger genérico
--    Creación segura (no falla si ya existe)
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
