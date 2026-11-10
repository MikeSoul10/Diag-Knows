-- =====================================================================
--  src/db/roles.sql · Rol de la aplicación con mínimo privilegio (DK-103, DK-304)
--
--  Lo ejecuta el DUEÑO del esquema, después de `npm run db:migrate`:
--
--    psql "$DATABASE_URL_DUENO" -v app_password="'<contraseña larga>'" -f src/db/roles.sql
--
--  La app se conecta con `diag_app` (DATABASE_URL en .env). Ese rol solo puede
--  leer y escribir filas: no puede crear, alterar ni borrar tablas, y no puede
--  correr migraciones. La contraseña nunca se escribe en este archivo.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diag_app') THEN
    CREATE ROLE diag_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

ALTER ROLE diag_app WITH PASSWORD :app_password;

REVOKE ALL ON SCHEMA public FROM diag_app;
GRANT USAGE ON SCHEMA public TO diag_app;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM diag_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO diag_app;

-- La bitácora de consentimiento es de solo agregar: no se edita ni se borra
-- (el borrado del paciente la elimina por ON DELETE CASCADE).
REVOKE UPDATE, DELETE ON registros_consentimiento FROM diag_app;

-- El catálogo y el control de migraciones son de solo lectura para la app.
REVOKE INSERT, UPDATE, DELETE ON enfermedades, schema_migraciones FROM diag_app;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO diag_app;
