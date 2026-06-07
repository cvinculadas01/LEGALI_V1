// ════════════════════════════════════════════════════════════
// LEGALI — Proveedores de IA (streaming)
// Equivalente a providers/*.py
// Todos usan fetch con ReadableStream para streaming real
// ════════════════════════════════════════════════════════════

// ── Utilidad: leer stream de texto ─────────────────────────

async function* streamTextChunks(response) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Partir por líneas SSE (data: ...)
    const lines = buffer.split("\n");
    buffer = lines.pop(); // la última línea puede estar incompleta

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") return;
        yield raw;
      }
    }
  }
}

// ── GROQ ────────────────────────────────────────────────────
// Documentación: https://console.groq.com/docs/libraries

async function* streamGroq(messages, model, apiKey) {
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ],
    max_tokens: 2048,
    temperature: 0.7,
    stream: true,
  };

  let response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    yield `\n\n🌐 **Error de conexión con Groq:** ${e.message}`;
    return;
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    yield `\n\n❌ **Error Groq ${response.status}:** ${err?.error?.message || response.statusText}`;
    return;
  }

  for await (const raw of streamTextChunks(response)) {
    try {
      const data = JSON.parse(raw);
      const token = data?.choices?.[0]?.delta?.content;
      if (token) yield token;
    } catch { /* fragmento parcial, ignorar */ }
  }
}

// ── ANTHROPIC ───────────────────────────────────────────────
// Documentación: https://docs.anthropic.com/en/api/messages-streaming
// NOTA: La API de Anthropic no permite llamadas directas desde el navegador
// (bloqueo CORS). Para producción, usa un backend proxy (Cloudflare Worker,
// Vercel Edge Function, etc.) o usa el proveedor Groq/OpenAI directamente.
// Se incluye aquí para referencia y uso en entornos con proxy configurado.

async function* streamAnthropic(messages, model, apiKey, proxyUrl = null) {
  const endpoint = proxyUrl || "https://api.anthropic.com/v1/messages";

  const body = {
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: true,
  };

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    yield `\n\n🌐 **Error de conexión con Anthropic:** ${e.message}  \n**Nota:** Anthropic bloquea llamadas directas desde navegadores (CORS). Configura un proxy en \`js/app.js\` → \`ANTHROPIC_PROXY_URL\`.`;
    return;
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) {
      yield "\n\n❌ **API Key de Anthropic inválida.** Verifica en [console.anthropic.com](https://console.anthropic.com)";
    } else {
      yield `\n\n❌ **Error Anthropic ${response.status}:** ${err?.error?.message || response.statusText}`;
    }
    return;
  }

  for await (const raw of streamTextChunks(response)) {
    try {
      const data = JSON.parse(raw);
      if (data.type === "content_block_delta" && data.delta?.text) {
        yield data.delta.text;
      } else if (data.type === "content_block_start" && data.content_block?.type === "tool_use") {
        yield "\n\n🔍 *Buscando información actualizada…*\n\n";
      }
    } catch { /* parcial */ }
  }
}

// ── OPENAI ──────────────────────────────────────────────────

async function* streamOpenAI(messages, model, apiKey) {
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ],
    max_tokens: 2048,
    temperature: 0.7,
    stream: true,
  };

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    yield `\n\n🌐 **Error de conexión con OpenAI:** ${e.message}`;
    return;
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) {
      yield "\n\n❌ **API Key de OpenAI inválida.** Verifica en [platform.openai.com](https://platform.openai.com)";
    } else {
      yield `\n\n❌ **Error OpenAI ${response.status}:** ${err?.error?.message || response.statusText}`;
    }
    return;
  }

  for await (const raw of streamTextChunks(response)) {
    try {
      const data = JSON.parse(raw);
      const token = data?.choices?.[0]?.delta?.content;
      if (token) yield token;
    } catch { /* parcial */ }
  }
}

// ── GOOGLE GEMINI ───────────────────────────────────────────
// Usa la REST API de Gemini con streaming (SSE)

async function* streamGoogle(messages, model, apiKey) {
  // Convertir historial al formato de Gemini
  const geminiMessages = messages.map(m => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  // El system prompt se inyecta como primer turno de "model" en Gemini REST
  const contents = [
    { role: "user",  parts: [{ text: "Actúa como LEGALI según el siguiente system prompt:" }] },
    { role: "model", parts: [{ text: SYSTEM_PROMPT }] },
    ...geminiMessages,
  ];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
      }),
    });
  } catch (e) {
    yield `\n\n🌐 **Error de conexión con Gemini:** ${e.message}`;
    return;
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    yield `\n\n❌ **Error Google Gemini ${response.status}:** ${err?.error?.message || response.statusText}`;
    return;
  }

  for await (const raw of streamTextChunks(response)) {
    try {
      const data = JSON.parse(raw);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) yield text;
    } catch { /* parcial */ }
  }
}

// ── Dispatcher principal ────────────────────────────────────

const ANTHROPIC_PROXY_URL = "https://legali-proxy.sebas20031314.workers.dev"; // Configura aquí tu proxy si usas Anthropic
// Ejemplo: "https://mi-worker.mi-usuario.workers.dev/anthropic"

async function* streamProvider(provider, messages, apiKey, model) {
  switch (provider) {
    case "groq":      yield* streamGroq(messages, model, apiKey);      break;
    case "anthropic": yield* streamAnthropic(messages, model, apiKey, ANTHROPIC_PROXY_URL); break;
    case "openai":    yield* streamOpenAI(messages, model, apiKey);    break;
    case "google":    yield* streamGoogle(messages, model, apiKey);    break;
    default:
      yield `❌ Proveedor "${provider}" no configurado.`;
  }
}