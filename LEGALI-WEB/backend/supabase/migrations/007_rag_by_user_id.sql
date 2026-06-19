-- ============================================================
-- LEGALI v2.0 — Migración 007
-- RAG: buscar documentos de sesión por user_id en vez de session_id
-- ============================================================

-- Eliminar TODAS las versiones existentes de la función
DROP FUNCTION IF EXISTS public.search_legal_docs(text, text, integer);
DROP FUNCTION IF EXISTS public.search_legal_docs(text, text, integer, uuid);
DROP FUNCTION IF EXISTS public.search_legal_docs(text);

-- Recrear con la firma nueva (incluye p_user_id)
CREATE OR REPLACE FUNCTION public.search_legal_docs(
  query_text   text,
  p_session_id text    DEFAULT NULL,
  max_results  integer DEFAULT 5,
  p_user_id    uuid    DEFAULT NULL
)
RETURNS TABLE (
  id         uuid,
  title      text,
  content    text,
  category   text,
  source     text,
  rank       real
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Biblioteca jurídica (sin cambios)
  SELECT
    ld.id,
    ld.title,
    left(ld.content, 1200) AS content,
    ld.category,
    ld.source,
    ts_rank(ld.search_vec, query) AS rank
  FROM public.legal_documents ld,
       to_tsquery('spanish', regexp_replace(
         immutable_unaccent(trim(query_text)),
         '\s+', ':* & ', 'g'
       ) || ':*') AS query
  WHERE ld.active = true
    AND ld.search_vec @@ query

  UNION ALL

  -- Documentos del usuario: por user_id (persiste entre sesiones)
  SELECT
    sd.id,
    sd.filename AS title,
    left(sd.content, 1200) AS content,
    'session' AS category,
    'usuario' AS source,
    ts_rank(sd.search_vec, query) AS rank
  FROM public.session_documents sd,
       to_tsquery('spanish', regexp_replace(
         immutable_unaccent(trim(query_text)),
         '\s+', ':* & ', 'g'
       ) || ':*') AS query
  WHERE sd.search_vec @@ query
    AND (
      (p_user_id IS NOT NULL AND sd.user_id = p_user_id)
      OR
      (p_user_id IS NULL AND (p_session_id IS NULL OR sd.session_id = p_session_id))
    )

  ORDER BY rank DESC
  LIMIT max_results;
$$;

GRANT EXECUTE ON FUNCTION public.search_legal_docs TO authenticated;

-- Índice por user_id
CREATE INDEX IF NOT EXISTS idx_session_docs_user_id
  ON public.session_documents(user_id);
