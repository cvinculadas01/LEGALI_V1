// ============================================================
// LEGALI v2.0 — js/supabase.js
// Cliente Supabase: RAG, conversaciones, session docs, logs
// ============================================================

'use strict';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Guardar mensaje en conversación ──────────────────────────
async function saveMessage({ sessionId, role, content, tokensUsed = 0 }) {
  const user = window.LEGALI_USER;
  if (!user) return;

  try {
    const { error } = await supabaseClient
      .from('conversations')
      .insert({
        user_id:     user.id,
        session_id:  sessionId,
        role,
        content,
        tokens_used: tokensUsed,
      });
    if (error) throw error;
  } catch (e) {
    console.error('saveMessage error:', e);
  }
}

// ── Cargar historial de conversación ─────────────────────────
async function loadConversation(sessionId, limit = 20) {
  const user = window.LEGALI_USER;
  if (!user) return [];

  try {
    const { data, error } = await supabaseClient
      .from('conversations')
      .select('role, content, created_at')
      .eq('user_id', user.id)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('loadConversation error:', e);
    return [];
  }
}

// ── Buscar documentos RAG ────────────────────────────────────
async function searchDocs(queryText, sessionId = null, maxResults = RAG_CONFIG.maxResults) {
  if (!queryText || queryText.trim().length < 3) return [];

  try {
    const { data, error } = await supabaseClient.rpc('search_legal_docs', {
      query_text:   queryText.trim(),
      p_session_id: sessionId,
      max_results:  maxResults,
    });

    if (error) throw error;
    return (data || []).filter(d => d.rank > RAG_CONFIG.minRank);
  } catch (e) {
    console.error('searchDocs error:', e);
    return [];
  }
}

// ── Construir contexto RAG para inyectar en prompt ────────────
function buildRagContext(docs) {
  if (!docs || docs.length === 0) return null;

  let context    = '## Documentos jurídicos relevantes\n\n';
  let totalChars = 0;

  for (const doc of docs) {
    const header  = `### ${doc.title || 'Documento'}${doc.category ? ` (${doc.category})` : ''}\n`;
    const content = doc.content.slice(0, 800) + (doc.content.length > 800 ? '…' : '');
    const block   = header + content + '\n\n';

    if (totalChars + block.length > RAG_CONFIG.maxChars) break;
    context    += block;
    totalChars += block.length;
  }

  return totalChars > 0 ? context : null;
}

// ── Guardar documento de sesión ───────────────────────────────
async function saveSessionDocument({ sessionId, filename, content, sizeBytes = 0 }) {
  const user = window.LEGALI_USER;
  if (!user) return null;

  try {
    const { data, error } = await supabaseClient
      .from('session_documents')
      .insert({
        user_id:    user.id,
        session_id: sessionId,
        filename,
        content,
        size_bytes: sizeBytes,
      })
      .select('id, filename, size_bytes, created_at')
      .single();

    if (error) throw error;
    return data;
  } catch (e) {
    console.error('saveSessionDocument error:', e);
    return null;
  }
}

// ── Listar documentos de sesión activa ───────────────────────
async function listSessionDocuments(sessionId) {
  const user = window.LEGALI_USER;
  if (!user) return [];

  try {
    const { data, error } = await supabaseClient
      .from('session_documents')
      .select('id, filename, size_bytes, created_at')
      .eq('user_id', user.id)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('listSessionDocuments error:', e);
    return [];
  }
}

// ── Eliminar documento de sesión ─────────────────────────────
async function deleteSessionDocument(docId) {
  try {
    const { error } = await supabaseClient
      .from('session_documents')
      .delete()
      .eq('id', docId)
      .eq('user_id', window.LEGALI_USER?.id);

    if (error) throw error;
    return true;
  } catch (e) {
    console.error('deleteSessionDocument error:', e);
    return false;
  }
}

// ── Registrar uso en audit_logs ───────────────────────────────
async function logUsage({ action, provider, model, tokensIn = 0, tokensOut = 0, sessionId = null, meta = null }) {
  const user = window.LEGALI_USER;
  if (!user) return;

  try {
    await supabaseClient.from('audit_logs').insert({
      user_id:    user.id,
      action,
      provider,
      model,
      tokens_in:  tokensIn,
      tokens_out: tokensOut,
      session_id: sessionId,
      meta,
    });
  } catch (e) {
    console.warn('logUsage error:', e);
  }
}
