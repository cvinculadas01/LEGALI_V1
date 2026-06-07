-- ============================================================
-- LEGALI — Esquema Supabase COMPLETO v2 (fixed unaccent)
-- Ejecutar en SQL Editor de Supabase → Run
-- ============================================================

-- Extensión para quitar tildes en búsquedas
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- Función wrapper IMMUTABLE para poder usarla en índices
DROP FUNCTION IF EXISTS immutable_unaccent(text);

CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$
  SELECT extensions.unaccent($1);
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

-- ── 1. Historial de conversaciones ────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  provider    TEXT,
  model       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conv_session
  ON conversations(session_id, created_at);

-- ── 2. Memoria de consultas jurídicas ─────────────────────────
CREATE TABLE IF NOT EXISTS legal_memory (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      TEXT NOT NULL,
  query           TEXT NOT NULL,
  literal_source  TEXT,
  analysis        TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mem_session
  ON legal_memory(session_id);

-- ── 3. Biblioteca jurídica global (admin) ─────────────────────
CREATE TABLE IF NOT EXISTS legal_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  source      TEXT,
  category    TEXT,
  content     TEXT NOT NULL,
  file_size   INTEGER,
  pages       INTEGER,
  uploaded_by TEXT DEFAULT 'admin',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Índice FTS usando la función IMMUTABLE
CREATE INDEX IF NOT EXISTS idx_docs_fts
  ON legal_documents
  USING gin(to_tsvector('spanish', immutable_unaccent(content)));

CREATE INDEX IF NOT EXISTS idx_docs_category
  ON legal_documents(category);

-- ── 4. Documentos de sesión del usuario ───────────────────────
CREATE TABLE IF NOT EXISTS session_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  content     TEXT NOT NULL,
  file_size   INTEGER,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sdocs_session
  ON session_documents(session_id);

-- ── Row Level Security ─────────────────────────────────────────
ALTER TABLE conversations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_memory       ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_documents  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conv_all"    ON conversations;
DROP POLICY IF EXISTS "mem_all"     ON legal_memory;
DROP POLICY IF EXISTS "ldocs_read"  ON legal_documents;
DROP POLICY IF EXISTS "ldocs_write" ON legal_documents;
DROP POLICY IF EXISTS "ldocs_del"   ON legal_documents;
DROP POLICY IF EXISTS "sdocs_all"   ON session_documents;

CREATE POLICY "conv_all"    ON conversations     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "mem_all"     ON legal_memory       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "ldocs_read"  ON legal_documents    FOR SELECT USING (true);
CREATE POLICY "ldocs_write" ON legal_documents    FOR INSERT WITH CHECK (true);
CREATE POLICY "ldocs_del"   ON legal_documents    FOR DELETE USING (true);
CREATE POLICY "sdocs_all"   ON session_documents  FOR ALL USING (true) WITH CHECK (true);

-- ── Función de búsqueda RAG ────────────────────────────────────
CREATE OR REPLACE FUNCTION search_legal_docs(
  query_text  TEXT,
  session_id  TEXT DEFAULT NULL,
  max_results INTEGER DEFAULT 6
)
RETURNS TABLE (
  id        UUID,
  name      TEXT,
  category  TEXT,
  source    TEXT,
  snippet   TEXT,
  rank      REAL,
  doc_type  TEXT
) LANGUAGE sql STABLE AS $$
  SELECT
    id,
    name,
    category,
    source,
    ts_headline(
      'spanish',
      immutable_unaccent(content),
      plainto_tsquery('spanish', immutable_unaccent(query_text)),
      'MaxWords=80, MinWords=40, StartSel=«, StopSel=»'
    ) AS snippet,
    ts_rank(
      to_tsvector('spanish', immutable_unaccent(content)),
      plainto_tsquery('spanish', immutable_unaccent(query_text))
    ) AS rank,
    'biblioteca'::TEXT AS doc_type
  FROM legal_documents
  WHERE to_tsvector('spanish', immutable_unaccent(content))
        @@ plainto_tsquery('spanish', immutable_unaccent(query_text))

  UNION ALL

  SELECT
    id,
    name,
    NULL::TEXT  AS category,
    NULL::TEXT  AS source,
    ts_headline(
      'spanish',
      immutable_unaccent(content),
      plainto_tsquery('spanish', immutable_unaccent(query_text)),
      'MaxWords=80, MinWords=40, StartSel=«, StopSel=»'
    ) AS snippet,
    ts_rank(
      to_tsvector('spanish', immutable_unaccent(content)),
      plainto_tsquery('spanish', immutable_unaccent(query_text))
    ) AS rank,
    'sesion'::TEXT AS doc_type
  FROM session_documents
  WHERE session_documents.session_id = search_legal_docs.session_id
    AND to_tsvector('spanish', immutable_unaccent(content))
        @@ plainto_tsquery('spanish', immutable_unaccent(query_text))

  ORDER BY rank DESC
  LIMIT max_results;
$$;