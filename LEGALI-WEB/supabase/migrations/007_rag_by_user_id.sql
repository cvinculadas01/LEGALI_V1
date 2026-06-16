-- ============================================================
-- LEGALI v2.0 — Migración 007
-- RAG: buscar documentos de sesión por user_id en vez de session_id
-- Aplicar en: Supabase SQL Editor o supabase db push
-- ============================================================

-- Reemplazar search_legal_docs para filtrar por user_id
create or replace function public.search_legal_docs(
  query_text   text,
  p_session_id text    default null,
  max_results  integer default 5,
  p_user_id    uuid    default null   -- NUEVO parámetro
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
  -- Documentos de la biblioteca jurídica (sin cambios)
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

  -- Documentos del usuario: filtrar por user_id (persiste entre sesiones)
  -- Fallback a session_id si no viene user_id (compatibilidad hacia atrás)
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
  where sd.search_vec @@ query
    and (
      -- Prioridad: filtrar por user_id si viene
      (p_user_id is not null and sd.user_id = p_user_id)
      or
      -- Fallback: session_id si no viene user_id
      (p_user_id is null and (p_session_id is null or sd.session_id = p_session_id))
    )

  order by rank desc
  limit max_results;
$$;

grant execute on function public.search_legal_docs to authenticated;

-- Índice por user_id para búsquedas rápidas (si no existe)
create index if not exists idx_session_docs_user_id
  on public.session_documents(user_id);
