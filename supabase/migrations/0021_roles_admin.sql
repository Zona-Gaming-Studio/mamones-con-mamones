-- Mamones con Mamones — Lote 21: roles + acceso admin a las cartas.
-- Habilita cuentas con rol y restringe la ESCRITURA de `cartas` a admins.
-- La lectura de `cartas` sigue pública (política cartas_select de la 0001).
-- Idempotente. Correr en Supabase.

-- ---------------------------------------------------------------------------
-- Enum de roles.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'moderator', 'user');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tabla de roles por usuario (un usuario puede tener varios).
-- ---------------------------------------------------------------------------
create table if not exists public.user_roles (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

alter table public.user_roles enable row level security;

-- ---------------------------------------------------------------------------
-- Chequeos de rol como SECURITY DEFINER: evitan la recursión de RLS (la
-- consulta interna corre como el dueño de la función, sin re-disparar la
-- política de user_roles).
-- ---------------------------------------------------------------------------
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role);
$$;

create or replace function public.is_admin(_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = 'admin');
$$;

grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS de user_roles: cada quien ve sus roles; solo admins gestionan.
-- ---------------------------------------------------------------------------
drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists user_roles_admin_write on public.user_roles;
create policy user_roles_admin_write on public.user_roles
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS de cartas: escritura (insert/update/delete) solo admin.
-- ---------------------------------------------------------------------------
drop policy if exists cartas_admin_insert on public.cartas;
create policy cartas_admin_insert on public.cartas
  for insert to authenticated with check (public.is_admin(auth.uid()));

drop policy if exists cartas_admin_update on public.cartas;
create policy cartas_admin_update on public.cartas
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists cartas_admin_delete on public.cartas;
create policy cartas_admin_delete on public.cartas
  for delete to authenticated using (public.is_admin(auth.uid()));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- BOOTSTRAP DEL PRIMER ADMIN (correr aparte, tras registrarte una vez):
--   insert into public.user_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'tucorreo@ejemplo.com'
--   on conflict do nothing;
-- Repetir por cada miembro del equipo que deba ser admin.
-- ---------------------------------------------------------------------------
