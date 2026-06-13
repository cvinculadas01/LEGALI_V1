// ============================================================
// LEGALI v2.0 — supabase/functions/ai-proxy/index.ts
// Edge Function: proxy seguro hacia Groq / OpenAI / Anthropic
// ACTUALIZACIÓN: integra check_rate_limit (migración 003)
// Deploy: supabase functions deploy ai-proxy
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS headers ──────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Modelos permitidos por proveedor ─────────────────────────
const ALLOWED_MODELS: Record<string, string[]> = {
  groq: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b-32768",
  ],
  openai: [
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-3.5-turbo",
  ],
  anthropic: [
    "claude-sonnet-4-6",
    "claude-opus-4-8",
    "claude-haiku-4-5-20251001",
  ],
};

// ── Límites de rate por plan ──────────────────────────────────
// Peticiones máximas por minuto según plan
const RATE_LIMITS: Record<string, number> = {
  gratis:       5,
  consultorio: 15,
  profesional: 30,
  firma:       60,
  admin:       60,
};

// ── API endpoints ─────────────────────────────────────────────
const ENDPOINTS: Record<string, string> = {
  groq:      "https://api.groq.com/openai/v1/chat/completions",
  openai:    "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS });
  }

  // ── 1. Validar JWT de sesión ────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return _error(401, "auth_error", "JWT requerido");
  }

  const token = authHeader.slice(7);

  const sbAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const { data: { user }, error: authErr } = await sbAdmin.auth.getUser(token);
  if (authErr || !user) {
    return _error(401, "auth_error", "Sesión inválida o expirada");
  }

  // ── 2. Verificar cuota (check_user_quota incluye estado activo) ─
  const { data: quotaResult, error: quotaErr } = await sbAdmin
    .rpc("check_user_quota", { p_user_id: user.id });

  if (quotaErr) {
    console.error("check_user_quota error:", quotaErr);
    return _error(500, "server_error", "Error verificando cuota");
  }

  if (!quotaResult?.allowed) {
    const reason = quotaResult?.reason || "quota_exhausted";
    const status = reason === "account_suspended" ? 403 : 402;
    return _error(status, reason, "Acceso denegado");
  }

  // ── 3. Rate limiting por usuario (migración 003) ─────────────
  // Obtener el plan del usuario para aplicar el límite correcto
  const { data: profile } = await sbAdmin
    .from("legali_profiles")
    .select("plan")
    .eq("id", user.id)
    .maybeSingle();

  const userPlan   = profile?.plan || "gratis";
  const rateLimit  = RATE_LIMITS[userPlan] || RATE_LIMITS.gratis;

  const { data: rateResult, error: rateErr } = await sbAdmin
    .rpc("check_rate_limit", {
      p_user_id:        user.id,
      p_max_per_minute: rateLimit,
    });

  if (rateErr) {
    // Si la función no existe (ej. migración 003 no aplicada), log y seguir
    console.warn("check_rate_limit no disponible:", rateErr.message);
  } else if (rateResult && !rateResult.allowed) {
    return _error(429, "rate_limited",
      `Demasiadas peticiones. Límite: ${rateLimit} por minuto.`
    );
  }

  // ── 4. Parsear body ─────────────────────────────────────────
  let body: {
    provider:      string;
    model:         string;
    messages:      { role: string; content: string }[];
    system_prompt?: string;
  };

  try {
    body = await req.json();
  } catch (_) {
    return _error(400, "invalid_body", "JSON inválido");
  }

  const { provider, model, messages, system_prompt } = body;

  // Validar proveedor y modelo
  if (!ALLOWED_MODELS[provider]) {
    return _error(400, "invalid_provider", `Proveedor no permitido: ${provider}`);
  }
  if (!ALLOWED_MODELS[provider].includes(model)) {
    return _error(400, "invalid_model", `Modelo no permitido: ${model}`);
  }
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return _error(400, "invalid_messages", "messages requerido");
  }

  // ── 5. Obtener API key del servidor ─────────────────────────
  const apiKey = _getApiKey(provider);
  if (!apiKey) {
    return _error(500, "config_error", `API key no configurada para ${provider}`);
  }

  // ── 6. Llamar proveedor de IA ────────────────────────────────
  try {
    const aiResponse = await _callProvider({
      provider, model, apiKey, messages, system_prompt,
    });

    if (!aiResponse.ok) {
      const errBody = await aiResponse.text();
      console.error(`${provider} error ${aiResponse.status}:`, errBody);
      return _error(502, "provider_error", `Error del proveedor IA: ${aiResponse.status}`);
    }

    // Pasar el stream SSE directamente al cliente
    return new Response(aiResponse.body, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "X-Provider":    provider,
        "X-Model":       model,
      },
    });

  } catch (e) {
    console.error("_callProvider error:", e);
    return _error(502, "provider_error", "No se pudo contactar al proveedor IA");
  }
});

// ── Llamar proveedor ──────────────────────────────────────────
async function _callProvider({
  provider, model, apiKey, messages, system_prompt,
}: {
  provider:      string;
  model:         string;
  apiKey:        string;
  messages:      { role: string; content: string }[];
  system_prompt?: string;
}): Promise<Response> {
  const endpoint = ENDPOINTS[provider];
  const sysPrompt = system_prompt || _defaultSystemPrompt();

  if (provider === "anthropic") {
    return await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        stream:     true,
        system:     sysPrompt,
        messages:   messages.filter(m => m.role !== "system"),
      }),
    });
  }

  // OpenAI / Groq (formato compatible)
  const openaiMessages = [
    { role: "system", content: sysPrompt },
    ...messages.filter(m => m.role !== "system"),
  ];

  return await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages:    openaiMessages,
      max_tokens:  2048,
      stream:      true,
      temperature: 0.3,
    }),
  });
}

// ── Obtener key de entorno ────────────────────────────────────
function _getApiKey(provider: string): string | undefined {
  switch (provider) {
    case "groq":      return Deno.env.get("GROQ_KEY");
    case "openai":    return Deno.env.get("OPENAI_KEY");
    case "anthropic": return Deno.env.get("ANTHROPIC_KEY");
    default:          return undefined;
  }
}

// ── System prompt por defecto ────────────────────────────────
function _defaultSystemPrompt(): string {
  return `Eres LEGALI, un asistente jurídico especializado en Derecho Procesal Colombiano.
Tienes conocimiento profundo sobre el CGP (Ley 1564/2012), CPACA (Ley 1437/2011),
CPP (Ley 906/2004), CPL, la Constitución de 1991 y la jurisprudencia de la
Corte Constitucional, Consejo de Estado y Corte Suprema de Justicia.
Cita siempre artículos y sentencias relevantes. Responde en español.
No reemplazas la asesoría de un abogado habilitado (Ley 1123/2007).`;
}

// ── Helper de error ───────────────────────────────────────────
function _error(status: number, reason: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: true, reason, message }),
    {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    }
  );
}
