# LEGALI — Asistente Jurídico IA (Versión Web)

Versión web completa de LEGALI, migrada de **Python/Streamlit** a **HTML + CSS + JS puro**, lista para publicar en la nube sin ningún servidor backend.

---

## ¿Por qué HTML/JS en lugar de Python/Streamlit?

| Criterio | Python / Streamlit (original) | HTML + JS (nueva versión) |
|---|---|---|
| Despliegue | Requiere servidor Python | Cualquier CDN o hosting estático |
| Velocidad de carga | 3–8 segundos | < 1 segundo |
| Costo en la nube | $7–20/mes (Heroku, Render) | **$0** (Netlify, GitHub Pages, Cloudflare Pages) |
| Escalabilidad | Limitada (1 hilo Streamlit) | Ilimitada (CDN global) |
| Streaming real | Emulado por Streamlit | Nativo (Fetch + ReadableStream) |
| Edición | Requiere entorno Python | **Notepad++ o cualquier editor** |
| Persistencia | Archivos locales / sin nube | **Supabase (PostgreSQL en la nube)** |

---

## Estructura del proyecto

```
LEGALI-WEB/
├── index.html          # Punto de entrada (toda la UI)
├── css/
│   └── styles.css      # Diseño y paleta LEGALI
├── js/
│   ├── constants.js    # System prompt, modelos, sugerencias (≈ constants.py)
│   ├── supabase.js     # Integración Supabase: memoria, RAG, historial (≈ legal_memory.py + document_search.py)
│   ├── providers.js    # Groq, Anthropic, OpenAI, Google streaming (≈ providers/*.py)
│   └── app.js          # Lógica principal de UI y chat (≈ app.py + ui/*)
└── sql/
    └── schema.sql      # Esquema de tablas para Supabase
```

---

## Instalación y publicación

### Opción 1 — Netlify (recomendado, GRATIS)

1. Ve a [netlify.com](https://netlify.com) → **"Add new site" → "Deploy manually"**
2. Arrastra la carpeta `LEGALI-WEB/` completa al área de drop.
3. ¡Listo! Tu app tiene una URL pública tipo `https://tu-legali.netlify.app`

### Opción 2 — GitHub Pages (GRATIS)

1. Sube la carpeta `LEGALI-WEB/` a un repositorio de GitHub.
2. Ve a **Settings → Pages → Deploy from branch → main → / (root)**.
3. Tu URL será `https://tu-usuario.github.io/legali/`

### Opción 3 — Cloudflare Pages (GRATIS, más rápido)

```bash
npm install -g wrangler
wrangler pages deploy LEGALI-WEB/
```

---

## Configurar Supabase (persistencia de datos)

1. Crea un proyecto gratuito en [supabase.com](https://supabase.com).
2. Ve a **SQL Editor** y pega el contenido de `sql/schema.sql`. Ejecuta.
3. Ve a **Settings → API** y copia:
   - **Project URL** → `https://xxxx.supabase.co`
   - **anon/public key** → empieza con `eyJ...`
4. En la app (sidebar), pega esos valores en los campos Supabase y haz clic en **Conectar**.

> Sin Supabase, la app funciona igual pero **sin persistencia**: el historial y los documentos se pierden al recargar.

---

## Editar con Notepad++

Todos los archivos son texto plano. Puedes editarlos con:
- **Notepad++** (recomendado en Windows)
- VS Code, Sublime Text, Zed, o cualquier editor de texto

### Personalizar el System Prompt
Abre `js/constants.js` y edita la variable `SYSTEM_PROMPT` (líneas 8–50).

### Cambiar colores / diseño
Abre `css/styles.css` y edita las variables CSS en `:root` (líneas 12–28).

### Agregar un nuevo proveedor de IA
1. En `js/providers.js`, agrega una nueva función `async function* streamNuevoProveedor(...)`.
2. En `js/constants.js`, agrega su entrada a `PROVIDERS_CONFIG`.
3. En `index.html`, agrega su botón en `#providerList` y su panel `#cfg-nuevo`.

---

## Proveedores de IA soportados

| Proveedor | Costo | Streaming | Notas |
|---|---|---|---|
| **Groq** | ✅ Gratis | ✅ Nativo | API Key incluida en el código |
| **OpenAI** | 💳 Pago | ✅ Nativo | Requiere API Key propia |
| **Google Gemini** | 🆓 Tier gratuito | ✅ Nativo (SSE) | Requiere API Key de Google AI Studio |
| **Anthropic** | 💳 Pago | ⚠️ Requiere proxy | Ver nota CORS abajo |

### Nota sobre Anthropic y CORS

La API de Anthropic bloquea llamadas directas desde el navegador (política CORS). Para usarla:

1. Crea un Cloudflare Worker (gratuito) como proxy:
```js
// worker.js
export default {
  async fetch(req) {
    const body = await req.json();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": "TU_KEY_ANTHROPIC",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return new Response(res.body, { headers: { "Access-Control-Allow-Origin": "*" } });
  }
}
```
2. En `js/providers.js`, cambia `ANTHROPIC_PROXY_URL` a la URL de tu worker.

---

## Funcionalidades

- ✅ Chat con streaming en tiempo real
- ✅ Soporte multi-proveedor (Groq, OpenAI, Google, Anthropic)
- ✅ Sistema RAG: sube .txt/.md y LEGALI los usa como referencia
- ✅ Memoria histórica de consultas (con Supabase)
- ✅ Persistencia de conversaciones (con Supabase)
- ✅ Áreas del derecho como accesos rápidos
- ✅ Sugerencias de consulta en pantalla de bienvenida
- ✅ Diseño responsive (móvil y escritorio)
- ✅ Edición con cualquier editor de texto (Notepad++)
- ✅ Despliegue en hosting estático gratuito

---

> ⚠️ LEGALI proporciona orientación general sobre derecho colombiano. No reemplaza la asesoría de un abogado habilitado.
