// ============================================================
// LEGALI v2.0 — js/quota.js
// Verificación y control de cuota de consultas
// ============================================================

'use strict';

const _sbQuota = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Verificar si el usuario puede hacer una consulta ─────────
async function checkQuota() {
  const user = window.LEGALI_USER;
  if (!user) return { allowed: false, reason: 'no_session' };

  // Plan ilimitado (firma/admin)
  if (user.quota_total === 9999) return { allowed: true };

  // Verificación local rápida
  if (user.quota_used >= user.quota_total) {
    return { allowed: false, reason: 'quota_exhausted' };
  }

  // Verificación remota para evitar manipulación
  try {
    const { data, error } = await _sbQuota.rpc('check_user_quota', {
      p_user_id: user.id,
    });
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('checkQuota error:', e);
    // Si falla la verificación remota, confiar en estado local
    return user.quota_used < user.quota_total
      ? { allowed: true }
      : { allowed: false, reason: 'quota_exhausted' };
  }
}

// ── Incrementar cuota tras consulta exitosa ───────────────────
async function incrementQuota() {
  const user = window.LEGALI_USER;
  if (!user) return;
  if (user.quota_total === 9999) return; // ilimitado, no incrementar

  try {
    const { error } = await _sbQuota.rpc('increment_quota_used', {
      p_user_id: user.id,
    });
    if (error) throw error;

    // Actualizar estado local
    user.quota_used = (user.quota_used || 0) + 1;

    // Notificar a usuario.html para refrescar widget
    window.dispatchEvent(new CustomEvent('legali:query_sent', {
      detail: { used: user.quota_used, total: user.quota_total }
    }));
  } catch (e) {
    console.error('incrementQuota error:', e);
  }
}

// ── Bloquear UI cuando cuota está agotada ────────────────────
function blockUIOnQuotaExhausted(reason) {
  const input = document.getElementById('userInput');
  const btn   = document.getElementById('sendBtn');

  if (input) {
    input.disabled = true;
    input.placeholder = reason === 'account_suspended'
      ? 'Cuenta suspendida. Contacta soporte.'
      : 'Cuota agotada. Actualiza tu plan en planes.html';
  }
  if (btn) btn.disabled = true;

  // Mostrar banner si existe
  const banner = document.getElementById('quotaExhausted');
  if (banner) banner.style.display = 'block';
}

// ── Desbloquear UI ────────────────────────────────────────────
function unblockUI() {
  const input = document.getElementById('userInput');
  const btn   = document.getElementById('sendBtn');
  if (input) { input.disabled = false; input.placeholder = 'Consulta sobre derecho procesal colombiano...'; }
  if (btn)   { btn.disabled = false; }
}
