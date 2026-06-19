// ============================================================
// LEGALI v2.0 — supabase/functions/delete-account/index.ts
// Edge Function: elimina el usuario autenticado de Supabase Auth.
//
// Los datos de negocio (legali_profiles y dependientes con
// "on delete cascade") deben eliminarse ANTES desde el frontend
// llamando a la RPC public.delete_my_account_data(), que se
// ejecuta con los privilegios del propio usuario (RLS).
//
// Esta función solo borra el registro en auth.users, lo cual
// requiere SERVICE_ROLE_KEY y por eso no puede hacerse desde
// el frontend.
//
// Deploy: supabase functions deploy delete-account
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function _error(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS });
  }

  // ── 1. Validar JWT del usuario ──────────────────────────────
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

  // ── 2. Borrar usuario de Supabase Auth (service_role) ───────
  // legali_profiles ya debería haber sido eliminado por el
  // frontend vía RPC delete_my_account_data() ANTES de llamar
  // a esta función. Si por algún motivo el perfil aún existe,
  // el trigger/cascada de auth.users -> legali_profiles también
  // lo eliminará al borrar el usuario aquí.
  const { error: deleteErr } = await sbAdmin.auth.admin.deleteUser(user.id);

  if (deleteErr) {
    console.error("delete-account error:", deleteErr);
    return _error(500, "server_error", "No se pudo eliminar el usuario: " + deleteErr.message);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
