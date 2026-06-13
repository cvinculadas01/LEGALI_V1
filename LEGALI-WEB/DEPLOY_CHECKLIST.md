# LEGALI v2.0 — Checklist de Despliegue y Pruebas

> **Uso:** Ejecuta cada punto en orden. Marca ✅ cuando lo completes.
> Este documento cubre todo lo que falta para tener LEGALI 100% operativo en sandbox.

---

## ⚙️ Prerrequisitos globales

```bash
# Supabase CLI instalado
npm install -g supabase

# Iniciar sesión
supabase login

# Enlazar con el proyecto (si no está enlazado)
cd LEGALI-WEB
supabase link --project-ref gunfflxviwauixdymsfk
```

---

## 🔴 ACCIÓN INMEDIATA — Archivos de esta entrega

Copia los archivos entregados en este paquete a sus rutas destino:

| Archivo del paquete | Destino en el repo | Acción |
|---|---|---|
| `supabase/functions/ai-proxy/index.ts` | `LEGALI-WEB/supabase/functions/ai-proxy/index.ts` | **Reemplazar** |
| `supabase/migrations/005_audit_logs_config.sql` | `LEGALI-WEB/supabase/migrations/005_audit_logs_config.sql` | **Nuevo** |
| `.gitignore` | `LEGALI-WEB/.gitignore` | **Nuevo** |
| `DEPLOY_CHECKLIST.md` | `LEGALI-WEB/DEPLOY_CHECKLIST.md` | **Nuevo** |

```bash
# Después de copiar:
git add .
git commit -m "chore: add gitignore, migration 005, rate-limit in ai-proxy, deploy checklist"
git push
```

---

## PUNTO 1 — Privacidad / Ley 1581 ✅ (código completo)

### 1.1 Aplicar migración 002

```bash
supabase db push
# Verifica que 002_privacy_ley1581.sql se aplicó (consent_given_at, consent_version en legali_profiles)
```

### 1.2 Desplegar función delete-account

```bash
supabase functions deploy delete-account
```

### 1.3 Pruebas

- [ ] **Registro**: crear cuenta nueva → checkbox "He leído y acepto..." **debe ser obligatorio** (no avanza sin marcarlo)
- [ ] **Exportar datos**: en `perfil.html` → "Descargar mis datos (JSON)" → descarga `legali_mis_datos_<fecha>.json` con 4 secciones: perfil, conversaciones, documentos, pagos
- [ ] **Eliminar cuenta**: en `perfil.html` → "Eliminar cuenta" → doble confirmación → borra datos → cierra sesión → redirige a `login.html`
- [ ] **Verificar en Supabase**: usuario eliminado de `auth.users` y de `legali_profiles`

### 1.4 Opcional

- [ ] Cambiar `soporte@legali.co` por correo real en `privacidad.html`
- [ ] Evaluar registro en RNBD (SIC) — trámite externo, no código

---

## PUNTO 2 — Biblioteca Jurídica + RAG ✅ (código completo)

### 2.1 Prueba Biblioteca Jurídica (admin/dashboard.html)

1. [ ] Ir a panel admin → sección **Biblioteca**
2. [ ] Subir un archivo PDF/TXT/MD de prueba con categoría y fuente
3. [ ] Verificar en **Supabase Table Editor** → `legal_documents`: fila con `title`, `content`, `category`, `source` poblados
4. [ ] El documento aparece en la tabla del dashboard
5. [ ] El buscador (`filterLibDocs`) filtra por título correctamente
6. [ ] Botón eliminar (`deleteLibDoc`) borra el documento de la tabla y de BD

### 2.2 Prueba RAG de Sesión (usuario.html)

1. [ ] Desde `usuario.html` → subir documento con información inventada y específica (ej. "El artículo 99-Z del CGP establece que...")
2. [ ] Hacer una pregunta cuya respuesta **solo** pueda venir de ese documento
3. [ ] Verificar que la respuesta del asistente incorpora esa información
4. [ ] Si NO aparece: revisar en Supabase → `session_documents` → confirmar que la fila insertada tiene `search_vec` poblado (columna generada). Si es `null`, hay un problema con la extensión `unaccent` o `pg_trgm` — verificar que las extensiones están activas (`supabase db push` debería activarlas vía `schema.sql`)

---

## PUNTO 3 — Webhooks Wompi + MercadoPago (sandbox)

### 3.1 Aplicar migraciones

```bash
supabase db push
# Aplica 004_payments_idempotency.sql y 005_audit_logs_config.sql
# Verifica en Supabase SQL Editor:
# SELECT routine_name FROM information_schema.routines WHERE routine_name IN ('process_payment_webhook','increment_quota_used','check_rate_limit');
```

### 3.2 Wompi — configuración sandbox

1. [ ] Crear cuenta sandbox gratuita en https://comercios.wompi.co/
2. [ ] Obtener de la cuenta sandbox:
   - Llave pública: `pub_test_...`
   - Secreto de eventos (Events secret)
3. [ ] Configurar secret en Supabase:
   ```bash
   supabase secrets set WOMPI_EVENTS_SECRET=<secreto_de_eventos_sandbox>
   ```
4. [ ] Desplegar función:
   ```bash
   supabase functions deploy webhook-wompi --no-verify-jwt
   ```
5. [ ] En el dashboard Wompi sandbox → Configuración → Webhooks → agregar:
   ```
   https://gunfflxviwauixdymsfk.supabase.co/functions/v1/webhook-wompi
   ```
6. [ ] **Reemplazar en `js/payments.js`**:
   ```js
   // Línea: const WOMPI_PUBLIC_KEY = 'pub_test_REEMPLAZAR_CON_TU_LLAVE_SANDBOX';
   // Cambiar por:
   const WOMPI_PUBLIC_KEY = 'pub_test_TU_LLAVE_REAL_AQUI';
   ```
   ```bash
   git add js/payments.js
   git commit -m "fix: set Wompi sandbox public key"
   git push
   ```

### 3.3 MercadoPago — configuración sandbox

1. [ ] Crear cuenta de pruebas en https://www.mercadopago.com/developers
2. [ ] Ir a **Credenciales de prueba** → copiar Access Token (`TEST-...`)
3. [ ] Configurar secret:
   ```bash
   supabase secrets set MP_ACCESS_TOKEN=TEST-xxxxxxxxxxxxxxxx
   ```
4. [ ] (Opcional) Si cambias la URL del sitio:
   ```bash
   supabase secrets set LEGALI_SITE_URL=https://cvinculadas01.github.io/LEGALI_V1/LEGALI-WEB
   ```
5. [ ] Desplegar funciones:
   ```bash
   supabase functions deploy create-mp-preference
   supabase functions deploy webhook-mercadopago --no-verify-jwt
   ```
   > La `notification_url` se envía automáticamente en cada preferencia — no requiere registro manual adicional.

### 3.4 Pruebas end-to-end de pagos

**Wompi — Aprobado:**
- [ ] Desde `planes.html` → iniciar checkout Wompi → completar con [tarjeta de prueba Wompi aprobada](https://docs.wompi.co/en/docs/colombia/tarjetas-de-prueba/)
- [ ] Redirección a `usuario.html?payment=wompi&ref=...&pid=...`
- [ ] Toast: "✅ ¡Pago aprobado! Tu plan ya está activo."
- [ ] Supabase → `legali_payments.status = 'approved'`
- [ ] Supabase → `legali_profiles.plan` actualizado

**Wompi — Rechazado:**
- [ ] Repetir con tarjeta de prueba rechazada
- [ ] `legali_payments.status = 'rejected'`, plan sin cambio

**MercadoPago — Aprobado:**
- [ ] Desde `planes.html` → iniciar checkout MP
- [ ] `create-mp-preference` retorna `init_point` válido (verificar con `supabase functions logs create-mp-preference`)
- [ ] Completar pago con [usuario/tarjeta de prueba MP](https://www.mercadopago.com.co/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards)
- [ ] `webhook-mercadopago` procesado (verificar: `supabase functions logs webhook-mercadopago`)
- [ ] `legali_payments.status = 'approved'` y plan activado

**MercadoPago — Rechazado:**
- [ ] Repetir con pago rechazado → `status = 'rejected'`

**Idempotencia:**
- [ ] Copiar el payload del webhook desde los logs
- [ ] Enviar manualmente el mismo payload dos veces a la Edge Function:
  ```bash
  curl -X POST https://gunfflxviwauixdymsfk.supabase.co/functions/v1/webhook-wompi \
    -H "Content-Type: application/json" \
    -d '<payload_copiado>'
  ```
- [ ] En los logs, la segunda llamada debe retornar `already_processed: true` sin duplicar la activación

---

## PUNTO 4 — API Keys IA + Validar planes

### 4.1 Configurar keys

```bash
# Anthropic — obtener en https://console.anthropic.com
supabase secrets set ANTHROPIC_KEY=sk-ant-xxxxxxxxxxxxxxxx

# OpenAI — obtener en https://platform.openai.com/api-keys
supabase secrets set OPENAI_KEY=sk-xxxxxxxxxxxxxxxx

# Groq — obtener en https://console.groq.com (gratis)
supabase secrets set GROQ_KEY=gsk_xxxxxxxxxxxxxxxx
```

### 4.2 Redesplegar ai-proxy (con rate limiting integrado)

```bash
supabase functions deploy ai-proxy
```

### 4.3 Verificar modelos vigentes

Antes de redesplegar, confirmar que estos alias siguen siendo válidos en https://docs.anthropic.com/en/docs/about-claude/models:
- `claude-sonnet-4-6` (plan profesional)
- `claude-opus-4-8` (plan firma/admin)
- `claude-haiku-4-5-20251001` (opción económica)

Si alguno cambió, actualizar `ALLOWED_MODELS` en `supabase/functions/ai-proxy/index.ts` y en `js/constants.js` antes de redesplegar.

### 4.4 Probar cada plan

Para probar un plan, temporalmente cambia tu `plan` en Supabase:
```sql
-- SQL Editor de Supabase (revertir después)
UPDATE public.legali_profiles SET plan = 'consultorio' WHERE email = 'tu@email.com';
```

- [ ] **`gratis`** → Groq, `llama-3.3-70b-versatile` → respuesta correcta
- [ ] **`consultorio`** → OpenAI, `gpt-4o-mini` → respuesta correcta (no `config_error`)
- [ ] **`profesional`** → Anthropic, `claude-sonnet-4-6` → respuesta correcta
- [ ] **`firma`** → Anthropic, `claude-opus-4-8` → respuesta correcta
- [ ] **`admin`** → Anthropic, `claude-opus-4-8` → respuesta correcta

```bash
# Si algo falla, revisar logs:
supabase functions logs ai-proxy
```

### 4.5 Probar rate limiting

- [ ] Con un usuario `gratis`, enviar 6 peticiones en menos de 1 minuto
- [ ] La 6ª debe retornar error `rate_limited` con HTTP 429
- [ ] Con usuario `firma`, el límite es 60/min (prácticamente no se alcanza en prueba manual)

---

## PUNTO 5 — Backup manual + prueba de restauración

### 5.1 Preparar .gitignore

- [ ] Verificar que `LEGALI-WEB/.gitignore` está presente (incluido en esta entrega)
- [ ] Confirmar que `backups/` está listado en `.gitignore`
- [ ] Verificar que las migraciones NO están excluidas:
  ```bash
  git check-ignore -v supabase/migrations/001_initial.sql
  # No debe producir output (no está ignorado)
  git check-ignore -v backups/
  # Debe mostrar que sí está ignorado
  ```

### 5.2 Primer backup real

```bash
# Obtener connection string:
# Supabase Dashboard → Project Settings → Database → Connection string
# Usar formato "URI" con modo "Session" (puerto 5432)

export LEGALI_DB_URL='postgresql://postgres:<PASSWORD>@<HOST>:5432/postgres'

chmod +x scripts/backup.sh
./scripts/backup.sh
# Genera: backups/backup_legali_YYYYMMDD_HHMMSS.sql
```

- [ ] Mover el archivo generado a almacenamiento seguro **fuera del repo** (carpeta cifrada, Google Drive, repo privado)
- [ ] Verificar que `backups/` no aparece en `git status`

### 5.3 Prueba de restauración

```bash
# 1. Crear segundo proyecto Supabase en plan Free (solo para prueba)
# 2. Obtener su connection string → LEGALI_TEST_DB_URL

psql "$LEGALI_TEST_DB_URL" -f backups/backup_legali_YYYYMMDD_HHMMSS.sql

# 3. Verificar en el proyecto de prueba (SQL Editor):
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
# Debe listar: audit_logs, conversations, legal_documents, legal_memory,
#              legali_config, legali_payments, legali_profiles,
#              legali_rate_events, session_documents

SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;
# Debe incluir: activate_plan, check_rate_limit, check_user_quota,
#               delete_my_account_data, export_my_data,
#               increment_quota_used, process_payment_webhook,
#               search_legal_docs

SELECT schemaname, tablename, policyname FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
# Debe mostrar políticas RLS para todas las tablas sensibles
```

- [ ] **Eliminar el proyecto de prueba** tras verificar (Project Settings → General → Delete project)

### 5.4 Documentar secrets

- [ ] Guardar en gestor de contraseñas (1Password, Bitwarden, etc.) todos los secrets:
  - `WOMPI_EVENTS_SECRET` — sandbox y (futuro) producción
  - `MP_ACCESS_TOKEN` — sandbox (`TEST-...`) y (futuro) producción
  - `ANTHROPIC_KEY` — sk-ant-...
  - `OPENAI_KEY` — sk-...
  - `GROQ_KEY` — gsk_...
  - `LEGALI_DB_URL` — connection string del proyecto principal

```bash
# Listar secrets configurados actualmente:
supabase secrets list
```

---

## PUNTO 6 — Producción (ejecutar DESPUÉS de que 1-5 estén probados)

> ⚠️ Este punto requiere inversión económica. No ejecutar hasta tener 1-5 validados.

### 6.1 Dominio propio

- [ ] Registrar dominio (Namecheap/GoDaddy): `.com` ~US$10-15/año, `.com.co` ~US$30-50/año
- [ ] Configurar DNS apuntando a Cloudflare

### 6.2 Cloudflare (plan Free)

- [ ] Crear cuenta en Cloudflare → agregar el dominio
- [ ] Activar: WAF, Bot Fight Mode, SSL/HSTS
- [ ] Migrar hosting a **Cloudflare Pages** (recomendado sobre GitHub Pages):
  - Conectar repo `LEGALI_V1` → carpeta de publicación: `LEGALI-WEB/`
  - Actualizar `ALLOWED_ORIGINS` en `ai-proxy` y `create-mp-preference`
  - Actualizar `redirect-url` en `payments.js` (Wompi) y `back_urls` (MercadoPago)
  - Actualizar `LEGALI_SITE_URL` secret:
    ```bash
    supabase secrets set LEGALI_SITE_URL=https://tudominio.com
    ```
- [ ] Configurar headers de seguridad (`Content-Security-Policy`, `X-Frame-Options`, etc.)

### 6.3 Supabase Pro (~US$25/mes)

- [ ] Activar cuando haya usuarios reales → habilita PITR + backups diarios automáticos

### 6.4 Cuentas de comercio reales

**Wompi producción:**
- [ ] Crear cuenta real (NIT + cuenta bancaria) en Wompi
- [ ] Reemplazar en `js/payments.js`: `pub_test_...` → `pub_prod_...`
- [ ] Reemplazar secret: `WOMPI_EVENTS_SECRET` → secreto de producción
- [ ] Re-registrar URL del webhook con credenciales de producción

**MercadoPago producción:**
- [ ] Crear cuenta real → reemplazar: `MP_ACCESS_TOKEN=TEST-...` → `APP_USR-...`

### 6.5 Monitoreo — Sentry (free tier: ~5,000 eventos/mes)

- [ ] Crear proyecto en https://sentry.io
- [ ] Agregar SDK de Sentry al frontend (`usuario.html`) y a las Edge Functions críticas (`ai-proxy`, webhooks)

### 6.6 Auditoría final de seguridad

```bash
# Verificar que ninguna key sensible está en el historial del repo:
git log -p | grep -i "sk-\|pub_prod\|service_role\|TEST-\|gsk_"

# Mejor aún, usar gitleaks:
brew install gitleaks  # o apt install gitleaks
gitleaks detect --source . -v
```

- [ ] Auditar políticas RLS: `SELECT * FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename;`
- [ ] Confirmar que `ALLOWED_ORIGINS` en `ai-proxy` y `create-mp-preference` apuntan **solo** al dominio de producción
- [ ] Verificar HTTPS forzado: `curl -I http://tudominio.com` debe redirigir a HTTPS

---

## 📋 Resumen de comandos clave

```bash
# Aplicar TODAS las migraciones pendientes (002, 003, 004, 005)
supabase db push

# Desplegar TODAS las Edge Functions
supabase functions deploy ai-proxy
supabase functions deploy delete-account
supabase functions deploy create-mp-preference
supabase functions deploy webhook-wompi --no-verify-jwt
supabase functions deploy webhook-mercadopago --no-verify-jwt

# Configurar TODOS los secrets de una vez
supabase secrets set \
  WOMPI_EVENTS_SECRET=<valor> \
  MP_ACCESS_TOKEN=<valor> \
  ANTHROPIC_KEY=<valor> \
  OPENAI_KEY=<valor> \
  GROQ_KEY=<valor> \
  LEGALI_SITE_URL=https://cvinculadas01.github.io/LEGALI_V1/LEGALI-WEB

# Ver logs en tiempo real de una función
supabase functions logs ai-proxy --tail
supabase functions logs webhook-wompi --tail
supabase functions logs webhook-mercadopago --tail
```

---

*Generado para LEGALI v2.0 — Actualizar este documento conforme se completen los puntos.*
