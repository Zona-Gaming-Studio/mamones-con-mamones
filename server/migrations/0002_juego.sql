-- Tablas del juego en D1 (lo único que cruza salas; el estado de cada sala
-- vive en su Durable Object). Traducción del esquema Postgres/Supabase:
-- unixepoch() en vez de now(), CHECK en vez de enums.

-- Roles (ex public.user_roles + enum app_role). Gobierna el panel admin de
-- cartas; el juego usa cuentas anónimas y no necesita roles.
-- Bootstrap del primer admin (una vez, con el correo ya registrado en /?admin):
--   wrangler d1 execute mamones-db --remote --command \
--     "insert into user_roles (user_id, role) select id, 'admin' from user where email = 'tucorreo@ejemplo.com'"
create table user_roles (
  id integer primary key autoincrement,
  user_id text not null references "user" ("id") on delete cascade,
  role text not null check (role in ('admin', 'moderator', 'user')),
  created_at integer not null default (unixepoch()),
  unique (user_id, role)
);

-- Catálogo de cartas (ex public.cartas). La identidad real de una carta es su
-- TEXTO (las salas guardan textos, no ids). NOTA DE MARCA: el color 'roja' es
-- la carta AMARILLA (mamón amarillo) — herencia del esquema, no renombrar.
create table cartas (
  id integer primary key autoincrement,
  color text not null check (color in ('verde', 'roja')),
  tipo text,
  texto text not null,
  flavor text,
  activa integer not null default 1,
  created_at integer not null default (unixepoch()),
  unique (color, texto)
);

create index cartas_color_activa_idx on cartas (color, activa);
