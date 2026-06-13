-- ============================================================
-- LEGALI v2.0 — Migración 002: Privacidad / Ley 1581 de 2012
-- Agrega registro de consentimiento y función de borrado real
-- de cuenta (derecho de supresión / habeas data).
-- ============================================================

-- 1. Columnas de consentimiento en legali_profiles
alter table public.legali_profiles
  add column if not exists consent_given_at timestamptz,
  add column if not exists consent_version  text;

comment on column public.legali_profiles.consent_given_at is
  'Fecha/hora en que el usuario aceptó la Política de Tratamiento de Datos (Ley 1581 de 2012)';
comment on column public.legali_profiles.consent_version is
  'Versión del documento de política aceptado (ej. "2026-06-v1")';

-- 2. Función: eliminar cuenta y todos los datos asociados (RPC)
--    Se ejecuta con privilegios del usuario autenticado (security invoker
--    por defecto). RLS + "on delete cascade" en el esquema ya garantizan
--    que solo se borren los datos del propio usuario y que las tablas
--    relacionadas (conversations, session_documents, legal_memory,
--    legali_payments, audit_logs) se limpien en cascada.
--
--    NOTA: borrar el registro de auth.users requiere privilegios de
--    administrador (service_role). Esta función borra todos los datos
--    de negocio del usuario; el borrado del usuario de Auth se hace
--    desde una Edge Function con service_role (ver
--    supabase/functions/delete-account/index.ts).
create or replace function public.delete_my_account_data()
returns void
language plpgsql
security invoker
as $$
begin
  -- Borra el perfil; on delete cascade limpia conversations,
  -- session_documents, legal_memory, legali_payments, audit_logs
  -- que referencian legali_profiles(id).
  delete from public.legali_profiles
  where id = auth.uid();
end;
$$;

grant execute on function public.delete_my_account_data() to authenticated;

-- 3. Función: exportar mis datos (derecho de acceso / portabilidad)
--    Devuelve un JSON con los datos personales del usuario.
create or replace function public.export_my_data()
returns json
language plpgsql
security invoker
as $$
declare
  result json;
begin
  select json_build_object(
    'perfil', (
      select json_build_object(
        'id', id, 'nombre', nombre, 'apellido', apellido, 'email', email,
        'plan', plan, 'provider_assigned', provider_assigned,
        'quota_used', quota_used, 'quota_total', quota_total,
        'active', active, 'plan_expires_at', plan_expires_at,
        'created_at', created_at, 'consent_given_at', consent_given_at,
        'consent_version', consent_version
      )
      from public.legali_profiles where id = auth.uid()
    ),
    'conversaciones', (
      select coalesce(json_agg(json_build_object(
        'session_id', session_id, 'role', role, 'content', content,
        'created_at', created_at
      )), '[]'::json)
      from public.conversations where user_id = auth.uid()
    ),
    'documentos_sesion', (
      select coalesce(json_agg(json_build_object(
        'filename', filename, 'size_bytes', size_bytes, 'created_at', created_at
      )), '[]'::json)
      from public.session_documents where user_id = auth.uid()
    ),
    'pagos', (
      select coalesce(json_agg(json_build_object(
        'provider', provider, 'plan', plan, 'amount_usd', amount_usd,
        'amount_cop', amount_cop, 'status', status, 'created_at', created_at
      )), '[]'::json)
      from public.legali_payments where user_id = auth.uid()
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.export_my_data() to authenticated;
