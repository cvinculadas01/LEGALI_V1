/**
 * auth.js — Guard de autenticación LEGALI
 * Incluir como PRIMER script en index.html y usuario.html
 * Redirige al login si no hay sesión válida o el rol no coincide.
 */
(function() {
  const stored = sessionStorage.getItem('legali_user');
  let user = null;

  try {
    if (stored) user = JSON.parse(stored);
  } catch(e) {
    sessionStorage.removeItem('legali_user');
  }

  // Determinar qué rol requiere esta página
  const page = location.pathname.split('/').pop() || 'index.html';
  const requiredRole = page === 'index.html' ? 'admin' : 'user';

  // Sin sesión → login
  if (!user || !user.role) {
    location.replace('login.html');
    throw new Error('No session'); // detener ejecución del resto del JS
  }

  // Rol incorrecto → redirigir a la página correcta para su rol
  if (user.role !== requiredRole) {
    location.replace(user.role === 'admin' ? 'index.html' : 'usuario.html');
    throw new Error('Wrong role');
  }

  // Exponer usuario globalmente para que app.js lo use
  window.LEGALI_USER = user;
})();

/**
 * Cerrar sesión — llamar desde cualquier página
 */
function legaliLogout() {
  sessionStorage.removeItem('legali_user');
  location.replace('login.html');
}

/**
 * Hash SHA-256 (Web Crypto API) — usado en login.html
 * Exportado globalmente por si otras partes lo necesitan.
 */
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data     = encoder.encode(password);
  const hashBuf  = await crypto.subtle.digest('SHA-256', data);
  const hashArr  = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
}
