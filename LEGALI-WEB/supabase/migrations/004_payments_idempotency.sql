-- ============================================================
-- LEGALI v2.0 — Migración 004: Idempotencia de pagos
-- Punto 3 del plan de 6: evita doble activación de plan si un
-- webhook (Wompi/MercadoPago) se recibe más de una vez.
-- ============================================================

-- 1. external_id debe ser único cuando no es NULL.
--    (Permite múltiples filas 'pending' sin external_id todavía,
--    pero una vez asignado el id de transacción del proveedor,
--    no puede repetirse).
create unique index if not exists uq_payments_external_id
  on public.legali_payments (external_id)
  where external_id is not null;

-- 2. Función auxiliar: procesa un evento de webhook de forma
--    idempotente. Si el pago ya estaba 'approved', no vuelve a
--    activar el plan ni a duplicar efectos.
create or replace function public.process_payment_webhook(
  p_external_id   text,
  p_reference     text,
  p_status        text,    -- 'approved' | 'rejected' | 'refunded'
  p_raw_payload   jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _payment   record;
  _already   boolean := false;
begin
  -- Buscar el pago por external_id, o por reference si aún no tiene external_id
  select * into _payment
  from public.legali_payments
  where external_id = p_external_id
     or (external_id is null and id::text = p_reference)
     or (external_id is null and p_reference ilike '%' || substr(id::text, 1, 8) || '%')
  order by created_at desc
  limit 1;

  if _payment.id is null then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  -- Idempotencia: si ya estaba aprobado, no repetir activación
  if _payment.status = 'approved' and p_status = 'approved' then
    _already := true;
  end if;

  -- Actualizar registro de pago
  update public.legali_payments
  set status      = p_status,
      external_id = coalesce(external_id, p_external_id),
      raw_payload = coalesce(p_raw_payload, raw_payload),
      updated_at  = now()
  where id = _payment.id;

  -- Activar el plan solo si es la primera vez que se aprueba
  if p_status = 'approved' and not _already then
    perform public.activate_plan(_payment.user_id, _payment.plan, _payment.id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'payment_id', _payment.id,
    'user_id', _payment.user_id,
    'plan', _payment.plan,
    'already_processed', _already
  );
end;
$$;

grant execute on function public.process_payment_webhook to service_role;
