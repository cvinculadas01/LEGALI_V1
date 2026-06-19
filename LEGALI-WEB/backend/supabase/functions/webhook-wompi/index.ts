// ============================================================
// LEGALI v2.0 — supabase/functions/webhook-wompi/index.ts
// Edge Function: recibe eventos de Wompi (transaction.updated)
// y activa el plan del usuario tras un pago aprobado.
// Deploy: supabase functions deploy webhook-wompi --no-verify-jwt
// Secrets requeridos: WOMPI_EVENTS_SECRET
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS });
  }

  let event: any;
  try {
    event = await req.json();
  } catch (_) {
    return new Response("invalid json", { status: 400, headers: CORS });
  }

  // ── 1. Validar firma de integridad de Wompi ─────────────────
  //
  // Wompi envía: event.signature.properties (lista de paths a
  // concatenar), event.signature.checksum (hash esperado) y
  // event.timestamp. El checksum se calcula como:
  //   SHA256( valores_concatenados + timestamp + WOMPI_EVENTS_SECRET )
  const eventsSecret = Deno.env.get("WOMPI_EVENTS_SECRET");
  if (!eventsSecret) {
    console.error("WOMPI_EVENTS_SECRET no configurado");
    return new Response("config_error", { status: 500, headers: CORS });
  }

  const isValid = await _verifyWompiSignature(event, eventsSecret);
  if (!isValid) {
    console.error("Firma de Wompi inválida");
    return new Response("invalid signature", { status: 401, headers: CORS });
  }

  // ── 2. Extraer datos de la transacción ──────────────────────
  const tx = event?.data?.transaction;
  if (!tx) {
    return new Response("ok", { headers: CORS }); // evento sin transacción, ignorar
  }

  const externalId = String(tx.id ?? "");
  const reference  = String(tx.reference ?? "");
  const wompiStatus = String(tx.status ?? "").toUpperCase();

  let status: "approved" | "rejected" | "refunded";
  if (wompiStatus === "APPROVED") status = "approved";
  else if (wompiStatus === "DECLINED" || wompiStatus === "ERROR" || wompiStatus === "VOIDED") status = "rejected";
  else {
    // PENDING u otros estados intermedios: responder OK sin acción
    return new Response("ok", { headers: CORS });
  }

  // ── 3. Procesar de forma idempotente vía RPC ────────────────
  const sbAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await sbAdmin.rpc("process_payment_webhook", {
    p_external_id: externalId,
    p_reference:   reference,
    p_status:      status,
    p_raw_payload: event,
  });

  if (error) {
    console.error("process_payment_webhook error:", error);
    // Igual respondemos 200 para que Wompi no reintente infinitamente
    // si el error es de nuestro lado y ya quedó logueado.
    return new Response("ok", { headers: CORS });
  }

  console.log("webhook-wompi procesado:", data);
  return new Response("ok", { headers: CORS });
});

// ── Verificación de firma Wompi ───────────────────────────────
// Doc: https://docs.wompi.co/en/docs/colombia/eventos/
async function _verifyWompiSignature(event: any, secret: string): Promise<boolean> {
  try {
    const props: string[] = event?.signature?.properties ?? [];
    const expectedChecksum: string = event?.signature?.checksum ?? "";
    const timestamp = event?.timestamp;

    if (!props.length || !expectedChecksum || !timestamp) return false;

    // Concatenar los valores de cada path indicado en `properties`
    let concat = "";
    for (const path of props) {
      const value = _getByPath(event, path);
      concat += String(value ?? "");
    }
    concat += String(timestamp);
    concat += secret;

    const computed = await _sha256Hex(concat);
    return computed.toUpperCase() === expectedChecksum.toUpperCase();
  } catch (e) {
    console.error("Error verificando firma Wompi:", e);
    return false;
  }
}

function _getByPath(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

async function _sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
