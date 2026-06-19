# LEGALI — Backend

Contiene toda la infraestructura de Supabase. Estos archivos **nunca** son servidos por GitHub Pages.

## Estructura

```
backend/
├── schema.sql                        # Schema completo de la BD
├── scripts/
│   └── backup.sh                     # Script de respaldo
└── supabase/
    ├── config.toml                   # Configuración del proyecto Supabase
    ├── migrations/                   # Migraciones SQL aplicadas
    └── functions/                    # Edge Functions (Deno/TypeScript)
        ├── ai-proxy/
        ├── create-mp-preference/
        ├── delete-account/
        ├── webhook-mercadopago/
        └── webhook-wompi/
```

## Comandos CLI

Siempre ejecutar desde esta carpeta (`cd backend`):

```bash
supabase functions deploy ai-proxy
supabase functions deploy create-mp-preference
supabase db push
```
