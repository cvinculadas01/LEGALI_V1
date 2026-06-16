// ============================================================
// LEGALI v2.0 — js/auth.js
// Guard para index.html legacy + utilidades de sesión
// ============================================================

'use strict';

(function initAuthGuard() {
  // Solo aplica en index.html (admin legacy)
  if (!document.getElementById('btnToggleLib') &&
      !window.location.pathname.endsWith('index.html') &&
      window.location.pathname !== '/') {
    return;
  }

  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (!session) {
      window.location.href = 'login.html';
      return;
    }

    supabaseClient.from('legali_profiles')
      .select('plan, active')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data: profile }) => {
        if (!profile || !profile.active) {
          supabaseClient.auth.signOut().then(() => {
            window.location.href = 'login.html';
          });
          return;
        }

        if (profile.plan !== 'admin') {
          window.location.href = 'usuario.html';
          return;
        }

        // Es admin en index.html legacy → redirigir al nuevo dashboard
        window.location.href = 'admin/dashboard.html';
      });
  });
})();

// ── Función global de logout (usada en todos los HTMLs) ───────
async function legaliLogout() {
  try {
    await supabaseClient.auth.signOut();
  } catch (e) {
    console.warn('Logout error:', e);
  } finally {
    window.location.href = 'login.html';
  }
}

// ── Obtener sesión activa ─────────────────────────────────────
async function getActiveSession() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  if (error || !session) return null;
  return session;
}

// ── Obtener JWT del usuario actual ────────────────────────────
async function getAccessToken() {
  const session = await getActiveSession();
  return session?.access_token ?? null;
}
