// ============================================================
// LEGALI v2.0 — js/payment-keys.js
// Configuración de llaves públicas de pasarelas de pago
// ============================================================
//
// Este archivo se cargó SEPARADO de payments.js para que el
// cambio de llave (sandbox → producción) sea de UNA sola línea
// en UN solo archivo, sin tocar la lógica de pagos.
//
// IMPORTANTE:
// - La "public-key" de Wompi NO es secreta (se expone en el
//   navegador por diseño), pero igual debe corresponder al
//   ambiente correcto (sandbox o producción).
// - El "Events Secret" de Wompi y el "Access Token" de
//   MercadoPago SÍ son secretos y NUNCA van aquí — esos se
//   configuran como Supabase secrets (ver PENDIENTES_CONFIG.md):
//     supabase secrets set WOMPI_EVENTS_SECRET=...
//     supabase secrets set MP_ACCESS_TOKEN=...
//
// ── PASO PENDIENTE (Punto 4 / sección 5.1 del plan) ──────────
// 1. Crear cuenta sandbox gratuita en https://comercios.wompi.co/
// 2. Copiar la "Llave pública" (formato: pub_test_xxxxxxxxxxxx)
// 3. Reemplazar el valor de abajo
//
// Cuando se migre a producción (Punto 6.4):
//   - Reemplazar por la llave pub_prod_xxxxxxxxxxxx
//   - No es necesario tocar payments.js
// ============================================================

window.LEGALI_PAYMENT_KEYS = {
  // Reemplazar con tu llave pública real de Wompi (sandbox o producción)
  WOMPI_PUBLIC_KEY: 'pub_test_REEMPLAZAR_CON_TU_LLAVE_SANDBOX',
};
