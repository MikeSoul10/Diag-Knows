# Decisiones técnicas del equipo

Registro de decisiones que se apartan de lo escrito en `sprint-1.md` o en `AGENTS.md`, con su motivo. El equipo puede revertirlas en Planning.

## D1 · Estructura de carpetas (DK-101)

El criterio de DK-101 pide `src/{bot,routes,services,db}`. Se siguió la estructura de `AGENTS.md` §4, que es la que respeta la arquitectura en capas:

| Criterio DK-101 | Estructura real | Contenido |
|---|---|---|
| `src/bot` | `src/channel/` | Telegraf, handlers y formato (único lugar que conoce Telegram) |
| `src/routes` | `src/channel/http.js` | Express: `GET /health` y `POST /telegram/webhook` |
| `src/services` | `src/services/` | Lógica de negocio, sin `ctx` de Telegraf |
| `src/db` | `src/db/` + `src/repositories/` | Pool, esquema, migraciones; SQL parametrizado y cifrado |

## D2 · Test runner nativo de Node en lugar de Jest (DK-106)

Se usa `node --test` (incluido en Node ≥ 20): no agrega dependencias, soporta ES Modules sin configuración y ya cubre `describe`/`test`/`before`/mocks. Las 157 pruebas existentes ya estaban escritas así.

- `npm test` corre unitarias y de integración.
- Las de integración (`test/integracion/`) solo corren si existe `TEST_DATABASE_URL`; si no, se marcan como omitidas. Así `npm test` sigue funcionando sin red ni BD.
- GitHub Actions (`.github/workflows/ci.yml`) levanta PostgreSQL 16 y corre lint, formato y todas las pruebas en cada PR.

## D3 · `schema.sql` sin `DROP` ni datos de prueba

`src/db/schema.sql` es el DDL del entregable `base_datos_enfermedades_cronicas.sql` **sin** la sección de `DROP TABLE ... CASCADE` y sin los datos de prueba. Así es imposible borrar una BD real con `npm run db:migrate`. Los datos ficticios viven en `src/db/seed.sql` (`npm run db:seed`, bloqueado con `NODE_ENV=production`). El entregable de la raíz no se modificó.

## D4 · Migraciones con control de versiones

`npm run db:migrate` aplica `schema.sql` (solo si no existe `pacientes`) y luego cada `src/db/migrations/NNN_*.sql` pendiente, cada una en su transacción, anotándola en `schema_migraciones`. Funciona igual sobre una BD creada con el script original del equipo.

## D5 · Migración 004: `registros_dosis.paciente_id`

Además de lo propuesto en `pendientes.md`, la migración 004 agrega `registros_dosis.paciente_id` (NOT NULL, con backfill desde horario → medicamento). Sin esa columna, una toma suelta del chat sin medicamento identificado ("me tomé la pastilla") no tendría a qué paciente pertenecer.

## D6 · Estado PENDIENTE en una sola migración

La migración 002 de `AGENTS.md` también cambiaba el `CHECK` de `registros_dosis.estado`. Ese cambio se movió completo a la 004 (junto con la dosis suelta y el índice único parcial `(horario_id, programada_en)`), para no tocar la misma restricción dos veces. `FLUJO_PICO` (asma) queda fuera hasta que el equipo lo decida.

## D7 · Fechas en UTC

Las columnas del esquema son `TIMESTAMP` sin zona. La conexión fija `timezone=UTC`, los repositorios escriben con `toISOString()` y leen ISO con `Z`. La conversión a la zona del paciente se hace al mostrar (y con `pacientes.zona_horaria`, migración 005, en los recordatorios).

## D8 · Elección mock / PostgreSQL en cada llamada

`src/repositories/index.js` expone fachadas que deciden en cada llamada con `usarRepositoriosMock()`. Así no importa en qué orden se carguen `.env` y los módulos, y los servicios no cambian.

## D9 · Rol de aplicación

`src/db/roles.sql` crea `diag_app`: solo `SELECT/INSERT/UPDATE/DELETE` sobre filas, sin `CREATE`/`DROP`; no puede editar ni borrar la bitácora de consentimiento ni el catálogo de enfermedades. Las migraciones las corre el dueño del esquema.

## D10 · `/health` siempre activo

Express arranca también en modo polling, para que `curl http://localhost:3000/health` funcione en local. Responde `200 {"status":"ok","db":"ok"}` (`"mock"` en modo memoria) o `503 {"status":"error","db":"error"}`, sin detalles internos. El webhook valida `X-Telegram-Bot-Api-Secret-Token` en tiempo constante y exige `WEBHOOK_SECRET` de 32+ caracteres y `WEBHOOK_DOMAIN` con HTTPS.
