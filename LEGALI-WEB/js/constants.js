// ============================================================
// LEGALI v3.0 — js/constants.js
// Sin API keys. Solo configuración de UI y lógica de negocio.
// Cambios v3.0:
//   - Eliminado plan 'consultorio' y proveedor 'openai'
//   - Agregado showQuota (oculta barra de cuota a planes de pago)
//   - Modelos actualizados: firma → claude-opus-4-6
//   - Colores y emojis actualizados
// ============================================================

'use strict';

// ── Supabase ──────────────────────────────────────────────────
const SUPABASE_URL = "https://gunfflxviwauixdymsfk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_sHvriOKj2t58aApfn9kCSw_U5gAVn-v";
const AI_PROXY_URL = `${SUPABASE_URL}/functions/v1/ai-proxy`;

// ── Planes y cuotas ───────────────────────────────────────────
const PLAN_CONFIG = {
  gratis: {
    label:     'Plan Gratis',
    quota:     5,
    provider:  'groq',
    model:     'llama-3.3-70b-versatile',
    maxDocMB:  0,
    color:     '#8899AA',
    emoji:     '🆓',
    showQuota: true,    // Mostrar barra de cuota al usuario
  },
  profesional: {
    label:     'Profesional',
    quota:     200,     // Interno — NO mostrar al usuario
    provider:  'anthropic',
    model:     'claude-sonnet-4-6',
    maxDocMB:  10,
    color:     '#3B82F6',
    emoji:     '⚖️',
    showQuota: false,   // Ocultar barra de cuota
  },
  firma: {
    label:     'Firma / Juzgado',
    quota:     900,     // Interno — NO mostrar al usuario
    provider:  'anthropic',
    model:     'claude-opus-4-6',
    maxDocMB:  100,
    color:     '#C8960A',
    emoji:     '🏛️',
    showQuota: false,   // Ocultar barra de cuota
  },
  admin: {
    label:     'Administrador',
    quota:     9999,
    provider:  'anthropic',
    model:     'claude-opus-4-6',
    maxDocMB:  500,
    color:     '#F5C842',
    emoji:     '🛡️',
    showQuota: false,
  },
};

// ── Áreas del derecho (sidebar) ───────────────────────────────
const LEGAL_AREAS = [
  { id: 'cgp',   label: 'CGP',   title: 'Código General del Proceso',         emoji: '📋' },
  { id: 'cpaca', label: 'CPACA', title: 'Procedimiento Administrativo',        emoji: '🏛️' },
  { id: 'cpp',   label: 'CPP',   title: 'Código de Procedimiento Penal',       emoji: '⚖️' },
  { id: 'cpl',   label: 'CPL',   title: 'Código Procesal del Trabajo',         emoji: '👷' },
  { id: 'const', label: 'Const', title: 'Constitución Política 1991',          emoji: '📜' },
  { id: 'jur',   label: 'Juris', title: 'Jurisprudencia — Cortes',             emoji: '🔍' },
];

// ── Sugerencias de bienvenida ─────────────────────────────────
const WELCOME_SUGGESTIONS = [
  '¿Cuáles son los requisitos para interponer una demanda ejecutiva según el CGP?',
  '¿Qué es el proceso verbal sumario y cuándo procede?',
  '¿Cuáles son los recursos ordinarios en el proceso civil colombiano?',
  '¿Cómo se notifica el auto admisorio de la demanda?',
  '¿Qué es la caducidad de la acción contencioso-administrativa?',
  '¿Cuál es el término para contestar una demanda ordinaria?',
  '¿Qué medidas cautelares existen en el proceso civil colombiano?',
  '¿Cuándo procede el proceso de tutela y cuáles son sus requisitos?',
];

// ── System prompt principal ───────────────────────────────────
const SYSTEM_PROMPT = `Eres LEGALI, un asistente jurídico especializado en Derecho Procesal Colombiano.

## Especialización
Tienes conocimiento profundo y actualizado sobre:
- **Código General del Proceso (CGP)** — Ley 1564 de 2012 y sus reformas
- **CPACA** — Código de Procedimiento Administrativo y de lo Contencioso Administrativo (Ley 1437 de 2011)
- **Código de Procedimiento Penal (CPP)** — Ley 906 de 2004 (sistema acusatorio)
- **Código Procesal del Trabajo (CPL)** — Decreto 2158 de 1948 y reformas
- **Constitución Política de Colombia de 1991**
- **Jurisprudencia** de la Corte Constitucional, Consejo de Estado y Corte Suprema de Justicia

## Instrucciones de respuesta
1. Cita siempre el artículo, ley y/o sentencia relevante cuando respondas.
2. Usa terminología jurídica precisa pero explica los términos técnicos cuando sea necesario.
3. Estructura las respuestas con encabezados y listas cuando haya múltiples puntos.
4. Si hay jurisprudencia relevante, menciónala (número de sentencia, Corte, año).
5. Cuando el contexto RAG contenga fragmentos relevantes, incorpóralos en tu análisis.
6. Si la pregunta está fuera de tu especialización procesal colombiana, indícalo claramente.
7. **Nunca** inventes normas, artículos o sentencias que no existan.

## Aviso legal
Eres una herramienta de orientación general. Recuerda siempre que no reemplazas la asesoría de un abogado habilitado conforme a la Ley 1123 de 2007.

## Formato
- Responde siempre en español.
- Usa Markdown para formatear (negritas, listas, encabezados).
- Sé conciso pero completo. Prefiere profundidad sobre longitud innecesaria.`;

// ── Parámetros RAG ────────────────────────────────────────────
const RAG_CONFIG = {
  maxResults:  5,
  maxChars:    4000,
  minRank:     0.01,
};

// ── Límites de documentos por plan ───────────────────────────
const DOC_SIZE_LIMITS = {
  gratis:       0,
  profesional:  10  * 1024 * 1024,  // 10 MB
  firma:        100 * 1024 * 1024,  // 100 MB
  admin:        500 * 1024 * 1024,  // 500 MB
};

// ── Mensajes de error amigables ───────────────────────────────
const ERROR_MESSAGES = {
  rate_limited: '⏱️ Demasiadas consultas seguidas. Espera un momento e intenta de nuevo.',
  quota_exhausted:    '⚠️ Has alcanzado el límite de uso de tu plan este mes. <a href="planes.html">Ver planes →</a>',
  account_suspended:  '⛔ Tu cuenta está suspendida. Contacta soporte.',
  profile_not_found:  '❌ Perfil no encontrado. Intenta cerrar sesión y volver a ingresar.',
  network_error:      '🌐 Error de conexión. Verifica tu internet e intenta de nuevo.',
  provider_error:     '🤖 El proveedor de IA no respondió. Intenta en unos segundos.',
  auth_error:         '🔐 Sesión expirada. Vuelve a iniciar sesión.',
  doc_too_large:      '📄 El documento supera el límite de tu plan.',
  doc_type_invalid:   '📎 Solo se aceptan archivos PDF, TXT, MD o DOCX.',
};
