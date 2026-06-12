# Supabase (Free) para Persistencia de `db.json`

Este proyecto puede guardar toda la base de datos como un JSON en Supabase (Postgres) para evitar que Render “reseteé” los datos al reiniciar.

## 1) Crear tabla en Supabase

En Supabase: **SQL Editor** → ejecuta:

```sql
create table if not exists public.app_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_kv disable row level security;
```

## 2) Variables de entorno en Render

En tu servicio de Render, añade:

- `SUPABASE_URL` = `https://TU-PROYECTO.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = (la Service Role Key del proyecto)
- `SUPABASE_DB_KEY` = `db` (opcional; por defecto `db`)

La `SUPABASE_SERVICE_ROLE_KEY` es un secreto de servidor. No la uses en frontend.

## 3) Deploy

Al arrancar, si Supabase no tiene datos, el servidor “semilla” el JSON inicial leyendo `db.json` del repo y lo guarda en Supabase. A partir de ahí, cada escritura se persiste en Supabase.

## Nota sobre uploads

Las subidas de imágenes (escudos) siguen yendo al filesystem local del contenedor. Si necesitas que los escudos sean persistentes, habría que moverlos a un storage externo (por ejemplo Supabase Storage o Cloudinary).
