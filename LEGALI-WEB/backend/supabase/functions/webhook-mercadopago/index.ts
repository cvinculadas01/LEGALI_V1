// ============================================================
// LEGALI v2.0 — supabase/functions/webhook-mercadopago/index.ts
// Edge Function: recibe notificaciones IPN/webhook de MercadoPago
// y activa el plan del usuario tras un pago aprobado.
// Deploy: supabase functions deploy webhook-mercadopago --no-verify-jwt
// Secrets requeridos: MP_ACCESS_TOKEN
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const url = new URL(req.url);

  // MercadoPago puede notificar vía query params (GET/POST) o body JSON.
  let topic = url.searchParams.get("topic") || url.searchParams.get("type");
  let id    = url.searchParams.get("id") || url.searchParams.get("data.id");

  if (req.method === "POST") {
    try {
      const body = await req.json();
      topic = topic || body?.type || body?.topic;
      id    = id    || body?.data?.id || body?.resource;
    } catch (_) {
      // body vacío o no JSON, seguimos con query params
    }
  }

  if (!topic || !id) {
    return new Response("ok", { headers: CORS }); // notificación irrelevante
  }

  // Solo nos interesan notificaciones de pagos
  if (topic !== "payment" && topic !== "payment.created" && topic !== "payment.updated") {
    return new Response("ok", { headers: CORS });
  }

  const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
  if (!mpToken) {
    console.error("MP_ACCESS_TOKEN no configurado");
    return new Response("config_error", { status: 500, headers: CORS });
  }

  // ── Consultar el pago real en la API de MercadoPago ─────────
  try {
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { "Authorization": `Bearer ${mpToken}` },
    });

    if (!mpRes.ok) {
      console.error("Error consultando pago MP:", mpRes.status);
      return new Response("ok", { headers: CORS });
    }

    const payment = await mpRes.json();
    const mpStatus = String(payment.status ?? "").toLowerCase(); // approved | rejected | pending | refunded
    const reference = String(payment.external_reference ?? "");
    const externalId = String(payment.id ?? id);

    let status: "approved" | "rejected" | "refunded" | null = null;
    if (mpStatus === "approved") status = "approved";
    else if (mpStatus === "rejected" || mpStatus === "cancelled") status = "rejected";
    else if (mpStatus === "refunded" || mpStatus === "charged_back") status = "refunded";

    if (!status) {
      // pending/in_process: responder OK sin acción
      return new Response("ok", { headers: CORS });
    }

    const sbAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { data, error } = await sbAdmin.rpc("process_payment_webhook", {
      p_external_id: externalId,
      p_reference:   reference,
      p_status:      status,
      p_raw_payload: payment,
    });

    if (error) {
      console.error("process_payment_webhook error:", error);
    } else {
      console.log("webhook-mercadopago procesado:", data);
    }

    return new Response("ok", { headers: CORS });
  } catch (e) {
    console.error("webhook-mercadopago error:", e);
    return new Response("ok", { headers: CORS }); // evitar reintentos infinitos por error transitorio
  }
});
