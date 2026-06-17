// ============================================================
// LEGALI v3.0 — supabase/functions/ai-proxy/index.ts
// Edge Function: proxy seguro Groq / Anthropic
//
// Cambios v3.0:
//   - 3 planes: gratis / profesional / firma (eliminado consultorio/openai)
//   - max_tokens dinámico por plan
//   - Retry: ANTHROPIC_KEY → ANTHROPIC_KEY_2 → Groq fallback
//   - Timeouts diferenciados: firma 20s, pro 12s, gratis 8s
//   - Audit log enriquecido con key_used y fallback_active
//   - Header X-Priority: high para plan firma
//   - Header X-Fallback-Active: true cuando se usa Groq como fallback
//
// Deploy: supabase functions deploy ai-proxy
//
// Secrets requeridos en Supabase:
//   GROQ_KEY              → gsk-...
//   ANTHROPIC_KEY         → sk-ant-... (key principal)
//   ANTHROPIC_KEY_2       → sk-ant-... (key de respaldo — opcional)
//   LEGALI_SITE_URL       → https://tudominio.com
//   SUPABASE_URL          → automático
//   SUPABASE_SERVICE_ROLE_KEY → automático
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS ──────────────────────────────────────────────────────
const SITE_URL = Deno.env.get("LEGALI_SITE_URL") || "*";
const CORS = {
  "Access-Control-Allow-Origin":  SITE_URL,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Modelos permitidos ────────────────────────────────────────
const ALLOWED_MODELS: Record<string, string[]> = {
  groq:      ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-6"],
};

// ── Límites por plan ──────────────────────────────────────────
// rate_limit:        consultas permitidas por minuto
// max_tokens_output: tokens máximos en la respuesta
// timeout_ms:        timeout por intento con Anthropic
// max_retries:       reintentos con Anthropic antes de caer a Groq
const PLAN_LIMITS: Record<string, {
  rate_limit:        number;
  max_tokens_output: number;
  timeout_ms:        number;
  max_retries:       number;
}> = {
  gratis:      { rate_limit: 2,  max_tokens_output: 500,  timeout_ms: 8000,  max_retries: 0 },
  profesional: { rate_limit: 5,  max_tokens_output: 2000, timeout_ms: 12000, max_retries: 2 },
  firma:       { rate_limit: 10, max_tokens_output: 3500, timeout_ms: 20000, max_retries: 3 },
  admin:       { rate_limit: 60, max_tokens_output: 4096, timeout_ms: 20000, max_retries: 3 },
};

// ── API endpoints ─────────────────────────────────────────────
const ENDPOINTS: Record<string, string> = {
  groq:      "https://api.groq.com/openai/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

// ── Handler principal ─────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return new Response("Method Not Allowed", { status: 405, headers: CORS });

  // ── 1. Validar JWT ───────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return _error(401, "auth_error", "JWT requerido");

  const token   = authHeader.slice(7);
  const sbAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const { data: { user }, error: authErr } = await sbAdmin.auth.getUser(token);
  if (authErr || !user) return _error(401, "auth_error", "Sesión inválida o expirada");

  // ── 2. Verificar cuota ───────────────────────────────────────
  const { data: quotaResult, error: quotaErr } = await sbAdmin
    .rpc("check_user_quota", { p_user_id: user.id });

  if (quotaErr) return _error(500, "server_error", "Error verificando cuota");
  if (!quotaResult?.allowed) {
    const reason = quotaResult?.reason || "quota_exhausted";
    return _error(reason === "account_suspended" ? 403 : 402, reason, "Acceso denegado");
  }

  // ── 3. Rate limiting ─────────────────────────────────────────
  const { data: profile } = await sbAdmin
    .from("legali_profiles")
    .select("plan")
    .eq("id", user.id)
    .maybeSingle();

  const userPlan = profile?.plan || "gratis";
  const limits   = PLAN_LIMITS[userPlan] || PLAN_LIMITS.gratis;

  const { data: rateResult, error: rateErr } = await sbAdmin
    .rpc("check_rate_limit", { p_user_id: user.id, p_max_per_minute: limits.rate_limit });

  if (!rateErr && rateResult && !rateResult.allowed) {
    return new Response(
      JSON.stringify({
        error:   true,
        reason:  "rate_limited",
        message: `Demasiadas peticiones. Límite: ${limits.rate_limit}/min.`,
      }),
      {
        status: 429,
        headers: {
          ...CORS,
          "Content-Type":       "application/json",
          "Retry-After":        "60",
          "X-RateLimit-Limit":  String(limits.rate_limit),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  // ── 4. Parsear body ──────────────────────────────────────────
  let body: {
    provider:      string;
    model:         string;
    messages:      { role: string; content: string }[];
    system_prompt?: string;
  };
  try { body = await req.json(); }
  catch (_) { return _error(400, "invalid_body", "JSON inválido"); }

  const { provider, model, messages, system_prompt } = body;

  if (!ALLOWED_MODELS[provider])
    return _error(400, "invalid_provider", `Proveedor no permitido: ${provider}`);
  if (!ALLOWED_MODELS[provider].includes(model))
    return _error(400, "invalid_model", `Modelo no permitido: ${model}`);
  if (!messages?.length)
    return _error(400, "invalid_messages", "messages requerido");

  // ── 5. Llamar proveedor con retry y fallback ─────────────────
  const startedAt    = Date.now();
  let aiResponse: Response | null = null;
  let usedKey        = "";
  let usedProvider   = provider;
  let fallbackActive = false;

  if (provider === "anthropic") {
    const key1 = Deno.env.get("ANTHROPIC_KEY");
    const key2 = Deno.env.get("ANTHROPIC_KEY_2");
    const keys = [
      key1 ? { key: key1, label: "KEY_1" } : null,
      key2 ? { key: key2, label: "KEY_2" } : null,
    ].filter(Boolean) as { key: string; label: string }[];

    // Intentar con cada key de Anthropic
    for (const { key, label } of keys) {
      if (aiResponse) break;
      for (let attempt = 0; attempt <= limits.max_retries && !aiResponse; attempt++) {
        try {
          const r = await _callWithTimeout(
            {
              provider:    "anthropic",
              model,
              apiKey:      key,
              messages,
              system_prompt,
              max_tokens:  limits.max_tokens_output,
            },
            limits.timeout_ms
          );
          if (r.ok) {
            aiResponse = r;
            usedKey    = label;
          } else if (r.status === 429 || r.status >= 500) {
            if (attempt < limits.max_retries) await _sleep(1500);
          } else {
            break; // Error 4xx no retriable
          }
        } catch (_) {
          if (attempt < limits.max_retries) await _sleep(1000);
        }
      }
    }

    // Fallback a Groq si Anthropic falló completamente
    if (!aiResponse) {
      const groqKey = Deno.env.get("GROQ_KEY");
      if (groqKey) {
        try {
          const fallbackModel = "llama-3.3-70b-versatile";
          const r = await _callWithTimeout(
            {
              provider:   "groq",
              model:      fallbackModel,
              apiKey:     groqKey,
              messages,
              system_prompt,
              max_tokens: Math.min(limits.max_tokens_output, 1500),
            },
            15000
          );
          if (r.ok) {
            aiResponse     = r;
            usedProvider   = "groq";
            usedKey        = "GROQ_FALLBACK";
            fallbackActive = true;
          }
        } catch (_) {}
      }
    }

  } else {
    // Plan gratis → Groq directo (sin retry)
    const groqKey = Deno.env.get("GROQ_KEY");
    if (!groqKey) return _error(500, "config_error", "GROQ_KEY no configurada");
    try {
      aiResponse = await _callWithTimeout(
        {
          provider:   "groq",
          model,
          apiKey:     groqKey,
          messages,
          system_prompt,
          max_tokens: limits.max_tokens_output,
        },
        limits.timeout_ms
      );
      usedKey = "GROQ";
    } catch (_) {}
  }

  // ── 6. Error si todos los proveedores fallaron ────────────────
  if (!aiResponse || !aiResponse.ok) {
    await _logAudit(sbAdmin, {
      user_id:  user.id,
      action:   "query_error",
      provider: usedProvider,
      model,
      meta:     { plan: userPlan, key_used: usedKey, fallback: fallbackActive },
    });
    return _error(502, "provider_error", "No se pudo contactar al proveedor de IA");
  }

  // ── 7. Log de uso exitoso ────────────────────────────────────
  const inputChars  = messages.reduce((acc, m) => acc + m.content.length, 0);
  const tokensInEst = Math.ceil(inputChars / 4);

  _logAudit(sbAdmin, {
    user_id:  user.id,
    action:   "query",
    provider: usedProvider,
    model,
    tokens_in: tokensInEst,
    meta: {
      plan:            userPlan,
      key_used:        usedKey,
      fallback_active: fallbackActive,
      latency_ms:      Date.now() - startedAt,
    },
  }).catch(e => console.warn("logAudit error:", e));

  // ── 8. Devolver stream SSE al cliente ────────────────────────
  return new Response(aiResponse.body, {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
      "X-Provider":    usedProvider,
      "X-Model":       model,
      "X-Plan":        userPlan,
      ...(fallbackActive          ? { "X-Fallback-Active": "true" } : {}),
      ...(userPlan === "firma"    ? { "X-Priority": "high" }        : {}),
    },
  });
});

// ── Llamar proveedor con timeout ──────────────────────────────
async function _callWithTimeout(
  opts: {
    provider:      string;
    model:         string;
    apiKey:        string;
    messages:      { role: string; content: string }[];
    system_prompt?: string;
    max_tokens:    number;
  },
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await _callProvider({ ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Llamar proveedor (Anthropic o Groq) ───────────────────────
async function _callProvider(opts: {
  provider:      string;
  model:         string;
  apiKey:        string;
  messages:      { role: string; content: string }[];
  system_prompt?: string;
  max_tokens:    number;
  signal?:       AbortSignal;
}): Promise<Response> {
  const { provider, model, apiKey, messages, system_prompt, max_tokens, signal } = opts;
  const sysPrompt = system_prompt || _defaultSystemPrompt();

  if (provider === "anthropic") {
    return await fetch(ENDPOINTS.anthropic, {
      method: "POST",
      signal,
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens,
        stream: true,
        system: sysPrompt,
        messages: messages.filter(m => m.role !== "system"),
      }),
    });
  }

  // Groq — formato OpenAI-compatible
  return await fetch(ENDPOINTS.groq, {
    method: "POST",
    signal,
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: sysPrompt },
        ...messages.filter(m => m.role !== "system"),
      ],
      max_tokens,
      stream:      true,
      temperature: 0.3,
    }),
  });
}

// ── Registrar en audit_logs ───────────────────────────────────
async function _logAudit(
  sbAdmin: ReturnType<typeof createClient>,
  data: {
    user_id:    string;
    action:     string;
    provider:   string;
    model:      string;
    tokens_in?:  number;
    tokens_out?: number;
    session_id?: string;
    meta?:       Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { error } = await sbAdmin.from("audit_logs").insert({
      user_id:    data.user_id,
      action:     data.action,
      provider:   data.provider,
      model:      data.model,
      tokens_in:  data.tokens_in  || 0,
      tokens_out: data.tokens_out || 0,
      session_id: data.session_id || null,
      meta:       data.meta       || null,
    });
    if (error) console.warn("audit_logs insert error:", error.message);
  } catch (e) {
    console.warn("_logAudit exception:", e);
  }
}

// ── Utilidades ────────────────────────────────────────────────
function _sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function _defaultSystemPrompt(): string {
  return `Eres LEGALI, un asistente jurídico especializado en Derecho Procesal Colombiano.
Tienes conocimiento profundo sobre el CGP (Ley 1564/2012), CPACA (Ley 1437/2011),
CPP (Ley 906/2004), CPL, la Constitución de 1991 y la jurisprudencia de la
Corte Constitucional, Consejo de Estado y Corte Suprema de Justicia.
Cita siempre artículos y sentencias relevantes. Responde en español.
No reemplazas la asesoría de un abogado habilitado (Ley 1123/2007).`;
}

function _error(status: number, reason: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: true, reason, message }),
    { status, headers: { ...CORS, "Content-Type": "application/json" } }
  );
}
