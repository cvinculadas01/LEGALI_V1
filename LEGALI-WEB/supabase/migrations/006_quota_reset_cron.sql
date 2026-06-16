-- ============================================================
-- LEGALI v2.0 — Migración 006: Reset mensual de cuotas (pg_cron)
--
-- Configura un job automático en pg_cron para resetear las cuotas
-- de todos los usuarios activos el día 1 de cada mes a las 00:00 UTC.
--
-- REQUISITO: la extensión pg_cron debe estar habilitada en
-- Supabase Dashboard → Database → Extensions → pg_cron ✓
--
-- También refuerza la función search_legal_docs para aplicar
-- correctamente RLS en session_documents (filtrar por user_id
-- del usuario autenticado además de session_id).
--
-- Deploy: supabase db push
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Reset mensual de cuotas vía pg_cron
--    Día 1 de cada mes, 00:00 UTC
-- ─────────────────────────────────────────────────────────────
select cron.unschedule(jobid) from cron.job where jobname = 'legali_monthly_quota_reset';

select cron.schedule(
  'legali_monthly_quota_reset',
  '0 0 1 * *',   -- minuto 0, hora 0, día 1, cualquier mes
  $$
    update public.legali_profiles
    set quota_used = 0,
        updated_at = now()
    where active = true
      and quota_total <> 9999;  -- no resetear planes ilimitados
  $$
);

-- ─────────────────────────────────────────────────────────────
-- 2. Limpieza automática de eventos de rate limit
--    Cada hora, elimina eventos con más de 10 minutos de antigüedad
-- ─────────────────────────────────────────────────────────────
select cron.unschedule(jobid) from cron.job where jobname = 'legali_rate_events_cleanup';

select cron.schedule(
  'legali_rate_events_cleanup',
  '5 * * * *',   -- minuto 5 de cada hora
  $$
    delete from public.legali_rate_events
    where created_at < now() - interval '10 minutes';
  $$
);

-- ─────────────────────────────────────────────────────────────
-- 3. Limpieza de conversaciones antiguas (>120 días)
--    Cada domingo a las 02:00 UTC
-- ─────────────────────────────────────────────────────────────
select cron.unschedule(jobid) from cron.job where jobname = 'legali_conversations_cleanup';

select cron.schedule(
  'legali_conversations_cleanup',
  '0 2 * * 0',   -- 02:00 UTC todos los domingos
  $$
    -- Conservar conversaciones según el plan del usuario:
    -- gratis: 1 día, consultorio: 30d, profesional: 90d, firma/admin: 9999d
    delete from public.conversations c
    using public.legali_profiles p
    where c.user_id = p.id
      and (
        (p.plan = 'gratis'       and c.created_at < now() - interval  '1 day')  or
        (p.plan = 'consultorio'  and c.created_at < now() - interval '30 days') or
        (p.plan = 'profesional'  and c.created_at < now() - interval '90 days')
        -- firma y admin no se limpian
      );
  $$
);

-- ─────────────────────────────────────────────────────────────
-- 4. Función search_legal_docs mejorada con RLS de session docs
--    La versión anterior no filtraba por user_id en session_documents,
--    lo que permitía (en teoría) que un session_id adivinado revelara
--    documentos de otro usuario. Esta versión lo corrige.
-- ─────────────────────────────────────────────────────────────
create or replace function public.search_legal_docs(
  query_text   text,
  p_session_id text    default null,
  max_results  integer default 5
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
  -- Documentos de la biblioteca jurídica global (activos, sin filtro de usuario)
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

  -- Documentos de sesión del usuario autenticado
  -- Filtro doble: session_id Y user_id (protección RLS)
  select
    sd.id,
    sd.filename as title,
    left(sd.content, 1200) as content,
    'session'   as category,
    'usuario'   as source,
    ts_rank(sd.search_vec, query) as rank
  from public.session_documents sd,
       to_tsquery('spanish', regexp_replace(
         immutable_unaccent(trim(query_text)),
         '\s+', ':* & ', 'g'
       ) || ':*') as query
  where sd.user_id = auth.uid()                          -- RLS explícita
    and (p_session_id is null or sd.session_id = p_session_id)
    and sd.search_vec @@ query

  order by rank desc
  limit max_results;
$$;

grant execute on function public.search_legal_docs(text, text, integer) to authenticated;
grant execute on function public.search_legal_docs(text, text, integer) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 5. Expiración automática de planes (detectar plan vencido)
--    Cada día a las 01:00 UTC: planes con plan_expires_at vencido
--    vuelven a 'gratis' automáticamente
-- ─────────────────────────────────────────────────────────────
select cron.unschedule(jobid) from cron.job where jobname = 'legali_plan_expiry_check';

select cron.schedule(
  'legali_plan_expiry_check',
  '0 1 * * *',   -- 01:00 UTC todos los días
  $$
    update public.legali_profiles
    set plan              = 'gratis',
        provider_assigned = 'groq',
        quota_total       = 5,
        quota_used        = 0,
        plan_expires_at   = null,
        updated_at        = now()
    where plan not in ('gratis', 'admin')
      and plan_expires_at is not null
      and plan_expires_at < now();
  $$
);
