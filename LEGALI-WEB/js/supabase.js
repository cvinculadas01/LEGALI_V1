// ════════════════════════════════════════════════════════════
// LEGALI — Integración Supabase
// Maneja: conversaciones, memoria jurídica, RAG con PDF
// ════════════════════════════════════════════════════════════

let supabaseClient = null;

// ── Conexión ────────────────────────────────────────────────

async function connectSupabase(url, anonKey) {
  try {
    supabaseClient = supabase.createClient(url.trim(), anonKey.trim());
    const { error } = await supabaseClient
      .from("legal_documents")
      .select("id")
      .limit(1);
    if (error && error.code !== "PGRST116") throw error;
    return { ok: true };
  } catch (e) {
    supabaseClient = null;
    return { ok: false, error: e.message };
  }
}

// ── Conversaciones ──────────────────────────────────────────

async function saveMessage(sessionId, role, content, provider, model) {
  if (!supabaseClient) return;
  await supabaseClient.from("conversations").insert({
    session_id: sessionId, role, content, provider, model,
  });
}

async function loadConversation(sessionId) {
  if (!supabaseClient) return [];
  const { data } = await supabaseClient
    .from("conversations")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  return data || [];
}

async function deleteConversation(sessionId) {
  if (!supabaseClient) return;
  await supabaseClient.from("conversations").delete().eq("session_id", sessionId);
  await supabaseClient.from("legal_memory").delete().eq("session_id", sessionId);
  await supabaseClient.from("session_documents").delete().eq("session_id", sessionId);
}

// ── Memoria jurídica ────────────────────────────────────────

async function saveConsultation(sessionId, query, literalSource, analysis) {
  if (!supabaseClient || !analysis || analysis.length < 20) return;
  await supabaseClient.from("legal_memory").insert({
    session_id: sessionId,
    query,
    literal_source: literalSource || "",
    analysis,
  });
}

async function searchMemory(sessionId, query) {
  if (!supabaseClient) return null;
  const { data } = await supabaseClient
    .from("legal_memory")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (!data) return null;
  const q = query.toLowerCase().slice(0, 40);
  return data.find(e =>
    e.query.toLowerCase().includes(q) || q.includes(e.query.toLowerCase().slice(0, 30))
  ) || null;
}

// ── Búsqueda RAG con full-text search ──────────────────────

async function searchDocs(sessionId, query) {
  if (!supabaseClient) return { snippets: "", sources: [] };

  try {
    const { data, error } = await supabaseClient
      .rpc("search_legal_docs", {
        query_text: query,
        session_id: sessionId,
        max_results: 6,
      });

    if (error || !data || !data.length) return { snippets: "", sources: [] };

    const sources = data.map(d => ({
      name: d.name,
      category: d.category || "Documento de sesión",
      source: d.source || null,
      doc_type: d.doc_type,
      snippet: d.snippet,
    }));

    const snippets = data.map(d =>
      `--- [${d.category || d.name}] ---\n${d.snippet}`
    ).join("\n\n");

    return { snippets, sources };
  } catch (e) {
    console.error("Error búsqueda RAG:", e);
    return { snippets: "", sources: [] };
  }
}

// ── Subir documento de sesión (usuario en el chat) ──────────

async function saveSessionDocument(sessionId, name, content, fileSize) {
  if (!supabaseClient) return false;
  const { error } = await supabaseClient.from("session_documents").insert({
    session_id: sessionId,
    name,
    content,
    file_size: fileSize,
  });
  return !error;
}

// ── Subir documento a biblioteca global (admin) ─────────────

async function saveLibraryDocument(name, content, category, source, pages, fileSize) {
  if (!supabaseClient) return { ok: false, error: "Sin conexión a Supabase" };
  const { error } = await supabaseClient.from("legal_documents").insert({
    name,
    content,
    category: category || "General",
    source: source || null,
    pages: pages || null,
    file_size: fileSize,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Listar biblioteca global ────────────────────────────────

async function listLibraryDocs() {
  if (!supabaseClient) return [];
  const { data } = await supabaseClient
    .from("legal_documents")
    .select("id, name, category, source, pages, file_size, created_at")
    .order("created_at", { ascending: false });
  return data || [];
}

async function deleteLibraryDoc(id) {
  if (!supabaseClient) return false;
  const { error } = await supabaseClient.from("legal_documents").delete().eq("id", id);
  return !error;
}

// ── Listar documentos de sesión ─────────────────────────────

async function listSessionDocs(sessionId) {
  if (!supabaseClient) return [];
  const { data } = await supabaseClient
    .from("session_documents")
    .select("id, name, file_size, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });
  return data || [];
}

// ── Búsqueda local (sin Supabase) ───────────────────────────

function searchLocalDocs(localDocs, query) {
  if (!localDocs.length) return { snippets: "", sources: [] };
  const kwRegex = /(ley\s+\d+|art[íi]culo\s+\d+|decreto\s+\d+|\d{4})/gi;
  const keywords = [...(query.matchAll(kwRegex))].map(m => m[0].toLowerCase());
  const fragments = [];
  const sources = [];

  for (const doc of localDocs) {
    if (!keywords.length) {
      fragments.push(`--- [${doc.name}] ---\n${doc.content.slice(0, 1500)}`);
      sources.push({ name: doc.name, category: "Local", doc_type: "local" });
      break;
    }
    for (const kw of keywords) {
      const idx = doc.content.toLowerCase().indexOf(kw);
      if (idx !== -1) {
        const start = Math.max(0, idx - 300);
        const end   = Math.min(doc.content.length, idx + 1500);
        fragments.push(`--- [${doc.name}] ---\n${doc.content.slice(start, end)}`);
        sources.push({ name: doc.name, category: "Local", doc_type: "local" });
        break;
      }
    }
  }
  return { snippets: fragments.join("\n\n"), sources };
}
