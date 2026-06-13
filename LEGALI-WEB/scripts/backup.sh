#!/usr/bin/env bash
# ============================================================
# LEGALI v2.0 — scripts/backup.sh
# Punto 5 del plan: backup manual de la base de datos Supabase.
#
# Requiere: Supabase CLI instalado y sesión iniciada
#   (npm install -g supabase  /  supabase login)
#
# Uso:
#   ./scripts/backup.sh
#
# Variables de entorno opcionales:
#   LEGALI_DB_URL  — connection string de Postgres
#                    (Project Settings → Database → Connection string,
#                     usar el "Connection pooling" con modo "session"
#                     o el directo, según prefieras)
#   BACKUP_DIR     — carpeta destino (default: ./backups)
#
# IMPORTANTE:
# - NUNCA subir los archivos generados al repo público LEGALI_V1
#   (contienen datos de usuarios). Guardar en almacenamiento
#   cifrado fuera del repo (disco local cifrado, repo privado
#   separado, o gestor de backups).
# - Agregar "backups/" al .gitignore del repo.
# ============================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${BACKUP_DIR}/backup_legali_${TIMESTAMP}.sql"

mkdir -p "$BACKUP_DIR"

if [ -z "${LEGALI_DB_URL:-}" ]; then
  echo "ERROR: Define la variable de entorno LEGALI_DB_URL con el connection string de Postgres."
  echo "Ejemplo:"
  echo "  export LEGALI_DB_URL='postgresql://postgres:<password>@<host>:5432/postgres'"
  echo "  ./scripts/backup.sh"
  exit 1
fi

echo "==> Generando backup completo de la base de datos LEGALI..."
echo "    Destino: ${OUT_FILE}"

# supabase db dump usa pg_dump internamente y respeta el esquema completo
# (tablas, funciones, triggers, políticas RLS, datos).
supabase db dump --db-url "${LEGALI_DB_URL}" -f "${OUT_FILE}"

echo "==> Backup completado: ${OUT_FILE}"
echo "==> Tamaño: $(du -h "${OUT_FILE}" | cut -f1)"

echo ""
echo "Recuerda:"
echo "  1. Mover/copiar este archivo a un almacenamiento seguro fuera del repo."
echo "  2. Eliminar copias locales antiguas si ya no son necesarias."
echo "  3. Probar la restauración periódicamente (ver BACKUP_RESTORE.md)."
