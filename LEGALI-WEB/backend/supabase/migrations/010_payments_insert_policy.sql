-- ============================================================
-- LEGALI — Migración 010: política INSERT faltante en legali_payments
--
-- BUG CRÍTICO: legali_payments solo tenía políticas de SELECT
-- (usuario) y ALL (admin). No existía ninguna política que
-- permitiera a un usuario autenticado normal INSERTAR su propia
-- intención de pago, lo cual es requerido por:
--   - initWompiCheckout()       en js/payments.js
--   - initMercadoPagoCheckout() en js/payments.js
--
-- Sin esta política, ambos flujos de pago fallan con un error
-- de RLS al ejecutar `.insert()`, dejando la monetización
-- completamente rota para usuarios no-admin.
--
-- Ejecutar: supabase db push
-- ============================================================

do $$ begin
  drop policy if exists "user_insert_own_payment" on public.legali_payments;
exception when others then null;
end $$;

create policy "user_insert_own_payment"
  on public.legali_payments
  for insert
  with check (
    user_id = auth.uid()
    and status = 'pending'   -- el usuario solo puede crear pagos en estado pending;
                              -- la activación a 'approved' es exclusiva de
                              -- process_payment_webhook() (security definer, service_role)
  );
