// ============================================================
// LEGALI v2.0 — supabase/functions/create-mp-preference/index.ts
// Edge Function: crea una preferencia de pago en MercadoPago
// y devuelve la URL de checkout (init_point) al frontend.
// Deploy: supabase functions deploy create-mp-preference
// Secrets requeridos: MP_ACCESS_TOKEN (modo sandbox: TEST-...)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://cvinculadas01.github.io",
];

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

serve(async (req: Request) => {
  const CORS = corsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS });
  }

  // ── 1. Validar JWT del usuario ──────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return _error(CORS, 401, "auth_error", "JWT requerido");
  }
  const token = authHeader.slice(7);

  const sbAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const { data: { user }, error: authErr } = await sbAdmin.auth.getUser(token);
  if (authErr || !user) {
    return _error(CORS, 401, "auth_error", "Sesión inválida o expirada");
  }

  // ── 2. Parsear body ──────────────────────────────────────────
  let body: {
    plan: string;
    period?: "monthly" | "annual";
    payment_id: string;
    amount_usd: number;
    user_email: string;
  };
  try {
    body = await req.json();
  } catch (_) {
    return _error(CORS, 400, "invalid_body", "JSON inválido");
  }

  const { plan, period = "monthly", payment_id, amount_usd, user_email } = body;
  if (!plan || !payment_id || !amount_usd) {
    return _error(CORS, 400, "invalid_body", "Faltan campos requeridos");
  }

  // Verificar que el pago pertenezca al usuario autenticado
  const { data: payment, error: payErr } = await sbAdmin
    .from("legali_payments")
    .select("id, user_id, plan, status")
    .eq("id", payment_id)
    .maybeSingle();

  if (payErr || !payment || payment.user_id !== user.id) {
    return _error(CORS, 403, "forbidden", "Pago no encontrado o no autorizado");
  }

  // ── 3. Crear preferencia en MercadoPago ─────────────────────
  const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
  if (!mpToken) {
    return _error(CORS, 500, "config_error", "MP_ACCESS_TOKEN no configurado");
  }

  const siteUrl = Deno.env.get("LEGALI_SITE_URL") || "https://cvinculadas01.github.io/LEGALI_V1/LEGALI-WEB";
  const reference = `LEGALI-${plan.toUpperCase()}-${payment_id.slice(0, 8).toUpperCase()}`;

  const preferenceBody = {
    items: [
      {
        title: `LEGALI - Plan ${plan} (${period === "annual" ? "anual" : "mensual"})`,
        quantity: 1,
        unit_price: Number(amount_usd),
        currency_id: "USD",
      },
    ],
    payer: { email: user_email },
    external_reference: reference,
    back_urls: {
      success: `${siteUrl}/usuario.html?payment=mercadopago&status=approved&ref=${reference}`,
      pending: `${siteUrl}/usuario.html?payment=mercadopago&status=pending&ref=${reference}`,
      failure: `${siteUrl}/usuario.html?payment=mercadopago&status=rejected&ref=${reference}`,
    },
    auto_return: "approved",
    notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/webhook-mercadopago`,
  };

  try {
    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${mpToken}`,
      },
      body: JSON.stringify(preferenceBody),
    });

    if (!mpRes.ok) {
      const errBody = await mpRes.text();
      console.error("MercadoPago error:", mpRes.status, errBody);
      return _error(CORS, 502, "provider_error", "Error creando preferencia en MercadoPago");
    }

    const mpData = await mpRes.json();

    // Guardar referencia / preference_id en legali_payments
    await sbAdmin
      .from("legali_payments")
      .update({
        external_id: mpData.id ?? reference,
        status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment_id);

    return new Response(
      JSON.stringify({
        init_point: mpData.init_point ?? mpData.sandbox_init_point,
        preference_id: mpData.id,
        reference,
      }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("create-mp-preference error:", e);
    return _error(CORS, 502, "provider_error", "No se pudo contactar a MercadoPago");
  }
});

function _error(cors: Record<string, string>, status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
