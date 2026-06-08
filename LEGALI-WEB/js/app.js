// ════════════════════════════════════════════════════════════
// LEGALI — Lógica principal de la aplicación 
// ════════════════════════════════════════════════════════════

// ── Estado global ────────────────────────────────────────────
const STATE = {
  sessionId:   localStorage.getItem("legali_session") || crypto.randomUUID(),
  messages:    [],
  provider:    "groq",
  localDocs:   [],          // docs en memoria (sin Supabase)
  pendingFiles: [],         // archivos esperando metadatos
  isStreaming:  false,
};
localStorage.setItem("legali_session", STATE.sessionId);

// ── DOM refs ─────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const chatHistory    = $("chatHistory");
const userInput      = $("userInput");
const sendBtn        = $("sendBtn");
const welcome        = $("welcome");
const suggestions    = $("suggestions");
const areaGrid       = $("areaGrid");
const btnNewChat     = $("btnNewChat");
const btnConnect     = $("btnConnect");
const sbStatus       = $("sb-status");
const sidebar        = $("sidebar");
const ragIndicator   = $("ragIndicator");

// ── Init ─────────────────────────────────────────────────────
function init() {
  buildSuggestions();
  buildAreas();
  setupProviderSwitcher();
  setupInput();
  setupSupabaseConnect();
  setupLibraryUpload();
  setupSessionUpload();
  setupNewChat();
  $("sidebarToggle").addEventListener("click", () => sidebar.classList.toggle("open"));
  $("btnToggleLib").addEventListener("click", toggleLibraryPanel);
  loadSavedKeys();
  autoConnectSupabase();
}

// ── Auto-conexión Supabase al cargar ──────────────────────────
async function autoConnectSupabase() {
  // Prioridad: localStorage → constantes del código
  const url = localStorage.getItem("legali_sb-url") || (typeof SUPABASE_URL !== "undefined" ? SUPABASE_URL : "");
  const key = localStorage.getItem("legali_sb-key") || (typeof SUPABASE_KEY !== "undefined" ? SUPABASE_KEY : "");

  if (!url || !key || key.includes("REEMPLAZA")) return;

  // Rellenar campos visualmente
  $("sb-url").value = url;
  $("sb-key").value = key;

  sbStatus.innerHTML = '<span style="color:#5A9AE0">Conectando…</span>';

  const result = await connectSupabase(url, key);

  if (result.ok) {
    // Guardar en localStorage para próximas visitas
    localStorage.setItem("legali_sb-url", url);
    localStorage.setItem("legali_sb-key", key);

    sbStatus.innerHTML = '<span style="color:#2DD4A4">✅ Conectado automáticamente</span>';

    // Cargar historial previo
    const history = await loadConversation(STATE.sessionId);
    if (history.length) {
      STATE.messages = history.map(r => ({ role: r.role, content: r.content }));
      history.forEach(r => appendMessage(r.role, r.content, false));
      welcome.style.display = "none";
    }

    // Cargar biblioteca y docs de sesión
    await refreshLibrary();
    await refreshSessionDocs();
  } else {
    sbStatus.innerHTML = '<span style="color:#F87171">⚠️ Error de conexión — revisa tus credenciales</span>';
  }
}

// ── Sugerencias ──────────────────────────────────────────────
function buildSuggestions() {
  suggestions.innerHTML = "";
  SUGGESTIONS.forEach(({ text }) => {
    const btn = document.createElement("button");
    btn.className = "sugg-btn";
    btn.textContent = text.length > 70 ? text.slice(0, 68) + "…" : text;
    btn.onclick = () => sendMessage(text);
    suggestions.appendChild(btn);
  });
}

// ── Áreas ────────────────────────────────────────────────────
function buildAreas() {
  areaGrid.innerHTML = "";
  AREAS.forEach(area => {
    const btn = document.createElement("button");
    btn.className = "area-btn";
    btn.textContent = area;
    btn.onclick = () => {
      const nombre = area.split(" ").slice(1).join(" ");
      sendMessage(`Necesito información sobre Derecho ${nombre} en Colombia.`);
      if (window.innerWidth <= 768) sidebar.classList.remove("open");
    };
    areaGrid.appendChild(btn);
  });
}

// ── Provider switcher ─────────────────────────────────────────
function setupProviderSwitcher() {
  $("providerList").querySelectorAll(".prov-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      STATE.provider = btn.dataset.prov;
      $("providerList").querySelectorAll(".prov-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      ["groq","anthropic","openai","google"].forEach(p => {
        $(`cfg-${p}`).classList.toggle("hidden", p !== STATE.provider);
      });
    });
  });
}

// ── Keys persistidas ──────────────────────────────────────────
function loadSavedKeys() {
  ["groq-key","anthropic-key","openai-key","google-key","sb-url","sb-key"].forEach(id => {
    const v = localStorage.getItem(`legali_${id}`);
    if (v && $(id)) $(id).value = v;
  });
}
["groq-key","anthropic-key","openai-key","google-key","sb-url","sb-key"].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener("change", () => {
    if (el.value) localStorage.setItem(`legali_${id}`, el.value);
  });
});

// ── Supabase connect ──────────────────────────────────────────
function setupSupabaseConnect() {
  btnConnect.addEventListener("click", async () => {
    const url = $("sb-url").value.trim();
    const key = $("sb-key").value.trim();
    if (!url || !key) { sbStatus.textContent = "⚠️ Ingresa URL y anon key."; return; }

    sbStatus.innerHTML = '<span style="color:#5A9AE0">Conectando…</span>';
    btnConnect.disabled = true;

    const result = await connectSupabase(url, key);
    btnConnect.disabled = false;

    if (result.ok) {
      sbStatus.innerHTML = '<span style="color:#2DD4A4">✅ Conectado — Base de datos activa</span>';
      // Cargar historial
      const history = await loadConversation(STATE.sessionId);
      if (history.length) {
        STATE.messages = history.map(r => ({ role: r.role, content: r.content }));
        history.forEach(r => appendMessage(r.role, r.content, false));
        welcome.style.display = "none";
      }
      // Cargar biblioteca
      await refreshLibrary();
      // Cargar docs de sesión
      await refreshSessionDocs();
    } else {
      sbStatus.innerHTML = `<span style="color:#F87171">❌ ${result.error}</span>`;
    }
  });
}

// ── Biblioteca global ─────────────────────────────────────────

let libraryVisible = true;

function toggleLibraryPanel() {
  libraryVisible = !libraryVisible;
  $("libraryPanel").style.display = libraryVisible ? "" : "none";
  $("btnToggleLib").textContent = libraryVisible ? "▾" : "▸";
}

async function refreshLibrary() {
  if (!supabaseClient) return;
  const docs = await listLibraryDocs();
  const libList  = $("libList");
  const libStats = $("libStats");
  libList.innerHTML = "";

  if (docs.length === 0) {
    libStats.textContent = "Biblioteca vacía — sube tu primer documento";
    libStats.classList.add("visible");
    return;
  }

  libStats.textContent = `📚 ${docs.length} documento${docs.length > 1 ? "s" : ""} en la biblioteca`;
  libStats.classList.add("visible");

  docs.forEach(doc => {
    const item = document.createElement("div");
    item.className = "lib-item";
    const kb = doc.file_size ? Math.round(doc.file_size / 1024) : "?";
    const pg = doc.pages ? ` · ${doc.pages} págs.` : "";
    item.innerHTML = `
      <div class="lib-item-info">
        <div class="lib-item-name" title="${doc.name}">${doc.name}</div>
        <div class="lib-item-meta">${doc.category || "General"} · ${kb} KB${pg}</div>
      </div>
      <button class="btn-del-doc" data-id="${doc.id}" title="Eliminar">✕</button>
    `;
    item.querySelector(".btn-del-doc").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`¿Eliminar "${doc.name}" de la biblioteca?`)) return;
      await deleteLibraryDoc(doc.id);
      await refreshLibrary();
    });
    libList.appendChild(item);
  });
}

// ── Upload biblioteca admin ───────────────────────────────────

function setupLibraryUpload() {
  const area     = $("adminUploadArea");
  const fileInp  = $("adminFileInput");
  const meta     = $("uploadMeta");
  const progress = $("uploadProgress");
  const btnConf  = $("btnUploadConfirm");
  const btnCanc  = $("btnUploadCancel");

  // Click y drag
  area.addEventListener("click", () => fileInp.click());
  area.addEventListener("dragover", e => { e.preventDefault(); area.classList.add("drag-over"); });
  area.addEventListener("dragleave", () => area.classList.remove("drag-over"));
  area.addEventListener("drop", e => {
    e.preventDefault(); area.classList.remove("drag-over");
    handleLibFiles([...e.dataTransfer.files]);
  });
  fileInp.addEventListener("change", e => {
    handleLibFiles([...e.target.files]);
    e.target.value = "";
  });

  btnConf.addEventListener("click", async () => {
    if (!supabaseClient) { alert("Conecta Supabase primero."); return; }
    const category = $("docCategory").value;
    const source   = $("docSource").value.trim();
    if (!category) { alert("Selecciona una categoría."); return; }

    btnConf.disabled = true;

    for (const fileObj of STATE.pendingFiles) {
      showProgress(`Procesando ${fileObj.file.name}…`, 5);
      let text = "";
      let pages = null;

      if (fileObj.file.name.toLowerCase().endsWith(".pdf")) {
        const result = await extractPdfText(
          fileObj.file,
          (p, total) => showProgress(
            `Extrayendo pág. ${p} de ${total}…`,
            Math.round(5 + (p / total) * 50)
          )
        );
        text  = result.text;
        pages = result.pages;
      } else {
        text = await fileObj.file.text();
      }

      if (!text.trim()) {
        showProgress(`⚠️ ${fileObj.file.name}: no se pudo extraer texto.`, 0);
        continue;
      }

      // ── Fragmentar si supera 800 KB ──────────────────────
      const MAX_CHARS = 800_000; // ~800 KB de texto
      const chunks = splitIntoChunks(text, MAX_CHARS);
      const totalChunks = chunks.length;

      if (totalChunks === 1) {
        showProgress(`Subiendo ${fileObj.file.name}…`, 60);
        const res = await saveLibraryDocument(
          fileObj.file.name, text, category, source || null,
          pages, fileObj.file.size
        );
        if (res.ok) {
          showProgress(`✅ ${fileObj.file.name} subido correctamente`, 100);
        } else {
          showProgress(`❌ Error: ${res.error}`, 0);
        }
      } else {
        // Subir cada fragmento por separado
        showProgress(`📄 Documento grande — dividiendo en ${totalChunks} partes…`, 55);
        let allOk = true;

        for (let i = 0; i < totalChunks; i++) {
          const pct = Math.round(55 + ((i + 1) / totalChunks) * 40);
          const partName = `${fileObj.file.name} [Parte ${i + 1}/${totalChunks}]`;
          showProgress(`Subiendo ${partName}…`, pct);

          const res = await saveLibraryDocument(
            partName,
            chunks[i],
            category,
            source || null,
            pages ? Math.round(pages / totalChunks) : null,
            Math.round(fileObj.file.size / totalChunks)
          );

          if (!res.ok) {
            showProgress(`❌ Error en parte ${i + 1}: ${res.error}`, 0);
            allOk = false;
            break;
          }
        }

        if (allOk) {
          showProgress(
            `✅ ${fileObj.file.name} subido en ${totalChunks} partes`,
            100
          );
        }
      }
    }

    STATE.pendingFiles = [];
    meta.classList.add("hidden");
    btnConf.disabled = false;
    await refreshLibrary();
    setTimeout(() => progress.classList.add("hidden"), 3000);
  });

  btnCanc.addEventListener("click", () => {
    STATE.pendingFiles = [];
    meta.classList.add("hidden");
    progress.classList.add("hidden");
  });
}

function handleLibFiles(files) {
  if (!supabaseClient) { alert("Conecta Supabase primero para subir a la biblioteca."); return; }
  STATE.pendingFiles = files.map(f => ({ file: f }));
  const names = files.map(f => f.name).join(", ");
  $("adminUploadArea").querySelector("span").textContent = `📄 ${names}`;
  $("uploadMeta").classList.remove("hidden");
}

function showProgress(msg, pct) {
  const prog = $("uploadProgress");
  prog.classList.remove("hidden");
  prog.innerHTML = `
    <div>${msg}</div>
    <div class="progress-bar-wrap">
      <div class="progress-bar" style="width:${pct}%"></div>
    </div>
  `;
}

// ── Upload sesión ─────────────────────────────────────────────

function setupSessionUpload() {
  const area    = $("sessionUploadArea");
  const fileInp = $("sessionFileInput");

  area.addEventListener("click", () => fileInp.click());
  area.addEventListener("dragover", e => { e.preventDefault(); area.classList.add("drag-over"); });
  area.addEventListener("dragleave", () => area.classList.remove("drag-over"));
  area.addEventListener("drop", e => {
    e.preventDefault(); area.classList.remove("drag-over");
    [...e.dataTransfer.files].forEach(processSessionFile);
  });
  fileInp.addEventListener("change", e => {
    [...e.target.files].forEach(processSessionFile);
    e.target.value = "";
  });
}

async function processSessionFile(file) {
  let text = "";
  let pages = null;

  if (file.name.toLowerCase().endsWith(".pdf")) {
    const r = await extractPdfText(file, () => {});
    text  = r.text;
    pages = r.pages;
  } else {
    text = await file.text();
  }

  if (!text.trim()) { alert(`No se pudo extraer texto de ${file.name}.`); return; }

  if (supabaseClient) {
    await saveSessionDocument(STATE.sessionId, file.name, text, file.size);
    await refreshSessionDocs();
  } else {
    STATE.localDocs.push({ name: file.name, content: text });
    renderSessionDocList(STATE.localDocs.map(d => d.name));
  }
}

async function refreshSessionDocs() {
  const docs = await listSessionDocs(STATE.sessionId);
  renderSessionDocList(docs.map(d => d.name));
}

function renderSessionDocList(names) {
  const list = $("sessionDocList");
  list.innerHTML = "";
  names.forEach(name => {
    const div = document.createElement("div");
    div.className = "session-doc-item";
    div.innerHTML = `<span title="${name}">📎 ${name}</span>`;
    list.appendChild(div);
  });
}

// ── Extracción de texto PDF (PDF.js) ──────────────────────────

async function extractPdfText(file, onPage) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  let fullText = "";

  for (let i = 1; i <= totalPages; i++) {
    onPage(i, totalPages);
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(" ");
    fullText += `\n\n[Página ${i}]\n${pageText}`;
  }

  return { text: fullText.trim(), pages: totalPages };
}

// ── Dividir texto en fragmentos respetando párrafos ────────────
function splitIntoChunks(text, maxChars) {
  if (text.length <= maxChars) return [text];

  const chunks = [];
  // Dividir por saltos de página [Página N] para mantener coherencia
  const pageBlocks = text.split(/\n\n\[Página \d+\]/);

  let current = "";

  for (const block of pageBlocks) {
    if ((current + block).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = block;
    } else {
      current += "\n\n" + block;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  // Si aún hay fragmentos muy grandes, dividir por caracteres
  const result = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxChars) {
      result.push(chunk);
    } else {
      for (let i = 0; i < chunk.length; i += maxChars) {
        result.push(chunk.slice(i, i + maxChars));
      }
    }
  }

  return result;
}

// ── Nueva conversación ────────────────────────────────────────

function setupNewChat() {
  btnNewChat.addEventListener("click", async () => {
    if (supabaseClient) await deleteConversation(STATE.sessionId);
    STATE.messages   = [];
    STATE.localDocs  = [];
    STATE.sessionId  = crypto.randomUUID();
    localStorage.setItem("legali_session", STATE.sessionId);
    chatHistory.innerHTML = "";
    welcome.style.display = "flex";
    ragIndicator.classList.add("hidden");
    $("sessionDocList").innerHTML = "";
  });
}

// ── Chat UI ───────────────────────────────────────────────────

function setupInput() {
  userInput.addEventListener("input", () => {
    userInput.style.height = "auto";
    userInput.style.height = Math.min(userInput.scrollHeight, 200) + "px";
  });
  userInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!STATE.isStreaming) sendMessage(userInput.value);
    }
  });
  sendBtn.addEventListener("click", () => {
    if (!STATE.isStreaming) sendMessage(userInput.value);
  });
}

function appendMessage(role, content, animate = true) {
  welcome.style.display = "none";
  const msg    = document.createElement("div");
  msg.className = `msg ${role}`;

  const avatar  = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = role === "user" ? "👤" : "⚡";

  const bubble  = document.createElement("div");
  bubble.className = "msg-bubble";

  if (role === "assistant") {
    bubble.innerHTML = marked.parse(content || "");
  } else {
    bubble.textContent = content;
  }

  msg.appendChild(avatar);
  msg.appendChild(bubble);
  chatHistory.appendChild(msg);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  return bubble;
}

function appendTyping() {
  const msg    = document.createElement("div");
  msg.className = "msg assistant";
  msg.id = "typing-msg";
  const avatar  = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = "⚡";
  const bubble  = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  msg.appendChild(avatar);
  msg.appendChild(bubble);
  chatHistory.appendChild(msg);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function removeTyping() {
  const el = $("typing-msg");
  if (el) el.remove();
}

// ── Proceso de envío ──────────────────────────────────────────

async function sendMessage(text) {
  text = text.trim();
  if (!text || STATE.isStreaming) return;

  STATE.isStreaming = true;
  sendBtn.disabled  = true;
  userInput.value   = "";
  userInput.style.height = "auto";

  const provCfg = PROVIDERS_CONFIG[STATE.provider];
  const apiKey  = provCfg.apiKey();
  const model   = provCfg.model();

  if (!apiKey) {
    alert(`Ingresa tu API Key para ${provCfg.label} en el sidebar.\n\nGroq: https://console.groq.com/keys (gratuito)\nAnthropic: https://console.anthropic.com\nOpenAI: https://platform.openai.com\nGoogle: https://aistudio.google.com`);
    STATE.isStreaming = false;
    sendBtn.disabled  = false;
    return;
  }

  appendMessage("user", text);
  STATE.messages.push({ role: "user", content: text });
  if (supabaseClient) await saveMessage(STATE.sessionId, "user", text, STATE.provider, model);

  // ── 1. Búsqueda RAG ──────────────────────────────────────
  ragIndicator.innerHTML = "";
  ragIndicator.classList.add("hidden");

  let ragSnippets = "";
  let ragSources  = [];

  if (supabaseClient) {
    const result = await searchDocs(STATE.sessionId, text);
    ragSnippets = result.snippets;
    ragSources  = result.sources;
  } else if (STATE.localDocs.length) {
    const result = searchLocalDocs(STATE.localDocs, text);
    ragSnippets = result.snippets;
    ragSources  = result.sources;
  }

  // Mostrar fuentes encontradas sobre el input
  if (ragSources.length) {
    ragIndicator.classList.remove("hidden");
    ragSources.forEach(s => {
      const tag = document.createElement("span");
      tag.className = `rag-source-tag ${s.doc_type === "biblioteca" ? "global" : "session"}`;
      tag.textContent = `${s.doc_type === "biblioteca" ? "📚" : "📎"} ${s.name.slice(0, 28)}`;
      tag.title = s.name;
      ragIndicator.appendChild(tag);
    });
  }

  // ── 2. Memoria histórica ──────────────────────────────────
  let memCtx = "";
  if (supabaseClient) {
    const past = await searchMemory(STATE.sessionId, text);
    if (past) memCtx = `\n\nANTECEDENTE (${past.created_at?.slice(0,10)}):\n${past.analysis.slice(0,800)}`;
  }

  // ── 3. Construir prompt enriquecido ───────────────────────
  let contextBlock = "";
  if (ragSnippets)  contextBlock += `\n\n📄 FRAGMENTOS DE LA BASE DOCUMENTAL:\n${ragSnippets.slice(0, 4000)}`;
  if (memCtx)       contextBlock += memCtx;

  const fullPrompt = contextBlock
    ? `${contextBlock}\n\n---\nPREGUNTA:\n${text}`
    : text;

  const messagesForLLM = [
    ...STATE.messages.slice(0, -1),
    { role: "user", content: fullPrompt },
  ];

  // ── 4. Streaming ──────────────────────────────────────────
  appendTyping();

  let fullResponse = "";
  let firstToken   = true;
  let streamBubble = null;

  try {
    for await (const token of streamProvider(STATE.provider, messagesForLLM, apiKey, model)) {
      if (firstToken) {
        removeTyping();
        const msgEl = document.createElement("div");
        msgEl.className = "msg assistant";
        const av = document.createElement("div");
        av.className = "msg-avatar";
        av.textContent = "⚡";
        streamBubble = document.createElement("div");
        streamBubble.className = "msg-bubble";
        msgEl.appendChild(av);
        msgEl.appendChild(streamBubble);
        chatHistory.appendChild(msgEl);
        firstToken = false;
      }
      fullResponse += token;
      if (streamBubble) {
        streamBubble.innerHTML = marked.parse(fullResponse);
        chatHistory.scrollTop  = chatHistory.scrollHeight;
      }
    }

    // Agregar bloque de fuentes + botones de descarga
    if (streamBubble) {
      // Fuentes consultadas
      if (ragSources.length) {
        const sourcesBlock = document.createElement("div");
        sourcesBlock.className = "sources-block";
        sourcesBlock.innerHTML = `<div class="sources-block-title">📎 Fuentes consultadas</div>`;
        ragSources.forEach(s => {
          const pill = document.createElement(s.source ? "a" : "span");
          pill.className = "source-pill";
          pill.textContent = `${s.doc_type === "biblioteca" ? "📚" : "📎"} ${s.name}`;
          if (s.source) { pill.href = s.source; pill.target = "_blank"; }
          if (s.category) pill.title = s.category;
          sourcesBlock.appendChild(pill);
        });
        streamBubble.appendChild(sourcesBlock);
      }

      // Botones de descarga
      if (fullResponse && fullResponse.length > 50) {
        const dlBlock = document.createElement("div");
        dlBlock.className = "download-block";

        const title = extractDocTitle(text);

        const btnPdf = document.createElement("button");
        btnPdf.className = "btn-download btn-download-pdf";
        btnPdf.innerHTML = "📋 Descargar PDF";
        btnPdf.onclick = () => downloadAsPDF(fullResponse, title);

        const btnWord = document.createElement("button");
        btnWord.className = "btn-download btn-download-word";
        btnWord.innerHTML = "📄 Descargar Word";
        btnWord.onclick = () => downloadAsWord(fullResponse, title);

        dlBlock.appendChild(btnPdf);
        dlBlock.appendChild(btnWord);
        streamBubble.appendChild(dlBlock);
      }
    }

  } catch (e) {
    removeTyping();
    appendMessage("assistant", `❌ Error: ${e.message}`);
    fullResponse = `Error: ${e.message}`;
  }

  if (firstToken) removeTyping();

  // ── 5. Guardar ────────────────────────────────────────────
  if (fullResponse) {
    STATE.messages.push({ role: "assistant", content: fullResponse });
    if (supabaseClient) {
      await saveMessage(STATE.sessionId, "assistant", fullResponse, STATE.provider, model);
      await saveConsultation(STATE.sessionId, text, ragSnippets.slice(0, 500), fullResponse);
    }
  }

  STATE.isStreaming = false;
  sendBtn.disabled  = false;
  userInput.focus();
}

document.addEventListener("DOMContentLoaded", init);

// ════════════════════════════════════════════════════════════
// LEGALI — Exportación de respuestas a PDF y Word
// ════════════════════════════════════════════════════════════

// ── Extraer título del documento desde la pregunta ───────────
function extractDocTitle(question) {
  const clean = question.trim().replace(/[\\/:*?"<>|]/g, "").slice(0, 60);
  return clean || "Consulta-LEGALI";
}

// ── Limpiar caracteres especiales que jsPDF no puede renderizar ──
// jsPDF con fuentes estándar (Helvetica/Courier) solo soporta Latin-1 básico
// (U+0020–U+007E) más algunos caracteres Latin Extended-A con acento.
// Todo lo demás produce glifos corruptos o símbolos sin sentido.
function stripEmojis(str) {
  if (!str) return "";
  return str
    // ── 1. Emojis y símbolos Unicode fuera de Latin-1 ──────────
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")   // Emojis misceláneos
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")   // Emojis de símbolos/naturaleza
    .replace(/[\u{2600}-\u{26FF}]/gu, "")      // Misceláneos (☀ ☁ ✂ etc.)
    .replace(/[\u{2700}-\u{27BF}]/gu, "")      // Dingbats (✦ ✧ ✨ etc.)
    .replace(/[\u{2300}-\u{23FF}]/gu, "")      // Símbolos técnicos misceláneos
    .replace(/[\u{2B00}-\u{2BFF}]/gu, "")      // Flechas suplementarias
    .replace(/[\u{1F100}-\u{1F1FF}]/gu, "")   // Enclosed alphanumerics supplement

    // ── 2. Caracteres Latin Extended que Helvetica NO tiene glifo ──
    // Bloque Latin Extended-B y caracteres sueltos problemáticos:
    // þ Þ (U+00FE/U+00DE), ð Ð (U+00F0/U+00D0), ß (U+00DF),
    // Ø ø (U+00D8/U+00F8), Ý ý (U+00DD/U+00FD), â ã ä å (etc.)
    // La estrategia es transliterar los más comunes en vez de borrarlos.
    .replace(/[ÀÁÂÃÄÅàáâãäå]/g, (c) => {
      const m = { "À":"A","Á":"A","Â":"A","Ã":"A","Ä":"A","Å":"A",
                  "à":"a","á":"a","â":"a","ã":"a","ä":"a","å":"a" };
      return m[c] || "a";
    })
    .replace(/[ÈÉÊËèéêë]/g, (c) => {
      const m = { "È":"E","É":"E","Ê":"E","Ë":"E","è":"e","é":"e","ê":"e","ë":"e" };
      return m[c] || "e";
    })
    .replace(/[ÌÍÎÏìíîï]/g, (c) => {
      const m = { "Ì":"I","Í":"I","Î":"I","Ï":"I","ì":"i","í":"i","î":"i","ï":"i" };
      return m[c] || "i";
    })
    .replace(/[ÒÓÔÕÖØòóôõöø]/g, (c) => {
      const m = { "Ò":"O","Ó":"O","Ô":"O","Õ":"O","Ö":"O","Ø":"O",
                  "ò":"o","ó":"o","ô":"o","õ":"o","ö":"o","ø":"o" };
      return m[c] || "o";
    })
    .replace(/[ÙÚÛÜùúûü]/g, (c) => {
      const m = { "Ù":"U","Ú":"U","Û":"U","Ü":"U","ù":"u","ú":"u","û":"u","ü":"u" };
      return m[c] || "u";
    })
    .replace(/[ÝýÿŸ]/g,  "y")
    .replace(/[ÑñŃń]/g,  (c) => /[ÑÑ]/.test(c) ? "N" : "n")
    .replace(/[ÇçĆć]/g,  (c) => /[ÇĆ]/.test(c) ? "C" : "c")
    .replace(/[þÞ]/g,    "")   // thorn — no tiene equivalente útil
    .replace(/[ðÐ]/g,    "d")  // eth → d
    .replace(/[ß]/g,     "ss") // eszett → ss
    .replace(/[œŒ]/g,    (c) => c === "Œ" ? "OE" : "oe")
    .replace(/[æÆ]/g,    (c) => c === "Æ" ? "AE" : "ae")

    // ── 3. Símbolos de flechas → texto ASCII ───────────────────
    .replace(/[→⇒⟹⟶▶►]/g, "->")
    .replace(/[←⇐⟵◀◄]/g,  "<-")
    .replace(/[↑⇑]/g,       "^")
    .replace(/[↓⇓]/g,       "v")
    .replace(/[↔⇔]/g,       "<->")

    // ── 4. Símbolos decorativos de listas/viñetas ──────────────
    .replace(/[•·‣⁃]/g,                   "-")
    .replace(/[◈◉◊○●◐◑◒◓◔◕◦]/g,          "*")
    .replace(/[▸▶▷▻▾▿▼▽►]/g,              ">")
    .replace(/[✓✔☑]/g,                    "[x]")
    .replace(/[✗✘☒]/g,                    "[ ]")
    .replace(/[★☆✩✪✫✬✭✮✯✰✦✧]/g,          "*")

    // ── 5. Símbolos de advertencia/riesgo frecuentes en el LLM ─
    // Ø=Ý4  Ø=ßá  Ø=ßâ  son secuencias de chars corruptos que llegan juntos
    // Los limpiamos capturando el patrón Ø seguido de = y cualquier caracter
    .replace(/Ø[=]?[ÝÞßàáâãäåæ]?\d?/g, "")

    // ── 6. Otros símbolos misceláneos problemáticos ────────────
    .replace(/[«»‹›„""'']/g,  '"')  // comillas especiales → ASCII
    .replace(/[–—]/g,         "-")  // guiones largos → guion simple
    .replace(/[…]/g,          "...") // elipsis → 3 puntos
    .replace(/[™®©]/g,        "")
    .replace(/[§¶†‡]/g,       "")
    .replace(/[°]/g,          " grados")
    .replace(/[¿¡]/g,         "")   // signos invertidos españoles — jsPDF los pierde

    // ── 7. Caracteres de control y no imprimibles ──────────────
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")

    // ── 8. Limpiar espacios múltiples resultantes ──────────────
    .replace(/ {2,}/g, " ")
    .trim();
}

// ── Normalizar texto raw de la IA antes de parsear ────────────
// Convierte patrones decorativos/especiales en Markdown limpio
function normalizeMd(md) {
  return md
    // ── PASO 0: Eliminar secuencias corruptas de chars Latin-Extended ──
    // El LLM a veces produce bloques como "Ø=Ý4 RIESGO" o "Ø=ßá TÁCTICA"
    // que son combinaciones de chars extendidos sin glifo en Helvetica.
    // Los capturamos con un patrón genérico antes de cualquier otra limpieza.
    .replace(/[ØÙÚÛÜÝÞßàáâãäåæ][=]?[ØÙÚÛÜÝÞßàáâãäåæ0-9]?/g, "")

    // ── PASO 1: Eliminar caracteres decorativos al INICIO de línea ──
    // Ej: "þ ADVERTENCIA" → "ADVERTENCIA"
    //     "$` LEGITIMACIÓN" → "LEGITIMACIÓN"
    //     "%¡ checklist" → "checklist"
    //     "' Verificar" → "Verificar"
    //     "& EXCEPCIÓN" → "EXCEPCION"
    .replace(/^[ \t]*[þÞ$%&'][`a-zA-Z!¡°]?[ \t]*/gm, "")

    // ── PASO 2: Eliminar símbolos sueltos de advertencia/riesgo ──
    // Ej: "Ô RIESGO" → "RIESGO"  "ô TÁCTICA" → "TACTICA"
    .replace(/^[ \t]*[ÔôÃãÄäÅå!¡][ \t]+/gm, "")

    // ── PASO 3: Viñetas no estándar → "- " ────────────────────
    // Ej: "• texto" → "- texto"   "' texto" → "- texto"
    .replace(/^([ \t]*)[•·‣⁃''′‚]\s+/gm, "$1- ")

    // ── PASO 4: Flechas de flujo de proceso → " -> " ──────────
    // Ej: "[1] DEMANDA !' Art. 25" → "[1] DEMANDA -> Art. 25"
    .replace(/[ \t]*!["'][ \t]*/g, " -> ")
    .replace(/[ \t]*!'?[ \t]*/g,   " -> ")

    // ── PASO 5: Eliminar líneas que SOLO son conectores verticales ──
    // Ej: línea con solo "     !"  o "     !'"
    .replace(/^[ \t]*!["'][ \t]*$/gm, "")
    .replace(/^[ \t]*["'][ \t]*$/gm, "")

    // ── PASO 6: Bloques de flujo muy indentados → quitar indent ──
    .replace(/^[ \t]{2,}(\[.+\].*)/gm, "$1")
    .replace(/^[ \t]{2,}(\(.+\).*)/gm, "$1")

    // ── PASO 7: Líneas que comienzan con "NN" seguido de texto ──
    // El LLM a veces emite "  NN RIESGO 1 - ..." con chars corruptos
    .replace(/^[ \t]*[A-Z]{1,2}\d?[ \t]+(?=[A-ZÁÉÍÓÚ])/gm, "")

    // ── PASO 8: Separadores decorativos ───────────────────────
    .replace(/^[ \t]*[─═━]{3,}[ \t]*$/gm, "---")

    // ── PASO 9: Guiones largos en prosa ───────────────────────
    .replace(/\s—\s/g, " - ")
    .replace(/—/g,     " - ")

    // ── PASO 10: Líneas que son SOLO simbolos no alfanuméricos ──
    // Limpia líneas como "%%%%%" o "!!!!!" que no aportan contenido
    .replace(/^[ \t]*[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\[\]#\-*>|.,:;(){}'"\/\\]+[ \t]*$/gm, "")

    // ── PASO 11: Colapsar 3+ líneas en blanco a máximo 2 ──────
    .replace(/\n{3,}/g, "\n\n");
}

// ── Parser Markdown a tokens estructurados ────────────────────
function parseMdTokens(md) {
  const tokens = [];

  // Pre-normalizar antes de parsear
  const normalized = normalizeMd(md);
  const lines = normalized.split("\n");
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // --- Encabezado Setext (== o --)
    if (i + 1 < lines.length && /^[=]{2,}$/.test(lines[i + 1].trim())) {
      tokens.push({ type: "heading", level: 1, text: line.trim() });
      i += 2; continue;
    }
    if (i + 1 < lines.length && /^[-]{2,}$/.test(lines[i + 1].trim()) && line.trim()) {
      tokens.push({ type: "heading", level: 2, text: line.trim() });
      i += 2; continue;
    }

    // --- Encabezado ATX  # ## ###
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      tokens.push({ type: "heading", level: hMatch[1].length, text: hMatch[2].trim() });
      i++; continue;
    }

    // --- Separador horizontal (--- o ═══)
    if (/^[-─═*_]{3,}$/.test(line.trim())) {
      tokens.push({ type: "hr" });
      i++; continue;
    }

    // --- Tabla Markdown
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\|[-| :]+\|/.test(lines[i + 1])) {
      const header = line.trim().split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map(c => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map(c => c.trim());
        rows.push(cells);
        i++;
      }
      tokens.push({ type: "table", header, rows });
      continue;
    }

    // --- Lista con viñeta (- * + •)
    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.+)/);
    if (bulletMatch) {
      const level = Math.floor(bulletMatch[1].length / 2);
      tokens.push({ type: "bullet", level, text: bulletMatch[2].trim() });
      i++; continue;
    }

    // --- Lista numerada
    const numMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (numMatch) {
      const level = Math.floor(numMatch[1].length / 2);
      tokens.push({ type: "ordered", level, text: numMatch[2].trim() });
      i++; continue;
    }

    // --- Blockquote
    const bqMatch = line.match(/^>\s*(.*)/);
    if (bqMatch) {
      tokens.push({ type: "blockquote", text: bqMatch[1].trim() });
      i++; continue;
    }

    // --- Línea vacía
    if (!line.trim()) {
      tokens.push({ type: "blank" });
      i++; continue;
    }

    // --- Bloque de código con triple backtick
    if (line.trimStart().startsWith("```")) {
      i++;
      const codeLines = [];
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      tokens.push({ type: "code", text: codeLines.join("\n") });
      i++; continue;
    }

    // --- Párrafo normal (incluye líneas con [N] -> texto de flujo)
    tokens.push({ type: "paragraph", text: line.trim() });
    i++;
  }
  return tokens;
}

// ── Limpiar inline Markdown y símbolos decorativos ───────────
function cleanInline(str) {
  if (!str) return "";
  // Primero quitar Markdown inline
  let s = str
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g,     "$1")
    .replace(/\*(.+?)\*/g,         "$1")
    .replace(/__(.+?)__/g,         "$1")
    .replace(/_(.+?)_/g,           "$1")
    .replace(/`(.+?)`/g,           "$1")
    .replace(/\[(.+?)\]\(.+?\)/g,  "$1")
    .replace(/~~(.+?)~~/g,         "$1")
    // Flechas de flujo residuales
    .replace(/[ \t]*!["'][ \t]*/g, " -> ");
  // Luego pasar por stripEmojis para limpieza completa de caracteres
  return stripEmojis(s);
}

// ── Descargar como PDF (usando jsPDF) ─────────────────────────
async function downloadAsPDF(markdownText, title) {
  if (typeof window.jspdf === "undefined") {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  }

  const { jsPDF } = window.jspdf;
  const doc    = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW  = doc.internal.pageSize.getWidth();
  const pageH  = doc.internal.pageSize.getHeight();
  const mLeft  = 18;
  const mRight = 18;
  const mBot   = 20;
  const maxW   = pageW - mLeft - mRight;
  const BLUE   = [27, 79, 216];
  const DARK   = [30, 30, 40];
  const GREY   = [110, 120, 140];
  const LGREY  = [200, 210, 225];

  // Paleta de colores para tabla
  const TBL_HEAD_BG  = [27, 79, 216];
  const TBL_HEAD_TXT = [255, 255, 255];
  const TBL_ROW_ALT  = [241, 245, 253];
  const TBL_BORDER   = [200, 212, 235];

  let y = 0;
  let page = 1;

  // ── Helpers ─────────────────────────────────────────────────
  function drawHeader() {
    // Banda azul
    doc.setFillColor(...BLUE);
    doc.rect(0, 0, pageW, 16, "F");
    // Logo texto (sin emoji)
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("LEGALI  -  Asistente Juridico Colombia", mLeft, 10.5);
    // Fecha
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const fecha = new Date().toLocaleDateString("es-CO", { year: "numeric", month: "long", day: "numeric" });
    doc.text(fecha, pageW - mRight, 10.5, { align: "right" });
    y = 24;
  }

  function drawPageHeader() {
    doc.setFillColor(...BLUE);
    doc.rect(0, 0, pageW, 12, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("LEGALI  -  Continuacion", mLeft, 8.5);
    doc.setFont("helvetica", "normal");
    doc.text(`Pag. ${doc.internal.getCurrentPageInfo().pageNumber}`, pageW - mRight, 8.5, { align: "right" });
    y = 20;
  }

  function drawFooter() {
    doc.setFillColor(245, 247, 252);
    doc.rect(0, pageH - 10, pageW, 10, "F");
    doc.setDrawColor(...LGREY);
    doc.line(mLeft, pageH - 10, pageW - mRight, pageH - 10);
    doc.setTextColor(...GREY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text("LEGALI proporciona orientacion general. No reemplaza asesoria de abogado habilitado.", mLeft, pageH - 4);
    doc.text(`Pagina ${page}`, pageW - mRight, pageH - 4, { align: "right" });
  }

  function checkY(needed = 8) {
    if (y + needed > pageH - mBot) {
      // No dibujar footer aquí — se dibuja en el bucle final para todas las páginas
      doc.addPage();
      page++;
      drawPageHeader();
    }
  }

  function writeLine(text, opts = {}) {
    const {
      fontSize = 10, fontStyle = "normal", color = DARK,
      indent = 0, lineH = 5.5, align = "left",
    } = opts;
    // CRÍTICO: setear font ANTES de splitTextToSize para que jsPDF mida correctamente
    doc.setFont("helvetica", fontStyle);
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);
    // Ancho disponible = maxW menos el indent, con 1mm de buffer de seguridad
    const avail = maxW - indent - 1;
    const wrapped = doc.splitTextToSize(text || " ", avail);
    for (const wl of wrapped) {
      checkY(lineH);
      doc.text(wl, mLeft + indent, y, { align });
      y += lineH;
    }
  }

  function drawHR(color = LGREY, weight = 0.3) {
    checkY(4);
    doc.setDrawColor(...color);
    doc.setLineWidth(weight);
    doc.line(mLeft, y, pageW - mRight, y);
    y += 4;
  }

  function drawTable(header, rows) {
    if (!header || !header.length) return;
    const cols   = header.length;
    const colW   = maxW / cols;
    const pad    = 2.5;
    const minH   = 7;

    // Calcular altura real de cada fila según wrap de texto
    function rowHeight(cells) {
      let maxLines = 1;
      cells.forEach(cell => {
        const t = stripEmojis(cleanInline(cell || ""));
        const wrapped = doc.splitTextToSize(t, colW - pad * 2);
        if (wrapped.length > maxLines) maxLines = wrapped.length;
      });
      return Math.max(minH, maxLines * 4.5 + 3);
    }

    // Cabecera
    const hH = rowHeight(header);
    checkY(hH + 2);
    const hTop = y - 5;
    for (let c = 0; c < cols; c++) {
      doc.setFillColor(...TBL_HEAD_BG);
      doc.rect(mLeft + c * colW, hTop, colW, hH, "F");
      doc.setDrawColor(...TBL_BORDER);
      doc.setLineWidth(0.2);
      doc.rect(mLeft + c * colW, hTop, colW, hH, "S");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...TBL_HEAD_TXT);
      const hText = stripEmojis(cleanInline(header[c]));
      const hWrap = doc.splitTextToSize(hText, colW - pad * 2);
      hWrap.forEach((hl, li) => {
        doc.text(hl, mLeft + c * colW + pad, hTop + 5 + li * 4.5);
      });
    }
    y = hTop + hH + 1;

    // Filas de datos
    rows.forEach((row, ri) => {
      const rH = rowHeight(row);
      checkY(rH + 2);
      const rTop = y - 1;
      for (let c = 0; c < cols; c++) {
        if (ri % 2 === 0) {
          doc.setFillColor(...TBL_ROW_ALT);
          doc.rect(mLeft + c * colW, rTop, colW, rH, "F");
        }
        doc.setDrawColor(...TBL_BORDER);
        doc.setLineWidth(0.15);
        doc.rect(mLeft + c * colW, rTop, colW, rH, "S");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...DARK);
        const cText = stripEmojis(cleanInline(row[c] || ""));
        const cWrap = doc.splitTextToSize(cText, colW - pad * 2);
        cWrap.forEach((cl, li) => {
          doc.text(cl, mLeft + c * colW + pad, rTop + 5 + li * 4.5);
        });
      }
      y = rTop + rH + 1;
    });
    y += 3;
  }

  // ── Inicio ───────────────────────────────────────────────────
  drawHeader();

  // Título de la consulta
  const cleanTitle = stripEmojis(title);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...BLUE);
  const tLines = doc.splitTextToSize(cleanTitle, maxW);
  doc.text(tLines, mLeft, y);
  y += tLines.length * 7 + 2;
  drawHR(BLUE, 0.5);

  // ── Renderizar tokens ─────────────────────────────────────────
  const tokens = parseMdTokens(markdownText);
  let orderedCounters = {};

  for (const tok of tokens) {
    // Reiniciar contadores de lista numerada si el token no es ordered
    if (tok.type !== "ordered" && tok.type !== "blank") orderedCounters = {};

    switch (tok.type) {

      case "heading": {
        const sizes  = [15, 13, 11.5, 11, 10.5, 10];
        const colors = tok.level <= 2 ? BLUE : DARK;
        const sz     = sizes[tok.level - 1] || 10;
        checkY(sz + 4);
        if (tok.level <= 2) { y += 3; }
        writeLine(stripEmojis(cleanInline(tok.text)), {
          fontSize: sz, fontStyle: "bold", color: colors,
          lineH: sz * 0.45 + 2,
        });
        if (tok.level <= 2) {
          drawHR(tok.level === 1 ? BLUE : LGREY, tok.level === 1 ? 0.4 : 0.2);
        } else {
          y += 1;
        }
        break;
      }

      case "paragraph": {
        const text = stripEmojis(cleanInline(tok.text));
        if (!text) break;
        writeLine(text, { fontSize: 10, color: DARK, lineH: 5.5 });
        y += 1.5;
        break;
      }

      case "bullet": {
        const indent  = tok.level * 6;
        const symbol  = tok.level === 0 ? "\u2022" : "-";
        const symW    = 5; // ancho aproximado del símbolo + espacio
        const text    = stripEmojis(cleanInline(tok.text));
        checkY(5.5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...DARK);
        // Dibujar símbolo
        doc.text(symbol, mLeft + indent, y);
        // Dibujar texto con wrap correcto
        const wrapped = doc.splitTextToSize(text || " ", maxW - indent - symW);
        for (let wi = 0; wi < wrapped.length; wi++) {
          if (wi > 0) checkY(5.5);
          doc.text(wrapped[wi], mLeft + indent + symW, y);
          y += 5.5;
        }
        break;
      }

      case "ordered": {
        const lvl = tok.level || 0;
        orderedCounters[lvl] = (orderedCounters[lvl] || 0) + 1;
        Object.keys(orderedCounters).forEach(k => { if (Number(k) > lvl) delete orderedCounters[k]; });
        const indent  = lvl * 6 + 2;
        const label   = `${orderedCounters[lvl]}.`;
        const numW    = 7; // ancho reservado para el número
        const text    = stripEmojis(cleanInline(tok.text));
        checkY(5.5);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(...DARK);
        doc.text(label, mLeft + indent, y);
        doc.setFont("helvetica", "normal");
        const wrapped = doc.splitTextToSize(text || " ", maxW - indent - numW);
        for (let wi = 0; wi < wrapped.length; wi++) {
          if (wi > 0) checkY(5.5);
          doc.text(wrapped[wi], mLeft + indent + numW, y);
          y += 5.5;
        }
        break;
      }

      case "blockquote": {
        const bqOffset = 6;   // offset horizontal del texto desde el margen
        const barW     = 2.5; // ancho de la barra azul
        const bqText   = stripEmojis(cleanInline(tok.text));
        // Ancho disponible: maxW menos el offset del texto
        const bqWrapped = doc.splitTextToSize(bqText || " ", maxW - bqOffset);
        const lineH    = 5.2;
        const bqH      = bqWrapped.length * lineH + 3;
        checkY(bqH);
        const bqTop = y - 4;
        // Barra lateral azul con altura exacta
        doc.setFillColor(...BLUE);
        doc.rect(mLeft, bqTop, barW, bqH, "F");
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9.5);
        doc.setTextColor(...GREY);
        for (const wl of bqWrapped) {
          doc.text(wl, mLeft + bqOffset, y);
          y += lineH;
        }
        y += 2;
        break;
      }

      case "code": {
        const cLines = tok.text.split("\n");
        const bH     = cLines.length * 4.5 + 6;
        // Si el bloque entero no cabe, saltar a nueva página
        if (y + bH > pageH - mBot) {
          drawFooter();
          doc.addPage();
          page++;
          drawPageHeader();
        }
        const codeTop = y - 4;
        doc.setFillColor(242, 244, 250);
        doc.rect(mLeft, codeTop, maxW, bH, "F");
        doc.setDrawColor(...LGREY);
        doc.setLineWidth(0.2);
        doc.rect(mLeft, codeTop, maxW, bH, "S");
        doc.setFont("courier", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...DARK);
        for (const cl of cLines) {
          doc.text(cl.slice(0, 90), mLeft + 3, y);
          y += 4.5;
        }
        y += 4;
        break;
      }

      case "table":
        drawTable(tok.header, tok.rows);
        y += 2;
        break;

      case "hr":
        y += 2;
        drawHR(LGREY, 0.3);
        break;

      case "blank":
        y += 2.5;
        break;
    }
  }

  // ── Pie en todas las páginas ──────────────────────────────────
  const total = doc.internal.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    page = p;
    drawFooter();
  }

  doc.save(`LEGALI-${stripEmojis(title).slice(0, 40).replace(/\s+/g, "-")}.pdf`);
}

// ── Descargar como Word (.docx usando docx.js) ────────────────
async function downloadAsWord(markdownText, title) {
  // docx.iife.js se carga como script estático — expone var global `docx`
  if (typeof docx === "undefined" || typeof docx.Document === "undefined") {
    alert("La librería Word no está disponible. Recargue la página e intente nuevamente.");
    return;
  }

  try {
    const {
      Document, Packer, Paragraph, TextRun, HeadingLevel,
      AlignmentType, BorderStyle, Header, Footer, PageNumber,
      Table, TableRow, TableCell, WidthType, ShadingType,
      VerticalAlign,
    } = docx;

  const BLUE_HEX = "1B4FD8";
  const GREY_HEX = "888888";
  const LGREY_HEX = "C8D2E1";

  // ── Helper: construir runs de inline markdown ─────────────────
  function inlineRuns(text, baseOpts = {}) {
    // Soporta ***bold italic***, **bold**, __bold__, *italic*, _italic_, `code`, [link](url)
    const parts = [];
    // Normalizar: convertir __x__ → **x** y _x_ → *x* antes de procesar
    const normalized = (text || "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // extraer texto de links
      .replace(/__(.+?)__/g, "**$1**")           // __bold__ → **bold**
      .replace(/(?<!\*|\w)_(.+?)_(?!\*|\w)/g, "*$1*"); // _italic_ → *italic*
    const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
    let last = 0, m;
    const clean = (s) => stripEmojis(s);
    while ((m = re.exec(normalized)) !== null) {
      if (m.index > last) parts.push(new TextRun({ text: clean(normalized.slice(last, m.index)), ...baseOpts }));
      if (m[2])      parts.push(new TextRun({ text: clean(m[2]), ...baseOpts, bold: true, italics: true }));
      else if (m[3]) parts.push(new TextRun({ text: clean(m[3]), ...baseOpts, bold: true }));
      else if (m[4]) parts.push(new TextRun({ text: clean(m[4]), ...baseOpts, italics: true }));
      else if (m[5]) parts.push(new TextRun({ text: clean(m[5]), font: "Courier New", size: (baseOpts.size || 22) - 2, color: "444444" }));
      last = m.index + m[0].length;
    }
    if (last < normalized.length) parts.push(new TextRun({ text: clean(normalized.slice(last)), ...baseOpts }));
    return parts.length ? parts : [new TextRun({ text: clean(normalized), ...baseOpts })];
  }

  // ── Helper: celda de tabla ─────────────────────────────────────
  function makeCell(text, isHeader = false) {
    return new TableCell({
      children: [new Paragraph({
        children: inlineRuns(text || "", {
          bold: isHeader,
          color: isHeader ? "FFFFFF" : "1E1E28",
          size: 19,
        }),
        spacing: { before: 60, after: 60 },
      })],
      shading: isHeader
        ? { fill: BLUE_HEX, type: ShadingType.CLEAR }
        : { fill: "FFFFFF", type: ShadingType.CLEAR },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
    });
  }

  // ── Construir paragrafos/tabla desde tokens ───────────────────
  const children = [];
  const tokens   = parseMdTokens(markdownText);

  // Título principal del documento
  children.push(new Paragraph({
    children: [new TextRun({
      text: stripEmojis(title),
      bold: true, color: BLUE_HEX, size: 32,
    })],
    spacing: { after: 120 },
  }));

  // Subtítulo fecha
  children.push(new Paragraph({
    children: [new TextRun({
      text: `Generado por LEGALI  -  ${new Date().toLocaleDateString("es-CO", { year: "numeric", month: "long", day: "numeric" })}`,
      color: GREY_HEX, size: 18, italics: true,
    })],
    spacing: { after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BLUE_HEX } },
  }));

  const levelToHeading = [
    HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
  ];

  for (const tok of tokens) {
    switch (tok.type) {

      case "heading": {
        const hLevel  = levelToHeading[tok.level - 1] || HeadingLevel.HEADING_3;
        const sz      = [30, 26, 23, 21, 20, 20][tok.level - 1] || 20;
        const color   = tok.level <= 2 ? BLUE_HEX : "1E1E28";
        children.push(new Paragraph({
          heading: hLevel,
          children: [new TextRun({ text: stripEmojis(cleanInline(tok.text)), bold: true, color, size: sz })],
          spacing: { before: tok.level <= 2 ? 280 : 180, after: tok.level <= 2 ? 100 : 60 },
          border: tok.level === 1
            ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE_HEX } }
            : tok.level === 2
              ? { bottom: { style: BorderStyle.SINGLE, size: 3, color: LGREY_HEX } }
              : undefined,
        }));
        break;
      }

      case "paragraph": {
        const rawText = tok.text;
        if (!rawText || !stripEmojis(cleanInline(rawText))) break;
        children.push(new Paragraph({
          children: inlineRuns(rawText, { size: 22, color: "1E1E28" }),
          spacing: { after: 100 },
          alignment: AlignmentType.JUSTIFIED,
        }));
        break;
      }

      case "bullet": {
        children.push(new Paragraph({
          children: inlineRuns(tok.text, { size: 22 }),
          bullet: { level: tok.level },
          spacing: { after: 60 },
        }));
        break;
      }

      case "ordered": {
        children.push(new Paragraph({
          children: inlineRuns(tok.text, { size: 22 }),
          numbering: { reference: "default-numbering", level: tok.level },
          spacing: { after: 60 },
        }));
        break;
      }

      case "blockquote": {
        children.push(new Paragraph({
          children: [new TextRun({
            text: stripEmojis(cleanInline(tok.text)),
            italics: true, color: "555577", size: 21,
          })],
          indent: { left: 480 },
          border: { left: { style: BorderStyle.THICK, size: 12, color: BLUE_HEX } },
          spacing: { after: 100 },
        }));
        break;
      }

      case "code": {
        for (const cl of tok.text.split("\n")) {
          children.push(new Paragraph({
            children: [new TextRun({
              text: cl || " ",
              font: "Courier New", size: 18, color: "333333",
            })],
            shading: { fill: "F2F4FA", type: ShadingType.CLEAR },
            spacing: { after: 0, before: 0 },
            indent: { left: 240 },
          }));
        }
        children.push(new Paragraph({ spacing: { after: 120 } }));
        break;
      }

      case "table": {
        if (!tok.header || !tok.header.length) break;
        const tableRows = [
          new TableRow({
            children: tok.header.map(h => makeCell(h, true)),
            tableHeader: true,
          }),
          ...tok.rows.map((row, ri) => new TableRow({
            children: tok.header.map((_, ci) => {
              return new TableCell({
                children: [new Paragraph({
                  children: inlineRuns(row[ci] || "", {
                    color: "1E1E28",
                    size: 19,
                  }),
                  spacing: { before: 60, after: 60 },
                })],
                shading: ri % 2 === 1
                  ? { fill: "F1F5FD", type: ShadingType.CLEAR }
                  : { fill: "FFFFFF", type: ShadingType.CLEAR },
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
              });
            }),
          })),
        ];
        children.push(new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        }));
        children.push(new Paragraph({ spacing: { after: 160 } }));
        break;
      }

      case "hr": {
        children.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: LGREY_HEX } },
          spacing: { before: 160, after: 160 },
        }));
        break;
      }

      case "blank":
        children.push(new Paragraph({ spacing: { after: 80 } }));
        break;
    }
  }

  // Aviso legal
  children.push(new Paragraph({
    children: [new TextRun({
      text: "LEGALI proporciona orientacion general sobre derecho colombiano. Este documento no reemplaza la asesoria de un abogado habilitado.",
      color: GREY_HEX, size: 17, italics: true,
    })],
    border: { top: { style: BorderStyle.SINGLE, size: 3, color: LGREY_HEX } },
    spacing: { before: 400, after: 0 },
  }));

  const wordDoc = new Document({
    numbering: {
      config: [{
        reference: "default-numbering",
        levels: [
          { level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } },
          { level: 1, format: "decimal", text: "%1.%2.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 260 } } } },
          { level: 2, format: "decimal", text: "%1.%2.%3.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 260 } } } },
        ],
      }],
    },
    sections: [{
      properties: {},
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              new TextRun({ text: "LEGALI  -  Asistente Juridico Colombia", bold: true, color: BLUE_HEX, size: 18 }),
            ],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE_HEX } },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: "Pagina ", size: 16, color: GREY_HEX }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY_HEX }),
              new TextRun({ text: " de ", size: 16, color: GREY_HEX }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: GREY_HEX }),
            ],
            alignment: AlignmentType.RIGHT,
          })],
        }),
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(wordDoc);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `LEGALI-${stripEmojis(title).slice(0, 40).replace(/\s+/g, "-")}.docx`;
  a.click();
  URL.revokeObjectURL(url);

  } catch (e) {
    console.error("Error generando Word:", e);
    alert("Error al generar el documento Word: " + e.message);
  }
}

// ── Cargador dinámico de scripts ──────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    // Si ya está cargado, resolver inmediatamente
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s    = document.createElement("script");
    s.src      = src;
    s.onload   = () => resolve();
    s.onerror  = () => reject(new Error(`No se pudo cargar: ${src}`));
    document.head.appendChild(s);
  });
}