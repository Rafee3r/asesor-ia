-- Prompts y ajustes editables desde el Laboratorio (solo el servidor los lee y escribe)
create table if not exists settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table settings enable row level security;

-- Historial de versiones de prompts, para volver atrás
create table if not exists prompt_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  key text not null,
  value text not null,
  nota text
);
alter table prompt_versions enable row level security;

-- Evaluaciones del laboratorio (para comparar versiones de prompt)
create table if not exists lab_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tipo text not null check (tipo in ('chat','voz')),
  persona text,
  prompt_hash text,
  transcript jsonb,
  evaluacion jsonb
);
alter table lab_runs enable row level security;

-- es_admin solo la necesitan usuarios con sesion (RLS); no el publico anonimo
revoke execute on function es_admin() from anon;
