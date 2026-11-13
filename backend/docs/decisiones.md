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

## D11 · `/borrar_datos` borra al paciente y todo lo suyo (incluido el consentimiento)

`/borrar_datos` pide una confirmación con botones (token de un solo uso, vigente 5 minutos) y, al confirmar, borra la fila de `pacientes`. Por `ON DELETE CASCADE` se van también consentimientos, medicamentos, horarios, tomas, mediciones, síntomas, enfermedades, alertas, resúmenes y citas; además se descartan el alta y el reporte que estuvieran a medias. Quien vuelva a escribir `/start` empieza de cero.

Esto resuelve en el código el hallazgo 2 con la opción "derecho al olvido": `diag_app` no puede borrar la bitácora de consentimiento con un `DELETE` directo, pero sí desaparece al borrar al paciente. Verificado contra PostgreSQL 16 con el rol `diag_app` (el `DELETE` directo da `permission denied`; el `DELETE FROM pacientes` deja 0 filas en `registros_consentimiento`). **Pendiente de que el equipo o el PO lo confirmen:** si se prefiere conservar una constancia anónima del consentimiento, habría que anonimizar al paciente en lugar de borrarlo.

El borrado es en una sola sentencia (todo o nada). No se registran datos del paciente en logs.

## D12 · Cliente de Claude en `src/ai/claude.js` (DK-201) — reemplazado por D17

El criterio de DK-201 pide `services/claude.js`. Se siguió `AGENTS.md` §4, que pone el cliente en `src/ai/`; `services/extractor.js` lo usa. La salida se pide con structured outputs y se valida con Zod en Node, no con `messages.parse()`, porque los errores del SDK incluyen fragmentos de la respuesta (datos clínicos) y podrían terminar en logs. Si Claude falla o declina, el paciente recibe «No pude interpretar tu mensaje…»; **no** se cae al extractor por regex en silencio. El equipo puede cambiarlo si lo prefiere. No se activó el fallback del servidor para rechazos (`fallbacks`): con `claude-sonnet-5-5` solo cubre categorías como ciberseguridad, que no aplican a este bot. Detalle en `docs/ia-y-seguridad.md`.

## D13 · Momento del dato (DK-202)

Cada medición, síntoma o toma puede traer `ocurridoEn` cuando el paciente dice cuándo pasó; si no lo dice, se guarda con la hora de confirmación. Si menciona el día sin la hora, se usan las 12:00. Las partes del día se traducen a horas fijas: madrugada 3:00, mañana 9:00, mediodía 13:00, tarde 16:00 y noche 21:00. Se rechazan los momentos futuros y los de más de 7 días atrás. La zona es la del paciente (`pacientes.zona_horaria`), con `TZ` como respaldo.

## D14 · Mensaje original anonimizado, cifrado y con retención (tarea técnica del Sprint 2)

Para la trazabilidad se guarda el texto **anonimizado** (no el original con nombres o teléfonos), por recolección mínima. Va cifrado con AES-256 en `mensajes_reporte` (migración 006) y enlazado desde cada registro con `mensaje_id`. Solo se guarda lo confirmado. Caduca a los 90 días (`MENSAJES_RETENCION_DIAS`) y lo borra un temporizador diario en `main.js`; cuando exista `jobs/scheduler.js` (DK-302) puede moverse ahí. **Pendiente de que el equipo o el PO confirmen** el plazo de 90 días.

## D15 · Contexto de conversación solo en memoria

Los «últimos N mensajes» de la tarea técnica del Sprint 2 son los 5 más recientes por chat, anonimizados, en memoria y con caducidad de 30 minutos. Solo los usa la IA real como contexto y se le pide extraer únicamente del mensaje actual, para no registrar dos veces lo mismo. Se olvidan al confirmar, con `/cancelar` y con `/borrar_datos`.

## D16 · `es_critica` calculada por el servicio (DK-203)

`src/config/thresholds.js` existe con todos los umbrales en `null` y `esCritica()` devuelve `false` mientras sigan así. La conversación la calcula al guardar cada medición y los repositorios ya no fijan `FALSE` por su cuenta. **Pendiente del equipo:** definir qué profesional de la salud valida los umbrales y registrarlo en `VALIDACION_CLINICA`.


## D17 · La IA cambia de Claude a Groq (12 nov 2026)

Por decisión del equipo, la extracción con IA usa la API de **Groq** (`groq-sdk`) en lugar de la de Claude. Cambia solo el cliente: `src/ai/claude.js` se reemplazó por `src/ai/groq.js`, con la misma función `extraerDatos()` y el mismo esquema Zod. El prompt, la anonimización, el validador, la confirmación y las pruebas de seguridad de DK-205 siguen igual.

- **Variables:** `GROQ_API_KEY` y `GROQ_MODEL` reemplazan a `ANTHROPIC_API_KEY` y `ANTHROPIC_MODEL`. Sin `GROQ_API_KEY` el bot usa el extractor por regex, como antes.
- **Modelo:** `openai/gpt-oss-20b` por defecto. Se eligió porque Groq solo garantiza el esquema (Structured Outputs con `strict: true`) en algunos modelos, y ese es el más barato y rápido de ellos. `openai/gpt-oss-120b` también sirve.
- **Petición:** `response_format: json_schema` estricto, `reasoning_effort: low`, `include_reasoning: false` y `max_completion_tokens: 4000`. Si la respuesta se corta (`finish_reason: length`) o no cumple el esquema, se reintenta una vez con un mensaje de corrección.
- **Privacidad:** Groq también es un proveedor externo, así que la regla de anonimizar antes de llamar a la IA aplica igual. Conviene que el equipo revise la política de retención de datos de Groq antes del piloto.
- El agente `.claude/agents/integracion-claude.md` conserva su nombre, pero ahora le toca este cliente.
