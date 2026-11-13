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

`src/db/roles.sql` crea `diag_app`: solo `SELECT/INSERT/UPDATE/DELETE` sobre filas, sin `CREATE`/`DROP`; no tiene `UPDATE` ni `DELETE` directo sobre `registros_consentimiento` ni sobre el catálogo de enfermedades. La bitácora de consentimiento **sí desaparece** cuando se borra al paciente, por el `ON DELETE CASCADE` de D11: el rol no borra la fila, pero la cascada se ejecuta con los privilegios del dueño del esquema. Las migraciones las corre el dueño del esquema.

## D10 · `/health` siempre activo

Express arranca también en modo polling, para que `curl http://localhost:3000/health` funcione en local. Responde `200 {"status":"ok"}` o `503 {"status":"error"}`, sin detalles internos: no revela si el adaptador es mock o PostgreSQL, ni mensajes de error, versiones o cadenas de conexión. El webhook valida `X-Telegram-Bot-Api-Secret-Token` en tiempo constante y exige `WEBHOOK_SECRET` de 32+ caracteres y `WEBHOOK_DOMAIN` con HTTPS.

## D11 · `/borrar_datos` borra al paciente y todo lo suyo (incluido el consentimiento)

`/borrar_datos` pide una confirmación con botones (token de un solo uso, vigente 5 minutos) y, al confirmar, borra la fila de `pacientes`. Por `ON DELETE CASCADE` se van también consentimientos, medicamentos, horarios, tomas, mediciones, síntomas, enfermedades, alertas, resúmenes y citas; además se descartan el alta y el reporte que estuvieran a medias. Quien vuelva a escribir `/start` empieza de cero.

Esto resuelve en el código el hallazgo 2 con la opción "derecho al olvido": `diag_app` no puede borrar la bitácora de consentimiento con un `DELETE` directo, pero sí desaparece al borrar al paciente. Verificado contra PostgreSQL 16 con el rol `diag_app` (el `DELETE` directo da `permission denied`; el `DELETE FROM pacientes` deja 0 filas en `registros_consentimiento`).

**Decisión del 12 nov 2026:** el PO confirma el derecho al olvido con cascada. No se conserva una constancia anónima del consentimiento; si la persona vuelve, acepta el aviso de nuevo. D9 queda alineada con esta decisión.

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

## D18 · Recordatorios de medicamento (DK-302)

- **Alta por el propio paciente**, no por un administrador. Decisión del equipo del 12 nov: es más simple de usar y de demostrar. El paciente toca «⏰ Mis medicamentos» (o escribe /medicamentos) y da nombre → dosis → hora(s) → confirma. Se pueden dar hasta 4 horas por medicamento («8 y 20», «8 de la noche», «mediodía»). Nada se guarda sin confirmar. El rol de administrador (`ADMIN_TELEGRAM_IDS`, tabla `administradores`) queda para después.
- **Horas en la zona del paciente.** `horarios_medicamento.hora_programada` es hora local (`pacientes.zona_horaria`). El cron corre cada minuto y el servicio calcula cuál toca en la zona de cada paciente, así que no depende de `TZ` del servidor.
- **Un solo recordatorio por toma.** Al enviarlo se crea la dosis `PENDIENTE`. El índice único parcial `(horario_id, programada_en)` de la migración 004 impide duplicados aunque el cron corra dos veces o el bot se reinicie.
- **Ventana de 10 minutos.** Si el bot estuvo caído menos de 10 minutos, el recordatorio todavía sale. Si fue más tiempo, no se manda tarde y esa toma termina como `OMITIDA`.
- **OMITIDA a las 2 horas.** Cada 15 minutos se marca `OMITIDA` toda dosis `PENDIENTE` con más de 2 h. Si el paciente contesta después, se corrige a `TOMADA` o `SALTADA`.
- **Sin consejos.** «No la tomé» solo anota y remite al médico; nunca sugiere tomarla tarde ni doblar la dosis.
- **Resumen semanal.** El cron corre cada hora y `services/resumenes.js` decide en la zona del paciente: domingo a las 20:00 se envía el resumen de la semana en curso (lunes 00:00 → domingo 20:00 local). Se guarda cifrado en `resumenes_semanales` y el `UNIQUE (paciente_id, semana_inicio)` evita duplicados. Si no hubo tomas esperadas, no se envía nada.
- **Fuera de esta entrega:** el envío proactivo de alertas y las alertas por `DOSIS_OMITIDA` (ver D20), y desactivar o editar un horario desde el bot.
- **Sin administradores todavía.** `ADMIN_TELEGRAM_IDS` **no se aplica** en esta entrega y `medicamentos.creado_por` queda en `NULL`: el alta siempre es del propio paciente. Es un riesgo aceptado del piloto: cualquier paciente puede declarar sus medicamentos, pero **nada se guarda sin su confirmación** y los recordatorios solo salen con consentimiento vigente. Para habilitar el flujo de administrador haría falta validar `ADMIN_TELEGRAM_IDS` (o la tabla `administradores`), autorizar el alta desde un chat administrador y registrar quién la creó en `creado_por`; no se implementa en esta entrega.
- No hizo falta migración: el esquema ya tenía `horarios_medicamento`, el estado `PENDIENTE` y el índice único (004).

## D20 · Alertas por umbral crítico (DK-302)

- **Tabla, repo y hook listos.** `alertas.repo.js` (alta, consulta y marcar atendida) y el hook de `conversacion.js` quedan implementados: al confirmar una medición, si `esCritica()` la marca como crítica se crea la alerta `UMBRAL_CRITICO`/`ALTA` dentro de la misma transacción.
- **Nada se dispara en producción.** `src/config/thresholds.js` sigue con todos los umbrales en `null`, así que `evaluarMedicion()` y `registrarSiCorresponde()` devuelven `null` y no se inserta ninguna alerta. La lógica se prueba inyectando umbrales desde `test/alertas.test.js`.
- **Para activarlas** hace falta la validación clínica de D16: registrar quién firma los umbrales en `VALIDACION_CLINICA` y reemplazar los `null` correspondientes.
- **Fuera de esta entrega:** la alerta por `DOSIS_OMITIDA` (requiere que `marcarOmitidas` devuelva los ids, hoy devuelve solo el conteo) y el envío proactivo de la alerta al paciente. La tabla y el repositorio quedan listos para cuando se decida.
- No hizo falta migración: `alertas` ya existe en la 002 con sus `CHECK` de tipo y severidad.

## D19 · Registro técnico mínimo antes del consentimiento (hallazgo #12)

- **Qué se crea.** Al llegar `/start`, `registration.iniciar()` → `patients.findOrCreate()` inserta la fila de `pacientes` con solo `telegram_chat_id` (más `id`, `estado = ACTIVO` y `creado_en` por defecto). Esa fila existe aunque la persona todavía no haya aceptado el aviso.
- **Para qué.** Mantener el estado de la conversación y no volver a pedir el aviso en cada `/start`. No se usa para perfil ni para datos clínicos.
- **Qué NO se guarda.** Antes del consentimiento no se guarda alias, año de nacimiento, enfermedad, medicamentos, mediciones, síntomas ni el texto de los mensajes. El perfil se escribe solo al confirmar el registro y el resto de operaciones exigen consentimiento vigente. Si la persona toca «No acepto», se registra `aceptado = false` y no sigue nada más.
- **Cómo se borra.** `/borrar_datos` elimina al paciente y la cascada se lleva esa fila y el consentimiento (D11); no queda constancia anónima.
- **Transparencia.** El aviso de privacidad lo dice y el detalle técnico está en `docs/ia-y-seguridad.md`, sección «Consentimiento y registro técnico mínimo».


