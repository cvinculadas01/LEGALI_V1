#!/usr/bin/env bash
# ============================================================
# LEGALI v2.0 — scripts/backup.sh (v2)
# Backup completo de la base de datos Supabase.
#
# Mejoras v2:
#   - Fallback a pg_dump directo si supabase CLI no está disponible
#   - Verificación de tamaño mínimo del backup (detecta backups vacíos)
#   - Compresión gzip opcional (variable COMPRESS=true)
#   - Log de backups realizados (backups/backup.log)
#   - Instrucciones de restauración al final
#
# Uso:
#   export LEGALI_DB_URL='postgresql://postgres:<PASSWORD>@<HOST>:5432/postgres'
#   bash scripts/backup.sh
#
#   Con compresión:
#   COMPRESS=true bash scripts/backup.sh
#
# Dónde obtener LEGALI_DB_URL:
#   Supabase Dashboard → Project Settings → Database → Connection string
#   Seleccionar: "URI" en modo "Session" (puerto 5432)
#   Ejemplo: postgresql://postgres.gunfflxviwauixdymsfk:<PASSWORD>@aws-0-us-east-1.pooler.supabase.com:5432/postgres
# ============================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${BACKUP_DIR}/backup_legali_${TIMESTAMP}.sql"
LOG_FILE="${BACKUP_DIR}/backup.log"
COMPRESS="${COMPRESS:-false}"

mkdir -p "$BACKUP_DIR"

# ── Validar variable de entorno ───────────────────────────────
if [ -z "${LEGALI_DB_URL:-}" ]; then
  echo "❌ ERROR: Define la variable LEGALI_DB_URL."
  echo ""
  echo "Ejemplo:"
  echo "  export LEGALI_DB_URL='postgresql://postgres:<PASSWORD>@<HOST>:5432/postgres'"
  echo "  bash scripts/backup.sh"
  echo ""
  echo "Obtener en: Supabase Dashboard → Project Settings → Database → URI"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  LEGALI v2.0 — Backup de base de datos"
echo "  $(date '+%Y-%m-%d %H:%M:%S UTC')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Destino: ${OUT_FILE}"
echo ""

# ── Ejecutar backup ───────────────────────────────────────────
if command -v supabase &>/dev/null; then
  echo "==> Usando Supabase CLI (supabase db dump)..."
  supabase db dump --db-url "${LEGALI_DB_URL}" -f "${OUT_FILE}"
elif command -v pg_dump &>/dev/null; then
  echo "==> Supabase CLI no encontrado. Usando pg_dump directamente..."
  pg_dump "${LEGALI_DB_URL}" \
    --no-owner \
    --no-acl \
    --schema=public \
    --file="${OUT_FILE}"
else
  echo "❌ ERROR: No se encontró ni 'supabase' ni 'pg_dump'."
  echo "   Instalar Supabase CLI: npm install -g supabase"
  echo "   O instalar pg_dump: apt install postgresql-client"
  exit 1
fi

# ── Validar tamaño del backup ─────────────────────────────────
FILE_SIZE=$(stat -c%s "$OUT_FILE" 2>/dev/null || stat -f%z "$OUT_FILE" 2>/dev/null || echo 0)
MIN_SIZE=1000  # 1 KB mínimo para considerar backup válido

if [ "$FILE_SIZE" -lt "$MIN_SIZE" ]; then
  echo "⚠️  ADVERTENCIA: El backup parece muy pequeño (${FILE_SIZE} bytes)."
  echo "   Verifica que LEGALI_DB_URL sea correcto y la BD tenga datos."
fi

# ── Compresión opcional ───────────────────────────────────────
if [ "$COMPRESS" = "true" ] && command -v gzip &>/dev/null; then
  echo "==> Comprimiendo con gzip..."
  gzip -9 "$OUT_FILE"
  OUT_FILE="${OUT_FILE}.gz"
  echo "    Archivo comprimido: ${OUT_FILE}"
fi

# ── Resumen ───────────────────────────────────────────────────
FINAL_SIZE=$(du -h "$OUT_FILE" 2>/dev/null | cut -f1 || echo "N/A")

echo ""
echo "✅ Backup completado:"
echo "   Archivo : ${OUT_FILE}"
echo "   Tamaño  : ${FINAL_SIZE}"
echo ""

# ── Log ───────────────────────────────────────────────────────
echo "$(date '+%Y-%m-%d %H:%M:%S') | OK | ${OUT_FILE} | ${FINAL_SIZE}" >> "$LOG_FILE"

# ── Instrucciones de restauración ────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CÓMO RESTAURAR este backup:"
echo ""
echo "  1. Crea un proyecto Supabase de prueba"
echo "  2. Obtén su connection string (LEGALI_TEST_DB_URL)"
echo "  3. Ejecuta:"
if [ "$COMPRESS" = "true" ]; then
echo "     gunzip -c ${OUT_FILE} | psql \"\$LEGALI_TEST_DB_URL\""
else
echo "     psql \"\$LEGALI_TEST_DB_URL\" -f ${OUT_FILE}"
fi
echo ""
echo "  IMPORTANTE: Guarda este archivo FUERA del repo git."
echo "  La carpeta backups/ ya está en .gitignore."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
