// ============================================================
// LEGALI v2.0 — js/payments.js
// Wompi + MercadoPago + activación de plan
// ============================================================

'use strict';

const _sbPay = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Configuración de precios ──────────────────────────────────
const PRICING = {
  consultorio: { usd: 9,  cop: 37800,  annual_usd: 86,  annual_cop: 362880 },
  profesional: { usd: 25, cop: 105000, annual_usd: 240, annual_cop: 1008000 },
  firma:       { usd: 79, cop: 331800, annual_usd: 758, annual_cop: 3182400 },
};

// Wompi public key — configurada en js/payment-keys.js (cargado antes
// que este archivo). Para cambiar de sandbox a producción, editar
// SOLO js/payment-keys.js (ver Punto 6.4 del plan).
const WOMPI_PUBLIC_KEY = (window.LEGALI_PAYMENT_KEYS && window.LEGALI_PAYMENT_KEYS.WOMPI_PUBLIC_KEY)
  || 'pub_test_REEMPLAZAR_CON_TU_LLAVE_SANDBOX';

// ── Wompi Checkout ────────────────────────────────────────────
async function initWompiCheckout(plan, period = 'monthly') {
  const user = window.LEGALI_USER;
  if (!user) { window.location.href = 'login.html'; return; }

  const pricing = PRICING[plan];
  if (!pricing) { console.error('Plan inválido:', plan); return; }

  const amountCop  = period === 'annual' ? pricing.annual_cop : pricing.cop;
  const amountCents = amountCop * 100; // Wompi usa centavos

  // Registrar intención de pago
  const { data: payment, error } = await _sbPay
    .from('legali_payments')
    .insert({
      user_id:    user.id,
      provider:   'wompi',
      plan,
      amount_usd: period === 'annual' ? pricing.annual_usd : pricing.usd,
      amount_cop: amountCop,
      status:     'pending',
    })
    .select('id')
    .single();

  if (error) { console.error('Error registrando pago:', error); return; }

  const reference = `LEGALI-${plan.toUpperCase()}-${payment.id.slice(0, 8).toUpperCase()}`;

  // Construir URL de Wompi
  const params = new URLSearchParams({
    'public-key':          WOMPI_PUBLIC_KEY,
    currency:              'COP',
    'amount-in-cents':     amountCents,
    reference,
    'redirect-url':        `${window.location.origin}/usuario.html?payment=wompi&ref=${reference}&pid=${payment.id}`,
    'customer-data:email': user.email,
  });

  window.open(`https://checkout.wompi.co/p/?${params.toString()}`, '_blank');
}

// ── MercadoPago Checkout ──────────────────────────────────────
async function initMercadoPagoCheckout(plan, period = 'monthly') {
  const user = window.LEGALI_USER;
  if (!user) { window.location.href = 'login.html'; return; }

  const pricing = PRICING[plan];
  if (!pricing) return;

  const amountUsd = period === 'annual' ? pricing.annual_usd : pricing.usd;

  // Registrar intención de pago
  const { data: payment, error } = await _sbPay
    .from('legali_payments')
    .insert({
      user_id:    user.id,
      provider:   'mercadopago',
      plan,
      amount_usd: amountUsd,
      status:     'pending',
    })
    .select('id')
    .single();

  if (error) { console.error('Error MP:', error); return; }

  // Llamar Edge Function para crear preferencia MP
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-mp-preference`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        plan,
        period,
        payment_id:  payment.id,
        amount_usd:  amountUsd,
        user_email:  user.email,
      }),
    });

    const body = await res.json();
    if (body.init_point) {
      window.open(body.init_point, '_blank');
    } else {
      console.error('MP no retornó init_point:', body);
    }
  } catch (e) {
    console.error('Error creando preferencia MP:', e);
  }
}

// ── Activar plan localmente tras pago (webhook lo hace en BD) ─
async function activatePlan(plan) {
  const user = window.LEGALI_USER;
  if (!user) return;

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();

    // El webhook de Wompi/MP activa el plan en BD vía Edge Function.
    // Esta función actualiza el estado local si el usuario ya fue activado.
    const { data: profile } = await _sbPay
      .from('legali_profiles')
      .select('plan, quota_used, quota_total, provider_assigned')
      .eq('id', user.id)
      .maybeSingle();

    if (profile) {
      window.LEGALI_USER.plan          = profile.plan;
      window.LEGALI_USER.quota_used    = profile.quota_used;
      window.LEGALI_USER.quota_total   = profile.quota_total;
      window.LEGALI_USER.provider      = profile.provider_assigned;
    }
  } catch (e) {
    console.error('activatePlan error:', e);
  }
}

// ── Verificar retorno de pago (desde URL params) ──────────────
async function checkPaymentReturn() {
  const params   = new URLSearchParams(window.location.search);
  const provider = params.get('payment');
  const ref      = params.get('ref');
  const pid      = params.get('pid');

  if (!provider || !ref) return;

  // Limpiar URL sin recargar
  const cleanUrl = window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);

  if (provider === 'wompi') {
    // Wompi redirección directa — consultar estado
    await _pollPaymentStatus(pid, provider);
  } else if (provider === 'mercadopago') {
    const status = params.get('collection_status') || params.get('status');
    if (status === 'approved') {
      await activatePlan(null); // Refrescar perfil desde BD
      _showPaymentToast('✅ ¡Pago aprobado! Tu plan ya está activo.');
    } else {
      _showPaymentToast('⚠️ El pago no fue completado. Intenta de nuevo.', 'warn');
    }
  }
}

// ── Polling de estado de pago (Wompi) ────────────────────────
async function _pollPaymentStatus(paymentId, provider, maxAttempts = 8) {
  if (!paymentId) return;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));

    const { data } = await _sbPay
      .from('legali_payments')
      .select('status, plan')
      .eq('id', paymentId)
      .maybeSingle();

    if (data?.status === 'approved') {
      await activatePlan(data.plan);
      _showPaymentToast('✅ ¡Pago aprobado! Tu plan ya está activo.');
      return;
    }
    if (data?.status === 'rejected') {
      _showPaymentToast('❌ Pago rechazado. Verifica tu método de pago.', 'error');
      return;
    }
  }
  _showPaymentToast('⏳ Procesando pago. Puede tomar unos minutos.', 'warn');
}

// ── Toast de notificación ─────────────────────────────────────
function _showPaymentToast(msg, type = 'success') {
  const colors = {
    success: { bg: 'rgba(13,158,108,0.15)', border: 'rgba(13,158,108,0.4)', color: '#6EE7B7' },
    warn:    { bg: 'rgba(217,119,6,0.15)',  border: 'rgba(217,119,6,0.4)',  color: '#FCD34D' },
    error:   { bg: 'rgba(220,38,38,0.15)',  border: 'rgba(220,38,38,0.3)',  color: '#FCA5A5' },
  };
  const c = colors[type] || colors.success;

  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999;
    background:${c.bg}; border:1px solid ${c.border}; color:${c.color};
    padding:14px 20px; border-radius:10px; font-size:14px; font-weight:500;
    max-width:340px; box-shadow:0 8px 32px rgba(0,0,0,0.3);
    animation: slideIn .3s ease;
  `;
  toast.innerHTML = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}
