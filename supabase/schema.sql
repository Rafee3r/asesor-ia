-- Asesor IA Isapre: esquema completo (Supabase / Postgres)
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run

create extension if not exists pgcrypto;

-- Usuarios humanos de la app (uno por login)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol text not null default 'asesor' check (rol in ('admin','asesor')),
  created_at timestamptz not null default now()
);

-- Contactos: una ficha por persona, identificada por su numero o id de red social
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- identificadores por canal (al menos uno)
  wa_id text unique,              -- WhatsApp: numero en formato 569XXXXXXXX
  ig_id text unique,              -- Instagram: id del usuario (IGSID)
  fb_id text unique,              -- Messenger: id del usuario (PSID)
  canal_origen text check (canal_origen in ('whatsapp','instagram','messenger','formulario','manual')),

  -- perfil (lo completa el bot y se puede editar a mano)
  nombre text,
  telefono text,                  -- numero para la llamada (si escribio por IG/Messenger se le pide)
  email text,
  edad int,
  renta int,                      -- renta liquida mensual en pesos
  cargas int,                     -- numero de cargas
  edades_cargas text,
  comuna text,
  region text,
  prevision_actual text,          -- Fonasa o nombre de la isapre
  plan_actual text,
  costo_plan_actual int,
  clinica_preferida text,
  necesidades text,               -- lo que le importa: parto, cronicos, cobertura hospitalaria...
  preexistencias_mencionadas boolean,
  horario_llamada text,           -- como lo dijo el cliente
  llamada_programada_at timestamptz,

  -- estado comercial
  etapa text not null default 'Nuevo' check (etapa in (
    'Nuevo','En conversacion','Calificado','Llamada agendada','Llamada hecha',
    'Firma agendada','Cerrado','No responde','Descartado')),
  motivo_descarte text,
  temperatura text check (temperatura in ('frio','tibio','caliente')),
  estado_actualizado_at timestamptz not null default now(),
  resumen_ia text,                -- resumen corto que escribe el bot
  proximo_paso text,
  cotizacion text,                -- opciones de planes para la llamada (las pega el humano o un agente)

  -- origen del anuncio (para optimizar Meta Ads)
  ad_id text,
  ad_headline text,
  ctwa_clid text,                 -- click id de anuncios Click-to-WhatsApp
  fuente_url text,
  meta_lead_id text unique,       -- formularios de Meta (evita duplicados)

  -- control
  ia_activa boolean not null default true,   -- false = un humano tomo la conversacion
  consentimiento boolean not null default false,
  opt_out boolean not null default false,     -- pidio no ser contactado
  asignado_a uuid references profiles(id),
  notas text,
  last_inbound_at timestamptz,
  last_message_at timestamptz
);

create index if not exists contacts_etapa_idx on contacts(etapa);
create index if not exists contacts_last_msg_idx on contacts(last_message_at desc);

-- Mensajes de todos los canales
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  contact_id uuid not null references contacts(id) on delete cascade,
  canal text not null check (canal in ('whatsapp','instagram','messenger','llamada','nota')),
  direccion text not null check (direccion in ('entrante','saliente')),
  autor text not null check (autor in ('cliente','ia','humano','sistema')),
  texto text,
  meta_message_id text unique,     -- evita duplicados si Meta reintenta
  raw jsonb
);
create index if not exists messages_contact_idx on messages(contact_id, created_at);

-- Llamadas del agente de voz
create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  contact_id uuid not null references contacts(id) on delete cascade,
  programada_at timestamptz,
  estado text not null default 'programada' check (estado in ('programada','en_curso','completada','no_contesto','fallida','cancelada')),
  duracion_seg int,
  resultado text,                  -- cerrado, interesado, objecion, no interesado...
  resumen text,
  transcripcion text,
  grabacion_url text
);
create index if not exists calls_contact_idx on calls(contact_id);

-- Eventos de conversion para Meta (Conversions API)
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  contact_id uuid not null references contacts(id) on delete cascade,
  nombre text not null,            -- Lead, Calificado, LlamadaAgendada, Cerrado
  enviado_meta boolean not null default false,
  respuesta_meta jsonb
);

-- Cambiar de etapa reinicia el contador
create or replace function touch_estado() returns trigger as $$
begin
  if new.etapa is distinct from old.etapa then
    new.estado_actualizado_at := now();
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists contacts_touch_estado on contacts;
create trigger contacts_touch_estado before update on contacts
  for each row execute function touch_estado();

-- Seguridad: la app humana lee con login; webhooks, API y MCP usan la service role key
alter table profiles enable row level security;
alter table contacts enable row level security;
alter table messages enable row level security;
alter table calls enable row level security;
alter table events enable row level security;

create or replace function es_admin() returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and rol = 'admin');
$$ language sql security definer stable set search_path = public;

create policy "perfil propio o admin" on profiles for select using (id = auth.uid() or es_admin());
create policy "ver contactos" on contacts for select using (asignado_a = auth.uid() or es_admin());
create policy "editar contactos" on contacts for update using (asignado_a = auth.uid() or es_admin());
create policy "ver mensajes" on messages for select using (
  exists (select 1 from contacts c where c.id = contact_id and (c.asignado_a = auth.uid() or es_admin())));
create policy "ver llamadas" on calls for select using (
  exists (select 1 from contacts c where c.id = contact_id and (c.asignado_a = auth.uid() or es_admin())));
create policy "ver eventos" on events for select using (es_admin());
