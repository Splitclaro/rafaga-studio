-- Publicación pública en TikTok mediante Zernio (proveedor externo), para un número cerrado de cuentas autorizadas.
-- Aditiva: columnas nuevas con valor por defecto en `publications` (tabla de 034), índices parciales y funciones nuevas.
--   cliente:  request_zernio_publication, zernio_send_context, record_zernio_send, cancel_publication (ahora distingue Zernio)
--   worker/servicio: zernio_event (webhook firmado, lo ejecuta una Edge Function de Supabase), enqueue_due_publications (ya no reenvía las de Zernio)
-- El envío a Zernio lo hace el servidor web al pulsar Programar (NO el worker de Modal): así publicar sigue funcionando aunque se agote la cuota de render.
-- Sin tabla nueva: la lista de destinos autorizados y el espacio autorizado viven en variables de entorno del servidor; la deduplicación de eventos usa
-- `audit_events` con un índice único parcial. Impacto sobre datos existentes: ninguno.

alter table public.publications add column if not exists provider text not null default 'native' check (provider in ('native','zernio'));
alter table public.publications add column if not exists zernio_account_id text;
alter table public.publications add column if not exists zernio_post_id text;
alter table public.publications add column if not exists post_url text;
alter table public.publications add column if not exists consent jsonb;
alter table public.publications add column if not exists retry_at timestamptz;
alter table public.publications add column if not exists attempts int not null default 0;
create unique index if not exists publications_zernio_post_uq on public.publications(zernio_post_id) where zernio_post_id is not null;
create index if not exists publications_zernio_account_idx on public.publications(zernio_account_id, scheduled_at) where provider = 'zernio';
create unique index if not exists audit_zernio_event_uq on public.audit_events((detail->>'event_id')) where action = 'zernio.webhook';

-- ───────── Cliente ─────────
-- Crea la publicación (el servidor web la envía a Zernio a continuación, con la fecha futura); Zernio ejecuta el horario.
-- p_ws es el espacio autorizado (lo aporta el servidor desde su configuración): cualquier otro espacio se rechaza.
create or replace function public.request_zernio_publication(p_render uuid, p_title text, p_description text, p_scheduled_at timestamptz, p_publish_now boolean,
  p_idem text, p_account text, p_username text, p_options jsonb, p_consent jsonb, p_ws uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rd record; prev record; pid uuid := gen_random_uuid(); n_before int; n_after int; t timestamptz;
begin
  if p_title is null or char_length(btrim(p_title)) not between 1 and 100 then raise exception 'invalid_publication' using errcode = 'P0001'; end if;
  if p_idem is null or char_length(p_idem) not between 8 and 128 then raise exception 'bad_idempotency_key' using errcode = 'P0001'; end if;
  if p_account is null or char_length(p_account) not between 1 and 120 then raise exception 'invalid_publication' using errcode = 'P0001'; end if;
  if p_options is null or jsonb_typeof(p_options) <> 'object' or pg_column_size(p_options) > 600 then raise exception 'invalid_publication' using errcode = 'P0001'; end if;
  if p_consent is null or jsonb_typeof(p_consent) <> 'object' or coalesce((p_consent->>'preview_confirmed')::boolean, false) is not true
     or coalesce((p_consent->>'express_consent')::boolean, false) is not true then raise exception 'consent_required' using errcode = 'P0001'; end if;
  select id, workspace_id, status, kind, storage_path into rd from public.renders where id = p_render;
  if not found or p_ws is null or rd.workspace_id <> p_ws or not public.can_edit(rd.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into prev from public.publications where workspace_id = rd.workspace_id and idempotency_key = p_idem;
  if found then return jsonb_build_object('publication_id', prev.id, 'state', prev.state, 'replay', true); end if;
  if rd.kind <> 'mp4' or rd.status <> 'ready' or rd.storage_path is null then raise exception 'render_not_ready' using errcode = 'P0001'; end if;
  if coalesce(p_publish_now, false) then t := now();
  else
    if p_scheduled_at is null or p_scheduled_at < now() + interval '60 seconds' then raise exception 'schedule_in_past' using errcode = 'P0001'; end if;
    t := p_scheduled_at;
  end if;
  if exists (select 1 from public.publications where provider = 'zernio' and zernio_account_id = p_account and render_id = p_render and state not in ('cancelled','failed')) then
    raise exception 'duplicate_publication' using errcode = 'P0001'; end if;
  -- TikTok for Business admite 15 vídeos por cuenta en 24 h móviles: se comprueba la ventana anterior y la posterior a la hora elegida.
  select count(*) into n_before from public.publications where provider = 'zernio' and zernio_account_id = p_account and state not in ('cancelled','failed')
     and coalesce(scheduled_at, created_at) > t - interval '24 hours' and coalesce(scheduled_at, created_at) <= t;
  select count(*) into n_after from public.publications where provider = 'zernio' and zernio_account_id = p_account and state not in ('cancelled','failed')
     and coalesce(scheduled_at, created_at) >= t and coalesce(scheduled_at, created_at) < t + interval '24 hours';
  if n_before >= 15 or n_after >= 15 then raise exception 'daily_cap' using errcode = 'P0001', detail = json_build_object('cap', 15)::text; end if;
  insert into public.publications(id, workspace_id, render_id, platform, provider, title, description, privacy, state, scheduled_at, created_by, idempotency_key,
      external_id, zernio_account_id, consent, attempts, post_options)
    values (pid, rd.workspace_id, p_render, 'tiktok', 'zernio', btrim(p_title), left(p_description, 2200), 'PUBLIC_TO_EVERYONE', 'queued',
      case when coalesce(p_publish_now, false) then null else p_scheduled_at end, auth.uid(), p_idem, pid::text, p_account,
      p_consent || jsonb_build_object('user', auth.uid(), 'at', now(), 'username', left(coalesce(p_username, ''), 80)), 0, p_options);
  return jsonb_build_object('publication_id', pid, 'state', 'queued', 'replay', false);
end $$;

-- Datos para el envío (los lee el servidor web con el JWT del usuario; devuelve la clave del MP4 en R2 para firmarla después).
create or replace function public.zernio_send_context(p_publication uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p record; r record;
begin
  select * into p from public.publications where id = p_publication and provider = 'zernio';
  if not found or not public.can_edit(p.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select storage_path, duration_ms into r from public.renders where id = p.render_id;
  return jsonb_build_object('publication_id', p.id, 'workspace_id', p.workspace_id, 'title', p.title, 'description', p.description, 'state', p.state,
    'object_key', r.storage_path, 'duration_ms', r.duration_ms, 'scheduled_at', p.scheduled_at, 'zernio_account_id', p.zernio_account_id, 'zernio_post_id', p.zernio_post_id,
    'post_options', p.post_options, 'consent', p.consent, 'attempts', p.attempts, 'created_at', p.created_at, 'error_code', p.error_code);
end $$;

-- Registro del resultado del envío (lo escribe el servidor web con el JWT del usuario). Solo estados de envío; «published» únicamente al reflejar la
-- realidad tras una cancelación tardía (p_override). Un usuario solo puede tocar publicaciones de Zernio de su espacio, con permiso de edición.
create or replace function public.record_zernio_send(p_publication uuid, p_state text, p_zernio_post text, p_code text, p_message text, p_retry_at timestamptz, p_override boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select id, workspace_id into p from public.publications where id = p_publication and provider = 'zernio';
  if not found or not public.can_edit(p.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_state not in ('queued','uploading','processing','scheduled','failed','cancelled') and not (p_state = 'published' and coalesce(p_override, false)) then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  update public.publications set state = p_state, zernio_post_id = coalesce(zernio_post_id, p_zernio_post), error_code = left(p_code, 80), error_message = left(p_message, 500),
      retry_at = p_retry_at, attempts = case when p_retry_at is not null then attempts + 1 else attempts end
   where id = p_publication and (state <> 'cancelled' or coalesce(p_override, false));
end $$;

-- Cancelar: la base de datos marca la cancelación; si la publicación ya estaba en Zernio, el servidor web la cancela allí a continuación.
create or replace function public.cancel_publication(p_publication uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select id, workspace_id, state, provider, zernio_post_id into p from public.publications where id = p_publication;
  if not found or not public.can_edit(p.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p.provider = 'zernio' then
    if p.state not in ('queued','scheduled','processing','failed') then raise exception 'not_cancellable' using errcode = 'P0001'; end if;
    update public.publications set state = 'cancelled', retry_at = null where id = p_publication;
    return jsonb_build_object('publication_id', p_publication, 'state', 'cancelled', 'provider', 'zernio', 'zernio_post_id', p.zernio_post_id);
  end if;
  if p.state not in ('scheduled','queued','failed','requiere_auditoria') then raise exception 'not_cancellable' using errcode = 'P0001'; end if;
  update public.publications set state = 'cancelled' where id = p_publication;
  return jsonb_build_object('publication_id', p_publication, 'state', 'cancelled');
end $$;

-- Evento firmado de Zernio (la firma ya la verificó el receptor): deduplica por id de evento y fija estado y enlace.
create or replace function public.zernio_event(p_event_id text, p_event text, p_zernio_post text, p_state text, p_url text, p_code text, p_message text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p record; ins int;
begin
  if p_event_id is null or char_length(p_event_id) not between 1 and 200 or p_zernio_post is null then raise exception 'invalid_event' using errcode = 'P0001'; end if;
  select id, workspace_id, state, post_url into p from public.publications where zernio_post_id = p_zernio_post and provider = 'zernio';
  if not found then return jsonb_build_object('ignored', 'unknown_post'); end if;
  insert into public.audit_events(workspace_id, actor, action, detail) values (p.workspace_id, null, 'zernio.webhook',
    jsonb_build_object('event_id', p_event_id, 'event', left(p_event, 80), 'publication', p.id)) on conflict do nothing;
  get diagnostics ins = row_count;
  if ins = 0 then return jsonb_build_object('duplicate', true); end if;
  if p_state is not null and p_state in ('processing','scheduled','published','failed') then
    update public.publications set state = p_state, error_code = case when p_state = 'failed' then left(p_code, 80) else null end,
      error_message = case when p_state = 'failed' then left(p_message, 500) else null end, retry_at = null where id = p.id;
  end if;
  if p_url is not null and char_length(p_url) <= 500 and p_url ~ '^https://' then update public.publications set post_url = p_url where id = p.id; end if;
  return jsonb_build_object('publication', p.id, 'applied', true);
end $$;

-- Las publicaciones de Zernio las ejecuta Zernio: aquí solo se reenvían las nativas vencidas (última definición: 113, con el filtro de proveedor).
create or replace function public.enqueue_due_publications() returns int
language plpgsql security definer set search_path = public as $$
declare p record; n int := 0; r jsonb;
begin
  for p in select pb.* from public.publications pb left join public.oauth_connections c on c.id = pb.connection_id
            where pb.provider = 'native' and pb.state = 'scheduled' and pb.scheduled_at <= now() and coalesce(c.profile->>'paused', 'false') <> 'true' for update of pb skip locked loop
    r := public.enqueue_job(p.workspace_id, 'publish', jsonb_build_array(jsonb_build_object('stage','publish','seq',1,'units',0,
           'params', jsonb_build_object('publication_id', p.id))), 'publish:' || p.id, '{}', null, null);
    update public.publications set state = 'queued', job_id = (r->>'job_id')::uuid where id = p.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.request_zernio_publication(uuid, text, text, timestamptz, boolean, text, text, text, jsonb, jsonb, uuid),
  public.zernio_send_context(uuid), public.record_zernio_send(uuid, text, text, text, text, timestamptz, boolean) from public, anon;
grant execute on function public.request_zernio_publication(uuid, text, text, timestamptz, boolean, text, text, text, jsonb, jsonb, uuid),
  public.zernio_send_context(uuid), public.record_zernio_send(uuid, text, text, text, text, timestamptz, boolean) to authenticated;
revoke all on function public.cancel_publication(uuid) from public, anon;
grant execute on function public.cancel_publication(uuid) to authenticated;
revoke all on function public.zernio_event(text, text, text, text, text, text, text), public.enqueue_due_publications() from public, anon, authenticated;
grant execute on function public.zernio_event(text, text, text, text, text, text, text), public.enqueue_due_publications() to service_role;
