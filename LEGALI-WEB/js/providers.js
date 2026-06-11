// ============================================================
// LEGALI v2.0 — js/providers.js
// Streaming vía proxy Edge Function. Sin API keys en frontend.
// ============================================================

'use strict';

// Modo desarrollo: simula respuesta sin llamar al proxy
const DEV_MODE = false;

// ── Stream principal ──────────────────────────────────────────
/**
 * @param {Object}   opts
 * @param {Array}    opts.messages       Array { role, content }
 * @param {string}   opts.provider       'groq' | 'openai' | 'anthropic'
 * @param {string}   opts.model          Nombre del modelo
 * @param {string}   [opts.systemPrompt] System prompt completo
 * @param {Function} opts.onChunk        Callback(chunk: string)
 * @param {Function} [opts.onDone]       Callback(fullText: string)
 * @param {Function} [opts.onError]      Callback(error: Error)
 * @returns {Promise<string>}            Texto completo generado
 */
async function streamProvider({ messages, provider, model, systemPrompt, onChunk, onDone, onError }) {
  if (DEV_MODE) {
    return _devModeResponse(onChunk, onDone);
  }

  // Obtener JWT de sesión
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.access_token) {
    const err = new Error(ERROR_MESSAGES.auth_error);
    if (onError) onError(err);
    throw err;
  }

  let fullText = '';

  try {
    const response = await fetch(AI_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        provider,
        model,
        system_prompt: systemPrompt || SYSTEM_PROMPT,
        messages,
      }),
    });

    // Manejo de errores HTTP
    if (!response.ok) {
      let reason = 'provider_error';
      try {
        const body = await response.json();
        reason = body.reason || reason;
      } catch (_) {}

      const msg = response.status === 402
        ? ERROR_MESSAGES.quota_exhausted
        : response.status === 401
        ? ERROR_MESSAGES.auth_error
        : response.status === 403
        ? ERROR_MESSAGES.account_suspended
        : ERROR_MESSAGES.provider_error;

      const err = new Error(msg);
      err.status = response.status;
      err.reason = reason;
      if (onError) onError(err);
      throw err;
    }

    // Parsear SSE
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // última línea puede estar incompleta

      for (const line of lines) {
        const chunk = _parseSseLine(line, provider);
        if (chunk === '[DONE]') break;
        if (chunk) {
          fullText += chunk;
          if (onChunk) onChunk(chunk);
        }
      }
    }

    // Procesar buffer restante
    if (buffer.trim()) {
      const chunk = _parseSseLine(buffer, provider);
      if (chunk && chunk !== '[DONE]') {
        fullText += chunk;
        if (onChunk) onChunk(chunk);
      }
    }

    if (onDone) onDone(fullText);
    return fullText;

  } catch (e) {
    if (!e.status) {
      // Error de red
      const networkErr = new Error(ERROR_MESSAGES.network_error);
      if (onError) onError(networkErr);
      throw networkErr;
    }
    throw e;
  }
}

// ── Parser de líneas SSE ──────────────────────────────────────
function _parseSseLine(line, provider) {
  if (!line.startsWith('data:')) return null;

  const raw = line.slice(5).trim();
  if (raw === '[DONE]') return '[DONE]';
  if (!raw) return null;

  try {
    const json = JSON.parse(raw);

    // Formato OpenAI / Groq
    if (json.choices?.[0]?.delta?.content !== undefined) {
      return json.choices[0].delta.content;
    }

    // Formato Anthropic
    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
      return json.delta.text;
    }
    if (json.type === 'message_delta' || json.type === 'message_stop') {
      return null;
    }

    // Formato normalizado del proxy (fallback)
    if (typeof json.text === 'string') {
      return json.text;
    }

    return null;
  } catch (_) {
    return null;
  }
}

// ── Modo desarrollo ───────────────────────────────────────────
async function _devModeResponse(onChunk, onDone) {
  const response = 'DEV MODE: El proxy de IA no está configurado. ' +
    'Sube la Edge Function `ai-proxy` a Supabase para activar el chat real. ' +
    'Ver instrucciones en `supabase/functions/ai-proxy/index.ts`.';

  const words = response.split(' ');
  let full = '';

  for (const word of words) {
    await new Promise(r => setTimeout(r, 40));
    const chunk = word + ' ';
    full += chunk;
    if (onChunk) onChunk(chunk);
  }

  if (onDone) onDone(full.trim());
  return full.trim();
}
