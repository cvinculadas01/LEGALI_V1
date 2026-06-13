-- ============================================================
-- LEGALI v2.0 — Migración 003: Rate limiting por usuario
-- Limita el número de peticiones al ai-proxy por usuario en
-- una ventana corta de tiempo, independientemente de la cuota
-- mensual. Esto evita que un script drene la cuota/costo de IA
-- en segundos (abuso), incluso si el usuario tiene cuota
-- disponible.
-- ============================================================

-- 1. Tabla de eventos de rate limit (ventana deslizante)
create table if not exists public.legali_rate_events (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.legali_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_rate_events_user_time
  on public.legali_rate_events (user_id, created_at desc);

alter table public.legali_rate_events enable row level security;

-- Solo el propio usuario puede insertar/ver sus eventos (vía RPC con
-- security definer no es necesario exponer esto directamente).
create policy "rate_events_own" on public.legali_rate_events
  for all using (user_id = auth.uid());

-- 2. Función: verificar y registrar rate limit
--    Límite: máx. 10 peticiones por minuto por usuario.
--    Ajustable según el plan si se desea en el futuro.
create or replace function public.check_rate_limit(
  p_user_id uuid,
  p_max_per_minute int default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- Contar eventos del último minuto
  select count(*) into v_count
  from public.legali_rate_events
  where user_id = p_user_id
    and created_at > now() - interval '1 minute';

  if v_count >= p_max_per_minute then
    return jsonb_build_object(
      'allowed', false,
      'reason',  'rate_limited',
      'count',   v_count,
      'limit',   p_max_per_minute
    );
  end if;

  -- Registrar este evento
  insert into public.legali_rate_events (user_id) values (p_user_id);

  -- Limpieza oportunista de eventos viejos (mantiene la tabla pequeña)
  delete from public.legali_rate_events
  where user_id = p_user_id
    and created_at < now() - interval '10 minutes';

  return jsonb_build_object('allowed', true, 'count', v_count + 1, 'limit', p_max_per_minute);
end;
$$;

grant execute on function public.check_rate_limit(uuid, int) to authenticated;
grant execute on function public.check_rate_limit(uuid, int) to service_role;
