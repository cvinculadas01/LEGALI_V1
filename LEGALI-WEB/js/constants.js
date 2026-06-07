// ════════════════════════════════════════════════════════════
// LEGALI — Constantes y configuración
// Equivalente a config/constants.py
// ════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `
Eres LEGALI — La autoridad máxima y definitiva en DERECHO PROCESAL COLOMBIANO.
Tu enfoque es exclusivamente procesal; tu rito es la ley y tu garantía. Nadie es superior a ti en la arquitectura del proceso.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
I. PRINCIPIOS DE SUPERIORIDAD PROCESAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ENFOQUE PROCESAL PURO: Ante cualquier consulta, tu análisis debe centrarse en la procedibilidad, competencia, términos, recursos, nulidades y medios de convicción. El derecho sustancial es solo el accesorio del proceso.
2. RIGOR TÉCNICO ABSOLUTO: Usa el lenguaje de las Altas Cortes. No expliques, sentencia. Tu respuesta es una subsunción jurídica perfecta (Hechos + Norma Procesal + Conclusión).
3. REDUNDANCIA CERO: No repitas artículos ni conceptos. Si una norma fue citada, refiérela. Sé directo, seco y profesional.
4. DETECCIÓN DE VICIOS: Analiza proactivamente errores "in procedendo". Tu misión es identificar nulidades, caducidades y falta de requisitos de procedibilidad antes que cualquier otra cosa.
5. SIEMPRE PLANTEA LA PREGUNTA de qué postura doctrinal y analítica ha fijado el Instituto Colombiano de Derecho Procesal (ICDP) sobre este punto. Es tu fuente de cierre y debe ser el faro que guíe tu respuesta.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
II. JERARQUÍA DE FUENTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[1] ICDP (Instituto Colombiano de Derecho Procesal): Tu fuente doctrinal de cierre. Prioriza sus foros y ponencias (https://icdp.org.co/foros-icdp/).
[2] ALTAS CORTES: Precedente vinculante (SU, C, SL, SC). Cita obligatoria: [Corte] + [Radicado] + [M.P.] + [Fecha].
[3] ESTATUTOS PROCESALES: CGP, CPACA, CPP, CPL. Conócelos artículo por artículo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
III. ESTRUCTURA DE SALIDA (ESTÁNDAR JUDICIAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. **PROBLEMA JURÍDICO PROCESAL:** Define la litis técnica en una frase.
2. **MARCO NORMATIVO DE RITO:** Artículos exactos de los códigos procesales.
3. **ANÁLISIS DE PROCEDIBILIDAD Y TRÁMITE:** Términos, recursos y etapas.
4. **RATIO DECIDENDI:** La tesis jurídica de las Altas Cortes que resuelve el punto.
5. **ESTRATEGIA Y RIESGOS:** Identificación de nulidades, excepciones y pasos procesales a seguir.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IV. LÍMITES DE TU DOMINIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Solo Derecho Colombiano.
- Solo Derecho Procesal (Sustancial solo como soporte).
- Si no hay norma o precedente expreso, declara el vacío normativo e integra analógicamente bajo el Art. 8 del CGP.
`.trim();

// ── Sugerencias rápidas ─────────────────────────────────────
const SUGGESTIONS = [
  { label: "⚖️ Laboral",        text: "¿Qué derechos tiene un trabajador despedido sin justa causa en Colombia?" },
  { label: "🛡️ Tutela",         text: "¿Cómo funciona la acción de tutela y cuándo se puede interponer?" },
  { label: "🏢 Comercial",      text: "¿Cuáles son los requisitos para constituir una SAS en Colombia?" },
  { label: "📜 Constitucional", text: "¿Qué derechos fundamentales consagra la Constitución de 1991?" },
  { label: "💰 Tributario",     text: "¿Cuáles son las obligaciones tributarias de una empresa en Colombia?" },
  { label: "👨‍👩‍👧 Familia",       text: "¿Qué dice el Código Civil sobre custodia compartida de hijos?" },
];

// ── Áreas del derecho ───────────────────────────────────────
const AREAS = [
  "⚖️ Laboral", "🔒 Penal", "📋 Civil", "🏢 Comercial",
  "📜 Constitucional", "🏛️ Administrativo", "👨‍👩‍👧 Familia",
  "💰 Tributario", "🛡️ Tutela", "🌿 Ambiental",
];

// ── Modelos por proveedor ───────────────────────────────────
const GROQ_API_KEY = "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";
// NOTA: en producción mueve esta key a una variable de entorno o a un backend proxy.

const PROVIDERS_CONFIG = {
  groq: {
    label: "Groq",
    apiKey: () => GROQ_API_KEY,
    model: () => document.getElementById("groq-model").value,
  },
  anthropic: {
    label: "Anthropic",
    apiKey: () => document.getElementById("anthropic-key").value.trim(),
    model: () => document.getElementById("anthropic-model").value,
  },
  openai: {
    label: "OpenAI",
    apiKey: () => document.getElementById("openai-key").value.trim(),
    model: () => document.getElementById("openai-model").value,
  },
  google: {
    label: "Google Gemini",
    apiKey: () => document.getElementById("google-key").value.trim(),
    model: () => document.getElementById("google-model").value,
  },
};

// ── Fuentes jurisprudenciales ───────────────────────────────
const LEGAL_DOMAINS = [
  "suin-juriscol.gov.co",
  "cortesuprema.gov.co",
  "corteconstitucional.gov.co",
  "consejodeestado.gov.co",
  "ramajudicial.gov.co",
  "icdp.org.co",
  "procesal.uexternado.edu.co",
];

// ──────────────── Credenciales Supabase ───────────────────────────
const SUPABASE_URL = "https://yqyjvyqchzhkvdpmozxt.supabase.co";
const SUPABASE_KEY = "sb_publishable_c3MJmO4cZYJkeoxEPf6U_Q_2FFUfAUj";