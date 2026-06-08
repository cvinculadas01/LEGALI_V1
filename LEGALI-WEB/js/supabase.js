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

  const allSources  = [];
  const allSnippets = [];

  // ── 1. Buscar en session_documents de esta sesión ──────────
  try {
    const { data: sessionDocs } = await supabaseClient
      .from("session_documents")
      .select("id, name, content, file_size")
      .eq("session_id", sessionId);

    if (sessionDocs && sessionDocs.length) {
      const result = searchLocalDocs(sessionDocs.map(d => ({ name: d.name, content: d.content })), query);
      if (result.snippets) {
        allSnippets.push(result.snippets);
        allSources.push(...result.sources);
      }
    }
  } catch (e) {
    console.warn("Error cargando session_documents:", e);
  }

  // ── 2. Buscar en biblioteca global via RPC ──────────────────
  try {
    const { data, error } = await supabaseClient
      .rpc("search_legal_docs", {
        query_text: query,
        session_id: sessionId,
        max_results: 6,
      });

    if (!error && data && data.length) {
      const libSources  = data.map(d => ({
        name: d.name,
        category: d.category || "Biblioteca",
        source: d.source || null,
        doc_type: d.doc_type || "biblioteca",
        snippet: d.snippet,
      }));
      const libSnippets = data.map(d =>
        `--- [${d.category || d.name}] ---\n${d.snippet}`
      ).join("\n\n");

      allSources.push(...libSources);
      if (libSnippets) allSnippets.push(libSnippets);
    }
  } catch (e) {
    console.warn("Error búsqueda RAG biblioteca:", e);
  }

  return {
    snippets: allSnippets.join("\n\n"),
    sources:  allSources,
  };
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

  // Extraer keywords legales específicas
  const kwRegex = /(ley\s+\d+|art[íi]culo\s+\d+|decreto\s+\d+|\d{4})/gi;
  const legalKws = [...(query.matchAll(kwRegex))].map(m => m[0].toLowerCase());

  // También extraer palabras clave genéricas (palabras de más de 4 letras, sin stopwords)
  const stopwords = new Set(["para","como","este","esta","sobre","desde","hasta","entre","tiene","cuál","cual","cómo","como","qué","que","son","los","las","del","una","uno","con","por","sin","hay","más","mas"]);
  const genericKws = query.toLowerCase()
    .replace(/[^\w\sáéíóúüñ]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 4 && !stopwords.has(w));

  const allKeywords = [...new Set([...legalKws, ...genericKws])];

  const fragments = [];
  const sources = [];
  const SNIPPET_SIZE = 1500;
  const CONTEXT_PAD  = 300;

  for (const doc of localDocs) {
    const lower = doc.content.toLowerCase();
    let bestIdx = -1;

    // Buscar la primera keyword que aparezca en el documento
    for (const kw of allKeywords) {
      const idx = lower.indexOf(kw);
      if (idx !== -1) { bestIdx = idx; break; }
    }

    if (bestIdx !== -1) {
      // Encontró una coincidencia – extraer fragmento con contexto
      const start = Math.max(0, bestIdx - CONTEXT_PAD);
      const end   = Math.min(doc.content.length, bestIdx + SNIPPET_SIZE);
      fragments.push(`--- [${doc.name}] ---\n${doc.content.slice(start, end)}`);
    } else {
      // Sin coincidencia directa – incluir inicio del documento como contexto general
      fragments.push(`--- [${doc.name}] ---\n${doc.content.slice(0, SNIPPET_SIZE)}`);
    }

    sources.push({ name: doc.name, category: "Documento de sesión", doc_type: "session" });
  }

  return { snippets: fragments.join("\n\n"), sources };
}
