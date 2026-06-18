// ============================================================
// LEGALI v2.0 — js/app.js
// Core: chat, RAG, streaming, docs de sesión, exportar PDF/Word
// ============================================================

'use strict';

// ── Selector rápido ───────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Flag admin (desactiva funciones admin en usuario.html) ────
const IS_ADMIN = !!document.getElementById('btnToggleLib');

// ── Estado global ─────────────────────────────────────────────
const STATE = {
  sessionId:   _generateSessionId(),
  messages:    [],       // { role, content }
  provider:    'groq',
  model:       'llama-3.3-70b-versatile',
  localDocs:   [],       // { id, filename, content, sizeBytes }
  isStreaming: false,
  lastRagDocs: [],
};

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await _waitForUser();
  _setupState();
  _renderAreaGrid();
  _renderSuggestions();
  _setupEventListeners();
  _setupSessionUpload();
  _loadSessionDocs();
  checkPaymentReturn?.();
});

// ── Esperar a que usuario.html inicialice window.LEGALI_USER ──
function _waitForUser(timeout = 8000) {
  return new Promise((resolve) => {
    if (window.LEGALI_USER) { resolve(); return; }
    const start   = Date.now();
    const interval = setInterval(() => {
      if (window.LEGALI_USER) { clearInterval(interval); resolve(); return; }
      if (Date.now() - start > timeout) {
        clearInterval(interval);
        console.warn('LEGALI_USER no disponible, usando defaults');
        resolve();
      }
    }, 100);
  });
}

function _setupState() {
  const user = window.LEGALI_USER;
  if (!user) return;
  const cfg = PLAN_CONFIG[user.plan] || PLAN_CONFIG.gratis;
  STATE.provider = user.provider || cfg.provider;
  STATE.model    = cfg.model;
}

// ── Event listeners principales ───────────────────────────────
function _setupEventListeners() {
  // Enviar mensaje
  const sendBtn   = $('sendBtn');
  const userInput = $('userInput');

  if (sendBtn)   sendBtn.addEventListener('click', handleSend);
  if (userInput) {
    userInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    // Auto-resize textarea
    userInput.addEventListener('input', () => {
      userInput.style.height = 'auto';
      userInput.style.height = Math.min(userInput.scrollHeight, 160) + 'px';
    });
  }

  // Nueva conversación
  const btnNew = $('btnNewChat');
  if (btnNew) btnNew.addEventListener('click', newConversation);

  // Sidebar toggle (móvil)
  const toggle = $('sidebarToggle');
  if (toggle) toggle.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('open');
  });
}

// ── Manejar envío de mensaje ──────────────────────────────────
const MAX_MESSAGE_LENGTH = 6000; // caracteres

async function handleSend() {
  const input = $('userInput');
  if (!input || STATE.isStreaming) return;

  let text = input.value.trim();
  if (!text) return;

  // Sanitización básica: eliminar caracteres de control invisibles
  // (excepto saltos de línea/tabulaciones) que podrían usarse para
  // inyección o para confundir al modelo.
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Límite de longitud para evitar abuso de costo en el ai-proxy
  if (text.length > MAX_MESSAGE_LENGTH) {
    _appendMessage('assistant',
      `⚠️ Tu mensaje es demasiado largo (${text.length} caracteres). El máximo permitido es ${MAX_MESSAGE_LENGTH} caracteres.`,
      true);
    return;
  }

  // Verificar cuota
  const quota = await checkQuota();
  if (!quota.allowed) {
    blockUIOnQuotaExhausted(quota.reason);
    _appendMessage('assistant', ERROR_MESSAGES[quota.reason] || ERROR_MESSAGES.quota_exhausted, true);
    return;
  }

  // Limpiar input
  input.value = '';
  input.style.height = 'auto';

  // Ocultar bienvenida
  const welcome = $('welcome');
  if (welcome) welcome.style.display = 'none';

  // Mostrar mensaje del usuario
  _appendMessage('user', text);
  STATE.messages.push({ role: 'user', content: text });

  // Guardar en BD
  saveMessage({ sessionId: STATE.sessionId, role: 'user', content: text });

  // RAG
  const ragDocs = await searchDocs(text, STATE.sessionId);
  STATE.lastRagDocs = ragDocs;
  _showRagIndicator(ragDocs);

  // Construir mensajes para el proveedor
  const contextualMessages = _buildMessages(text, ragDocs);

  // Placeholder del asistente
  const assistantEl = _appendMessage('assistant', '', false, true);
  STATE.isStreaming = true;
  _setInputEnabled(false);

  let fullResponse = '';

  try {
    fullResponse = await streamProvider({
      messages:     contextualMessages,
      provider:     STATE.provider,
      model:        STATE.model,
      systemPrompt: SYSTEM_PROMPT,
      onChunk: (chunk) => {
        fullResponse += chunk; // acumulado en callback también
        _appendChunk(assistantEl, chunk);
      },
      onDone: (text) => {
        fullResponse = text;
        _finalizeMessage(assistantEl, text);
      },
      onError: (err) => {
        _finalizeMessage(assistantEl, err.message, true);
      },
    });

    // Guardar respuesta y log
    STATE.messages.push({ role: 'assistant', content: fullResponse });
    saveMessage({ sessionId: STATE.sessionId, role: 'assistant', content: fullResponse });
    logUsage({
      action:    'query',
      provider:  STATE.provider,
      model:     STATE.model,
      sessionId: STATE.sessionId,
    });

    // Incrementar cuota
    await incrementQuota();

  } catch (e) {
    console.error('streamProvider error:', e);
  } finally {
    STATE.isStreaming = false;
    _setInputEnabled(true);
    input.focus();
  }
}

// ── Construir array de mensajes con contexto RAG ──────────────
function _buildMessages(userText, ragDocs) {
  const ragContext = buildRagContext(ragDocs);
  const messages   = [...STATE.messages];

  // Remover el último mensaje (ya está en STATE, lo reemplazamos con contexto)
  messages.pop();

  const userContent = ragContext
    ? `${ragContext}\n\n---\n\n## Consulta del usuario\n\n${userText}`
    : userText;

  messages.push({ role: 'user', content: userContent });

  // Mantener ventana de contexto (últimos 20 intercambios = 40 mensajes)
  if (messages.length > 40) {
    return messages.slice(-40);
  }

  return messages;
}

// ── Renderizar mensaje en el chat ─────────────────────────────
function _appendMessage(role, content, isHTML = false, isStreaming = false) {
  const history = $('chatHistory');
  if (!history) return null;

  const wrapper = document.createElement('div');
  wrapper.className = `message message-${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (isStreaming) {
    bubble.innerHTML = '<span class="cursor-blink">▋</span>';
  } else if (isHTML) {
    bubble.innerHTML = content;
  } else if (role === 'assistant') {
    bubble.innerHTML = _renderMarkdown(content);
  } else {
    bubble.textContent = content;
  }

  wrapper.appendChild(bubble);

  // Botones de acción en mensajes del asistente
  if (role === 'assistant' && !isStreaming) {
    wrapper.appendChild(_buildMessageActions(content));
  }

  history.appendChild(wrapper);
  history.scrollTop = history.scrollHeight;
  return { wrapper, bubble };
}

// ── Agregar chunk de streaming ────────────────────────────────
let _streamBuffer = '';

function _appendChunk(el, chunk) {
  if (!el) return;
  _streamBuffer += chunk;
  el.bubble.innerHTML = _renderMarkdown(_streamBuffer) + '<span class="cursor-blink">▋</span>';
  const history = $('chatHistory');
  if (history) history.scrollTop = history.scrollHeight;
}

function _finalizeMessage(el, fullText, isError = false) {
  _streamBuffer = '';
  if (!el) return;
  if (isError) {
    el.bubble.innerHTML = `<span class="error-msg">${fullText}</span>`;
  } else {
    el.bubble.innerHTML = _renderMarkdown(fullText);
    el.wrapper.appendChild(_buildMessageActions(fullText));
  }
  const history = $('chatHistory');
  if (history) history.scrollTop = history.scrollHeight;
}

// ── Botones de acción por mensaje ─────────────────────────────
function _buildMessageActions(content) {
  const actions = document.createElement('div');
  actions.className = 'message-actions';

  const btnCopy = document.createElement('button');
  btnCopy.className = 'msg-action-btn';
  btnCopy.title = 'Copiar';
  btnCopy.innerHTML = '📋';
  btnCopy.onclick = () => {
    navigator.clipboard.writeText(content);
    btnCopy.innerHTML = '✅';
    setTimeout(() => { btnCopy.innerHTML = '📋'; }, 1500);
  };
  actions.appendChild(btnCopy);

  const btnPdf = document.createElement('button');
  btnPdf.className = 'msg-action-btn';
  btnPdf.title = 'Exportar conversación a PDF';
  btnPdf.innerHTML = '📄';
  btnPdf.onclick = () => exportPDF();
  actions.appendChild(btnPdf);

  const btnWord = document.createElement('button');
  btnWord.className = 'msg-action-btn';
  btnWord.title = 'Exportar conversación a Word';
  btnWord.innerHTML = '📝';
  btnWord.onclick = () => exportWord();
  actions.appendChild(btnWord);

  return actions;
}

// ── Indicador RAG ─────────────────────────────────────────────
function _showRagIndicator(docs) {
  const el = $('ragIndicator');
  if (!el) return;
  if (docs && docs.length > 0) {
    el.textContent = `📚 ${docs.length} documento${docs.length > 1 ? 's' : ''} jurídico${docs.length > 1 ? 's' : ''} encontrado${docs.length > 1 ? 's' : ''}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
  } else {
    el.classList.add('hidden');
  }
}

// ── Habilitar/deshabilitar input ──────────────────────────────
function _setInputEnabled(enabled) {
  const input = $('userInput');
  const btn   = $('sendBtn');
  if (input) input.disabled = !enabled;
  if (btn)   btn.disabled   = !enabled;
}

// ── Nueva conversación ────────────────────────────────────────
function newConversation() {
  STATE.sessionId  = _generateSessionId();
  STATE.messages   = [];
  STATE.localDocs  = [];
  STATE.lastRagDocs = [];
  _streamBuffer    = '';

  const history = $('chatHistory');
  if (history) history.innerHTML = '';

  const welcome = $('welcome');
  if (welcome) welcome.style.display = 'flex';

  const ragEl = $('ragIndicator');
  if (ragEl) ragEl.classList.add('hidden');

  const docList = $('sessionDocList');
  if (docList) docList.innerHTML = '';

  _setInputEnabled(true);
  $('userInput')?.focus();
}

// ── Renderizar área grid del sidebar ─────────────────────────
function _renderAreaGrid() {
  const grid = $('areaGrid');
  if (!grid) return;
  grid.innerHTML = LEGAL_AREAS.map(a => `
    <button class="area-chip" title="${a.title}"
            onclick="document.getElementById('userInput').value='Explícame el alcance del ${a.title} (${a.label})'">
      <span>${a.emoji}</span>
      <span>${a.label}</span>
    </button>
  `).join('');
}

// ── Renderizar sugerencias de bienvenida ──────────────────────
function _renderSuggestions() {
  const container = $('suggestions');
  if (!container) return;
  const picks = _shuffle([...WELCOME_SUGGESTIONS]).slice(0, 4);
  container.innerHTML = picks.map(s => `
    <button class="suggestion-chip" onclick="useSuggestion(this.dataset.text)" data-text="${s.replace(/"/g,'&quot;')}">
      ${s}
    </button>
  `).join('');
}

function useSuggestion(text) {
  const input = $('userInput');
  if (input) {
    input.value = text;
    input.focus();
    input.dispatchEvent(new Event('input'));
  }
}

// ── Upload de documentos de sesión ────────────────────────────
function _setupSessionUpload() {
  const area  = $('sessionUploadArea');
  const input = $('sessionFileInput');
  const label = $('sessionUploadLabel');

  if (!area || !input) return;

  area.addEventListener('click', () => input.click());

  area.addEventListener('dragover',  e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    _handleFiles(e.dataTransfer.files);
  });

  input.addEventListener('change', () => {
    _handleFiles(input.files);
    input.value = '';
  });
}

async function _handleFiles(files) {
  const user = window.LEGALI_USER;
  if (!user) return;

  const maxBytes = DOC_SIZE_LIMITS[user.plan] || 0;
  if (maxBytes === 0) {
    alert('Los documentos de sesión están disponibles desde el plan Consultorio.');
    return;
  }

  for (const file of Array.from(files)) {
    if (file.size > maxBytes) {
      alert(`${file.name}: supera el límite de ${maxBytes / 1024 / 1024} MB de tu plan.`);
      continue;
    }

    const allowed = ['application/pdf','text/plain','text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|txt|md|docx)$/i)) {
      alert(`${file.name}: tipo de archivo no soportado.`);
      continue;
    }

    await _processAndSaveDoc(file);
  }
}

async function _processAndSaveDoc(file) {
  const label = $('sessionUploadLabel');
  if (label) label.textContent = `⏳ Procesando ${file.name}...`;

  try {
    let content = '';

    if (file.type === 'application/pdf') {
      content = await _extractPdf(file);
    } else {
      content = await file.text();
    }

    if (!content.trim()) {
      alert(`${file.name}: no se pudo extraer texto.`);
      return;
    }

    // Truncar si es muy largo
    if (content.length > 50000) {
      content = content.slice(0, 50000) + '\n\n[... documento truncado por límite de tamaño ...]';
    }

    const saved = await saveSessionDocument({
      sessionId: STATE.sessionId,
      filename:  file.name,
      content,
      sizeBytes: file.size,
    });

    if (saved) {
      STATE.localDocs.push({ id: saved.id, filename: file.name, content, sizeBytes: file.size });
      _renderDocList();
    }
  } catch (e) {
    console.error('_processAndSaveDoc error:', e);
    alert(`Error procesando ${file.name}.`);
  } finally {
    if (label) label.textContent = '📤 Subir documento';
  }
}

// ── Extraer texto de PDF con PDF.js ──────────────────────────
async function _extractPdf(file) {
  if (typeof pdfjsLib === 'undefined') {
    return await file.text().catch(() => '');
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdf         = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text          = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(s => s.str).join(' ');
    text += pageText + '\n\n';
    // Limitar a 40k chars para rendimiento
    if (text.length > 40000) break;
  }

  return text.trim();
}

// ── Cargar docs de sesión al iniciar ─────────────────────────
async function _loadSessionDocs() {
  const docs = await listSessionDocuments(STATE.sessionId);
  if (docs.length > 0) {
    STATE.localDocs = docs.map(d => ({ id: d.id, filename: d.filename, sizeBytes: d.size_bytes }));
    _renderDocList();
  }
}

function _renderDocList() {
  const list = $('sessionDocList');
  if (!list) return;

  list.innerHTML = STATE.localDocs.map(doc => `
    <div class="session-doc-item" id="doc-${doc.id}">
      <span class="doc-icon">${_docIcon(doc.filename)}</span>
      <span class="doc-name" title="${doc.filename}">${_truncate(doc.filename, 22)}</span>
      <span class="doc-size">${_formatBytes(doc.sizeBytes)}</span>
      <button class="doc-delete" onclick="removeSessionDoc('${doc.id}')" title="Eliminar">✕</button>
    </div>
  `).join('');
}

async function removeSessionDoc(docId) {
  const ok = await deleteSessionDocument(docId);
  if (ok) {
    STATE.localDocs = STATE.localDocs.filter(d => d.id !== docId);
    _renderDocList();
  }
}

// ── Exportar PDF (vía print dialog) ──────────────────────────
function exportPDF() {
  const history = $('chatHistory');
  if (!history || !history.innerHTML.trim()) {
    alert('No hay conversación para exportar.');
    return;
  }

  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8"/>
      <title>LEGALI — Consulta Jurídica</title>
      <style>
        body { font-family: 'Georgia', serif; max-width: 800px; margin: 40px auto; padding: 0 24px; color: #111; }
        h1 { font-size: 22px; border-bottom: 2px solid #1B4FD8; padding-bottom: 8px; color: #1B4FD8; }
        .meta { font-size: 12px; color: #666; margin-bottom: 24px; }
        .message-user { background: #F0F4FC; border-radius: 8px; padding: 12px 16px; margin: 12px 0; }
        .message-user::before { content: "👤 Usuario"; display: block; font-weight: 700; font-size: 11px; color: #1B4FD8; margin-bottom: 6px; text-transform: uppercase; }
        .message-assistant { border-left: 3px solid #C8960A; padding: 12px 16px; margin: 12px 0; }
        .message-assistant::before { content: "⚖️ LEGALI"; display: block; font-weight: 700; font-size: 11px; color: #C8960A; margin-bottom: 6px; text-transform: uppercase; }
        .footer { margin-top: 40px; font-size: 11px; color: #999; border-top: 1px solid #ddd; padding-top: 12px; }
        pre { background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
        code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-size: 12px; }
        table { border-collapse: collapse; width: 100%; margin: 12px 0; }
        th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
        th { background: #f0f4fc; }
        @media print { body { margin: 0; } }
      </style>
    </head>
    <body>
      <h1>⚖️ LEGALI — Consulta Jurídica</h1>
      <div class="meta">
        Fecha: ${new Date().toLocaleString('es-CO')} · 
        Usuario: ${window.LEGALI_USER?.email || 'Anónimo'} · 
        Plan: ${PLAN_CONFIG[window.LEGALI_USER?.plan]?.label || '—'}
      </div>
      ${_buildPrintHTML()}
      <div class="footer">
        ⚠️ Este documento es orientación general y no reemplaza la asesoría de un abogado habilitado.<br/>
        LEGALI © ${new Date().getFullYear()} · Derecho Procesal Colombiano
      </div>
    </body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}

function _buildPrintHTML() {
  return STATE.messages.map(m => `
    <div class="message-${m.role}">
      ${m.role === 'assistant' ? _renderMarkdown(m.content) : _escapeHtml(m.content)}
    </div>
  `).join('');
}

// ── Exportar Word (.docx) ─────────────────────────────────────
async function exportWord() {
  if (!STATE.messages.length) {
    alert('No hay conversación para exportar.');
    return;
  }

  if (window._docxReady) await window._docxReady;

  if (typeof docx === 'undefined') {
    alert('Librería Word no disponible. Usa exportar PDF.');
    return;
  }

  const {
    Document, Paragraph, TextRun, HeadingLevel, Packer,
    AlignmentType, Table, TableRow, TableCell, WidthType,
    BorderStyle, ShadingType,
  } = docx;

  // ── Parser de inline markdown → array de TextRun ──────────
  function _inlineRuns(text, baseSize) {
    const sz = baseSize || 22;
    const runs = [];
    // Soporta: **bold**, *italic*, ***bold+italic***, `code`
    const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), size: sz }));
      if (m[2])      runs.push(new TextRun({ text: m[2], bold: true, italics: true, size: sz }));
      else if (m[3]) runs.push(new TextRun({ text: m[3], bold: true, size: sz }));
      else if (m[4]) runs.push(new TextRun({ text: m[4], italics: true, size: sz }));
      else if (m[5]) runs.push(new TextRun({ text: m[5], font: 'Courier New', size: sz }));
      last = m.index + m[0].length;
    }
    if (last < text.length) runs.push(new TextRun({ text: text.slice(last), size: sz }));
    return runs.length ? runs : [new TextRun({ text, size: sz })];
  }

  // ── Parser de bloque markdown → array de Paragraph/Table ──
  function _mdToDocx(markdown) {
    const elements = [];
    const lines = markdown.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Línea vacía
      if (!line.trim()) {
        elements.push(new Paragraph({ text: '' }));
        i++; continue;
      }

      // Headings # ## ###
      const hMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (hMatch) {
        const lvlMap = {
          1: HeadingLevel.HEADING_1,
          2: HeadingLevel.HEADING_2,
          3: HeadingLevel.HEADING_3,
          4: HeadingLevel.HEADING_4,
          5: HeadingLevel.HEADING_5,
          6: HeadingLevel.HEADING_6,
        };
        const lvl   = hMatch[1].length;
        const hText = hMatch[2].replace(/\*\*/g, '');
        elements.push(new Paragraph({ text: hText, heading: lvlMap[lvl] || HeadingLevel.HEADING_3 }));
        i++; continue;
      }

      // Separador ---
      if (line.match(/^---+\s*$/) || line.match(/^\*\*\*+\s*$/)) {
        elements.push(new Paragraph({
          children: [new TextRun({ text: '─'.repeat(60), color: 'CCCCCC', size: 16 })],
        }));
        i++; continue;
      }

      // Tabla markdown |col|col|
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const tableLines = [];
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          tableLines.push(lines[i]);
          i++;
        }
        // Filtrar la fila separadora |---|---|
        const dataRows = tableLines.filter(l => !l.match(/^\s*\|[\s\-:|]+\|\s*$/));
        if (dataRows.length >= 1) {
          const parseCells = row => row.split('|').slice(1, -1).map(c => c.trim());
          const headerCells = parseCells(dataRows[0]);
          const colCount    = headerCells.length;
          const colWidth    = Math.floor(9000 / colCount);

          const tableRows = dataRows.map((row, rowIdx) => {
            const cells = parseCells(row);
            return new TableRow({
              children: cells.map(cellText => new TableCell({
                width: { size: colWidth, type: WidthType.DXA },
                shading: rowIdx === 0
                  ? { fill: '1B4FD8', type: ShadingType.CLEAR, color: 'FFFFFF' }
                  : { fill: 'F8FAFF', type: ShadingType.CLEAR },
                children: [new Paragraph({
                  children: _inlineRuns(cellText, 20),
                  ...(rowIdx === 0 ? {} : {}),
                })],
              })),
            });
          });

          elements.push(new Table({
            width: { size: 9000, type: WidthType.DXA },
            rows: tableRows,
          }));
          elements.push(new Paragraph({ text: '' }));
        }
        continue;
      }

      // Lista con viñeta - item o * item
      if (line.match(/^(\s*)[-*]\s+(.+)/)) {
        const listMatch = line.match(/^(\s*)[-*]\s+(.+)/);
        const indent    = listMatch[1].length > 0;
        elements.push(new Paragraph({
          children: [
            new TextRun({ text: indent ? '    • ' : '• ', bold: false, size: 22 }),
            ..._inlineRuns(listMatch[2], 22),
          ],
        }));
        i++; continue;
      }

      // Lista numerada  1. item
      if (line.match(/^\d+\.\s+(.+)/)) {
        const numMatch = line.match(/^(\d+)\.\s+(.+)/);
        elements.push(new Paragraph({
          children: [
            new TextRun({ text: `${numMatch[1]}. `, bold: true, size: 22 }),
            ..._inlineRuns(numMatch[2], 22),
          ],
        }));
        i++; continue;
      }

      // Bloque de código ```
      if (line.trim().startsWith('```')) {
        i++;
        const codeLines = [];
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // saltar cierre ```
        for (const cl of codeLines) {
          elements.push(new Paragraph({
            children: [new TextRun({ text: cl, font: 'Courier New', size: 18, color: '444444' })],
          }));
        }
        continue;
      }

      // Blockquote > texto
      if (line.match(/^>\s*(.*)/)) {
        const bqText = line.match(/^>\s*(.*)/)[1];
        elements.push(new Paragraph({
          children: [
            new TextRun({ text: '  │  ', color: 'AAAAAA', size: 22 }),
            ..._inlineRuns(bqText, 22),
          ],
        }));
        i++; continue;
      }

      // Párrafo normal
      elements.push(new Paragraph({ children: _inlineRuns(line, 22) }));
      i++;
    }

    return elements;
  }

  // ── Construir documento ────────────────────────────────────
  const children = [
    new Paragraph({
      text: '⚖️ LEGALI — Consulta Jurídica',
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Fecha: ${new Date().toLocaleString('es-CO')}  |  `, size: 20, color: '666666' }),
        new TextRun({ text: `Usuario: ${window.LEGALI_USER?.email || '—'}  |  `, size: 20, color: '666666' }),
        new TextRun({ text: `Plan: ${PLAN_CONFIG?.[window.LEGALI_USER?.plan]?.label || '—'}`, size: 20, color: '666666' }),
      ],
    }),
    new Paragraph({ text: '' }),
  ];

  for (const msg of STATE.messages) {
    const isUser = msg.role === 'user';
    children.push(
      new Paragraph({
        children: [new TextRun({
          text: isUser ? '👤 USUARIO' : '⚖️ LEGALI',
          bold: true,
          size: 22,
          color: isUser ? '1B4FD8' : 'C8960A',
        })],
      }),
    );

    if (isUser) {
      // Pregunta del usuario: párrafo simple con inline markdown
      children.push(new Paragraph({ children: _inlineRuns(msg.content, 22) }));
    } else {
      // Respuesta de LEGALI: parseo completo de markdown
      const parsed = _mdToDocx(msg.content);
      children.push(...parsed);
    }

    children.push(new Paragraph({ text: '' }));
  }

  children.push(
    new Paragraph({
      children: [new TextRun({
        text: '⚠️ Este documento es orientación general y no reemplaza la asesoría de un abogado habilitado. Ley 1123 de 2007.',
        size: 18, color: '999999', italics: true,
      })],
    }),
  );

  const doc  = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `LEGALI-consulta-${new Date().toISOString().slice(0,10)}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Renderizar Markdown ───────────────────────────────────────
function _renderMarkdown(text) {
  let html;
  if (typeof marked !== 'undefined') {
    try {
      html = marked.parse(text, { breaks: true, gfm: true });
    } catch (_) {
      html = _escapeHtml(text);
    }
  } else {
    // Fallback básico
    html = text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/`(.+?)`/g,'<code>$1</code>')
      .replace(/\n/g,'<br/>');
  }

  // Sanitizar el HTML resultante antes de insertarlo con innerHTML.
  // Esto evita que contenido inyectado (vía documentos RAG o
  // respuestas del modelo) ejecute scripts u otro HTML peligroso.
  if (typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p','br','strong','em','b','i','u','s','code','pre','blockquote',
        'ul','ol','li','h1','h2','h3','h4','h5','h6','a','table','thead','tbody','tr','th','td','hr'],
      ALLOWED_ATTR: ['href','target','rel'],
    });
  }
  return html;
}

function _escapeHtml(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Utilidades ────────────────────────────────────────────────
function _generateSessionId() {
  return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function _formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function _truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function _docIcon(filename) {
  if (filename.match(/\.pdf$/i))  return '📄';
  if (filename.match(/\.docx$/i)) return '📝';
  return '📃';
}

function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Timeout de inactividad ────────────────────────────────────
(function initInactivityTimeout() {
  const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos
  const WARN_MS    = 25 * 60 * 1000; // aviso a los 25 min
  let timeoutId, warnId, warnBanner;

  function createBanner() {
    if (warnBanner) return;
    warnBanner = document.createElement('div');
    warnBanner.id = 'inactivity-banner';
    warnBanner.style.cssText = `
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      background: #1e2d45; border: 1px solid #D97706; border-radius: 10px;
      padding: 12px 20px; color: #FCD34D; font-size: 13px; z-index: 9999;
      display: none; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    `;
    document.body.appendChild(warnBanner);
  }

  function showWarning(secsLeft) {
    createBanner();
    warnBanner.style.display = 'block';

    let s = secsLeft;
    function updateText() {
      warnBanner.innerHTML = `⏱️ Tu sesión cerrará en <strong>${s}s</strong> por inactividad.&nbsp;`
        + `<button onclick="window.resetInactivityTimer()" style="`
        + `margin-left:8px;background:#D97706;border:none;border-radius:6px;`
        + `color:#000;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:600;">`
        + `Seguir activo</button>`;
    }
    updateText();

    const interval = setInterval(() => {
      if (!warnBanner || warnBanner.style.display === 'none') { clearInterval(interval); return; }
      s--;
      if (s <= 0) { clearInterval(interval); return; }
      updateText();
    }, 1000);
  }

  function hideWarning() {
    if (warnBanner) warnBanner.style.display = 'none';
  }

  async function forceLogout() {
    hideWarning();
    try { await sbUser.auth.signOut(); } catch(_) {}
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = 'login.html';
  }

  function resetTimers() {
    clearTimeout(timeoutId);
    clearTimeout(warnId);
    hideWarning();
    warnId    = setTimeout(() => showWarning(300), WARN_MS);
    timeoutId = setTimeout(forceLogout, TIMEOUT_MS);
  }

  window.resetInactivityTimer = resetTimers;

  ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll', 'click'].forEach(ev => {
    document.addEventListener(ev, resetTimers, { passive: true });
  });

  resetTimers();
})();