-- ============================================================
-- LEGALI — Migración 009: Trigger de seguridad anti-tampering
-- Bloquea cambios a campos críticos desde el cliente (plan,
-- quota_total, provider_assigned, active) cuando la llamada
-- viene de un usuario autenticado directamente.
--
-- NOTA: El trigger queda deshabilitado en Supabase Free.
-- Al contratar Supabase Pro ejecutar:
--   ALTER TABLE public.legali_profiles ENABLE TRIGGER trg_block_plan_tampering;
-- ============================================================

CREATE OR REPLACE FUNCTION public.block_plan_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.plan              IS DISTINCT FROM OLD.plan              THEN
      RAISE EXCEPTION 'permission_denied: cannot change plan';
    END IF;
    IF NEW.quota_total       IS DISTINCT FROM OLD.quota_total       THEN
      RAISE EXCEPTION 'permission_denied: cannot change quota_total';
    END IF;
    IF NEW.provider_assigned IS DISTINCT FROM OLD.provider_assigned THEN
      RAISE EXCEPTION 'permission_denied: cannot change provider_assigned';
    END IF;
    IF NEW.active            IS DISTINCT FROM OLD.active            THEN
      RAISE EXCEPTION 'permission_denied: cannot change active';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_plan_tampering ON public.legali_profiles;

CREATE TRIGGER trg_block_plan_tampering
BEFORE UPDATE ON public.legali_profiles
FOR EACH ROW
EXECUTE FUNCTION public.block_plan_tampering();

-- ── Revocar activate_plan de roles públicos ───────────────────
-- activate_plan solo debe ser ejecutable por service_role (webhooks de pago)
REVOKE EXECUTE ON FUNCTION public.activate_plan(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.activate_plan(uuid, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.activate_plan(uuid, text, uuid) FROM authenticated;

-- reset_monthly_quotas solo debe correrla el cron (service_role)
REVOKE EXECUTE ON FUNCTION public.reset_monthly_quotas() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_monthly_quotas() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_monthly_quotas() FROM authenticated;

-- ── Pendiente al contratar Supabase Pro ───────────────────────
-- ALTER TABLE public.legali_profiles ENABLE TRIGGER trg_block_plan_tampering;
