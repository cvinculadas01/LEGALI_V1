-- ============================================================
-- LEGALI — Migración 008: Reestructuración a 3 planes (v3.0)
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Prerequisito de todo lo demás.
--
-- CORRECCIONES vs borrador original:
--   - Paso 2: WHERE quota_total != 900  (cubre cualquier valor, no solo 9999)
--   - Paso 9: UPDATE reemplazado por INSERT ... ON CONFLICT (upsert seguro)
-- ============================================================


-- ── 1. Migrar usuarios consultorio → profesional ─────────────
UPDATE public.legali_profiles
SET plan              = 'profesional',
    provider_assigned = 'anthropic',
    quota_total       = 200,
    updated_at        = now()
WHERE plan = 'consultorio';


-- ── 2. Bajar cuota firma (cualquier valor distinto de 900) ───
UPDATE public.legali_profiles
SET quota_total = 900,
    updated_at  = now()
WHERE plan = 'firma' AND quota_total != 900;


-- ── 3. Constraint plan (eliminar consultorio) ────────────────
ALTER TABLE public.legali_profiles
  DROP CONSTRAINT IF EXISTS legali_profiles_plan_check;

ALTER TABLE public.legali_profiles
  ADD CONSTRAINT legali_profiles_plan_check
  CHECK (plan IN ('gratis', 'profesional', 'firma', 'admin'));


-- ── 4. Constraint provider_assigned (eliminar openai) ────────
ALTER TABLE public.legali_profiles
  DROP CONSTRAINT IF EXISTS legali_profiles_provider_assigned_check;

ALTER TABLE public.legali_profiles
  ADD CONSTRAINT legali_profiles_provider_assigned_check
  CHECK (provider_assigned IN ('groq', 'anthropic'));


-- ── 5. Trigger handle_new_user ───────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _plan  text    := coalesce(new.raw_user_meta_data->>'plan', 'gratis');
  _quota integer;
BEGIN
  _quota := CASE _plan
    WHEN 'profesional' THEN 200
    WHEN 'firma'       THEN 900
    WHEN 'admin'       THEN 9999
    ELSE 5
  END;

  INSERT INTO public.legali_profiles (
    id, nombre, apellido, email, plan,
    provider_assigned, quota_used, quota_total, active
  ) VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', ''),
    coalesce(new.raw_user_meta_data->>'apellido', ''),
    new.email,
    _plan,
    CASE _plan
      WHEN 'profesional' THEN 'anthropic'
      WHEN 'firma'       THEN 'anthropic'
      WHEN 'admin'       THEN 'anthropic'
      ELSE 'groq'
    END,
    0, _quota, true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;


-- ── 6. RPC activate_plan ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_plan(
  p_user_id    uuid,
  p_plan       text,
  p_payment_id uuid DEFAULT null
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _quota    integer;
  _provider text;
BEGIN
  _quota := CASE p_plan
    WHEN 'profesional' THEN 200
    WHEN 'firma'       THEN 900
    WHEN 'admin'       THEN 9999
    ELSE 5
  END;

  _provider := CASE p_plan
    WHEN 'profesional' THEN 'anthropic'
    WHEN 'firma'       THEN 'anthropic'
    WHEN 'admin'       THEN 'anthropic'
    ELSE 'groq'
  END;

  UPDATE public.legali_profiles
  SET plan              = p_plan,
      provider_assigned = _provider,
      quota_total       = _quota,
      quota_used        = 0,
      plan_expires_at   = now() + INTERVAL '1 month',
      active            = true,
      updated_at        = now()
  WHERE id = p_user_id;

  IF p_payment_id IS NOT NULL THEN
    UPDATE public.legali_payments
    SET status     = 'approved',
        updated_at = now()
    WHERE id = p_payment_id;
  END IF;
END;
$$;


-- ── 7. Cron: limpieza de conversaciones ──────────────────────
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'legali_conversations_cleanup';

SELECT cron.schedule(
  'legali_conversations_cleanup',
  '0 2 * * 0',
  $$
    DELETE FROM public.conversations c
    USING public.legali_profiles p
    WHERE c.user_id = p.id
      AND (
        (p.plan = 'gratis'      AND c.created_at < now() - INTERVAL '1 day') OR
        (p.plan = 'profesional' AND c.created_at < now() - INTERVAL '90 days')
        -- firma y admin: historial indefinido, no se limpian
      );
  $$
);


-- ── 8. Cron: reset mensual de cuota ──────────────────────────
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'legali_monthly_quota_reset';

SELECT cron.schedule(
  'legali_monthly_quota_reset',
  '0 0 1 * *',
  $$
    UPDATE public.legali_profiles
    SET quota_used = 0,
        updated_at = now()
    WHERE active = true AND plan != 'admin';
  $$
);


-- ── 9. legali_config — upsert seguro ─────────────────────────
-- (Si la tabla legali_config no existe en tu schema, omitir este bloque)
INSERT INTO public.legali_config (key, value, description)
VALUES ('anthropic_model_pro', 'claude-opus-4-6', 'Modelo Anthropic para plan Firma')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO public.legali_config (key, value, description)
VALUES ('anthropic_model', 'claude-sonnet-4-6', 'Modelo Anthropic para plan Profesional')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO public.legali_config (key, value, description)
VALUES ('firma_quota_internal', '900', 'Cuota real interna plan Firma — no exponer al usuario')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;


-- ── 10. Verificación post-migración ──────────────────────────
SELECT
  plan,
  count(*)          AS usuarios,
  min(quota_total)  AS cuota_min,
  max(quota_total)  AS cuota_max
FROM public.legali_profiles
GROUP BY plan
ORDER BY plan;

-- Resultado esperado:
--   admin       → cuota 9999
--   firma       → cuota 900
--   gratis      → cuota 5
--   profesional → cuota 200
--
-- ❌ NO debe aparecer ninguna fila con plan = 'consultorio'
