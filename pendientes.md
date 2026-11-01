# Diag-Knows · Estado del proyecto y trabajo pendiente

> **Corte:** sábado 31 de octubre de 2026 (después del cierre del Sprint 1, antes del Sprint 2). Actualizado el mismo día tras corregir los hallazgos 1 y 3 de `revisor-privacidad`.
> **Fuentes revisadas:** `README.md`, `sprint-1.md`, `sprint-2.md`, `sprint-3.md`, `backend/AGENTS.md`, `backend/docs/decisiones.md`, `backend/docs/sprint2-estado.md`, código en `backend/src/`, pruebas, `git status` y `git log`.
> **Verificación:**
> - `npm test`: 168 pruebas, 0 fallos (sin BD; las de integración se omiten solas; reproducido en este corte). Con `TEST_DATABASE_URL` contra PostgreSQL 16 en Docker: 186 pruebas, 0 fallos (reportado por el equipo, no reproducido en este corte).
> - `npm run lint` y `npm run format:check` pasan.
> - **Todo el trabajo del Sprint 1 está sin commitear en `main`** (último commit: `d9b11ea`). No hay PR, ni revisión, ni ejecución de CI en GitHub.
> - No hay `.env` (correcto: no se versiona) ni bot de desarrollo, así que no hay prueba manual en Telegram.

---

## 1. Resumen ejecutivo

| Sprint | Fechas | Comprometido | Avance real (Done según DoD) | Hecho técnico, pendiente DoD | Estado |
|---|---|---:|---:|---:|---|
| Sprint 1 | 26–30 oct | 20 pts | **0 pts (0 %)** | 20 pts (DK-101 a DK-106) | Cerrado sin historias Done; todas hecho técnico, falta PR y prueba manual |
| Sprint 2 | 2–6 nov | 18 pts (objetivo 16) | 0 pts | 0 pts | Por iniciar; flujo funcional sobre mocks y persistencia ya conectada |
| Sprint 3 | 9–13 nov | 21 pts | 0 pts | 0 pts | No iniciado |
| **Total** | | **59 pts** | **0 pts** | **20 pts** | |

**Criterio de conteo:** una historia suma puntos solo si cumple **toda** la Definition of Done del `README.md` (PR revisado en `main`, `npm test`, prueba manual en el bot de desarrollo, documentación, cifrado y consentimiento). "Hecho técnico, pendiente DoD" significa que los criterios de aceptación se cumplen en el código y las pruebas, y solo falta la prueba manual en Telegram, el PR o la revisión; esos puntos **no** se suman al avance. Una historia con huecos de código (🟡 parcial) no suma nada.

**Lo que ya funciona de punta a punta (con PostgreSQL, verificado con pruebas de integración):** `/start` → aviso de privacidad → consentimiento → `/registrar` (alias, año, enfermedad) → reporte por texto libre → extracción (regex) → validación → confirmación → guardado cifrado en PostgreSQL. `GET /health` responde `200`/`503`.

**Los bloqueadores reales hoy:**

1. **Nada está en `main` vía PR.** El hallazgo de privacidad 1 ya se corrigió: el PR ya no está bloqueado por privacidad. Falta abrirlo, revisarlo y ver correr el CI (conviene una pasada final de `revisor-privacidad`).
2. **No hay bot de desarrollo en BotFather.** Sin token no hay prueba manual en Telegram, que la DoD exige para todas las historias.
3. **No hay Claude.** `extraerConClaude()` sigue sin implementar; el extractor es por regex (DK-201).

**Riesgo principal:** el Sprint 2 arranca con 20 pts del Sprint 1 sin cerrar por DoD. Si el cierre de PR y la prueba manual no ocurren el lunes 2, la deuda se acumula sobre el Sprint 3.

---

## 2. Bloqueadores transversales (orden recomendado)

| # | Bloqueador | Estado | Historias que desbloquea |
|---|---|---|---|
| B0 | Abrir PR del Sprint 1, revisarlo y ver correr el CI (hallazgo 1 ya corregido) | 🟡 desbloqueado, PR sin abrir | Cierre por DoD de DK-101 a DK-106 |
| B1 | Pool de `pg` + repositorios reales + migraciones | 🟢 técnico (pendiente PR) | DK-103, 105, 202, 203, 204, 301, 302, 303 |
| B2 | Express + `/health` + modo webhook | 🟢 técnico (falta webhook con Telegram real) | DK-102, 305 |
| B3 | Cliente Claude + prompt de sistema | 🔴 | DK-201, 202, 203, 205 |
| B4 | Migraciones 003/004/005 (perfil, dosis suelta, zona horaria) | 🟢 técnico (aplicadas con `npm run db:migrate`) | DK-105, 204, 302 |
| B5 | Alta de medicamentos y horarios (admin) | 🔴 (existe `medicamentos.repo.js`, falta el flujo) | DK-302, 303 |
| B6 | Bot de desarrollo en BotFather + token en `.env` | 🔴 pendiente del equipo | Prueba manual de todas las historias |

---

## 3. Hallazgos de `revisor-privacidad` (abiertos)

Revisión del cambio del Sprint 1 (sin commitear). Prioridad: **P0** bloquea el PR · **P1** antes de cerrar el Sprint 2 · **P2** antes del piloto (DK-304/305). No queda ningún P0 abierto.

| # | Prioridad | Hallazgo | Corrección propuesta | Agente sugerido |
|---|---|---|---|---|
| 2 | P1 · IMPORTANTE | El `ON DELETE CASCADE` de `pacientes` borra `registros_consentimiento` aunque `diag_app` no tenga `DELETE` sobre esa tabla. D9 y el comentario de `roles.sql` dicen lo contrario. | **Decisión del equipo/PO:** (a) aceptarlo como derecho al olvido y corregir la documentación, o (b) migración nueva con `ON DELETE RESTRICT` y baja vía `INACTIVO`. Se conecta con DK-303. | `db-migraciones` (tras la decisión) |
| 4 | P1 · IMPORTANTE | `npm run db:seed` solo se protege con `NODE_ENV`. | Validar también `current_database()` o exigir `ALLOW_SEED=true`. | `db-migraciones` |
| 7 | P2 · sugerencia | En producción, sin `DATABASE_URL`, la app cae a mock en silencio. | Lanzar error en producción. | `db-migraciones` |
| 10 | P2 · sugerencia | La guardia de las pruebas de integración usa `/test/i`. | Exigir sufijo `_test` y rechazar `production`. | `tester` |
| 5 | P2 · sugerencia | `roles.sql` no tiene `ALTER DEFAULT PRIVILEGES`: las tablas nuevas no quedan con permisos para la app. | Agregar `ALTER DEFAULT PRIVILEGES`. | `db-migraciones` |
| 6 | P2 · sugerencia | La contraseña del rol queda en el log de PostgreSQL; `GRANT EXECUTE` sobre todas las funciones es demasiado amplio. | Usar `\password`; restringir `EXECUTE` a lo necesario (pgcrypto). | `db-migraciones` |
| 8 | P2 · sugerencia | `rejectUnauthorized: false` en `pool.js`. | Agregar `DATABASE_SSL_CA` para el piloto (DK-304). | `db-migraciones` |
| 11 | P2 · sugerencia | `/health` revela `db: "mock"`. | No exponer el modo. | _por asignar_ |
| 9 | P2 · sugerencia | `channel/conversacion.instancia.js` importa repositorios (rompe la regla de capas). | Mover la composición fuera de `channel/`. | _por asignar_ |
| 12 | P2 · sugerencia | `/start` crea la fila del paciente antes del consentimiento (necesario para registrar la decisión). | Documentarlo en `docs/decisiones.md` y en el aviso de privacidad. | _por asignar_ |

> La numeración (#) es la del reporte original; la tabla está ordenada por prioridad. Tras corregir, volver a pasar `tester` y `revisor-privacidad` antes de abrir el PR.

**Resueltos (verificados con `git diff` y `npm test`):**

- 🟢 **#1 (P0):** `bot.js` exporta `describirError(error)` (solo `nombre (código)`), usada por `bot.catch` y el aviso de respaldo. `test/logs.test.js` comprueba que el `detail` de pg y el `payload` de Telegram no llegan al log; ningún `console.error` en `src/` imprime el error completo.
- 🟢 **#3 (P1):** `enTransaccion` en `db/pool.js` con `AsyncLocalStorage`; `repositories/index.js` exporta `transaccion(fn)`. `persistir` (`conversacion.js`) y `confirmarRegistro` (`registration.service.js`) guardan todo o nada; si falla, el borrador se restaura con su token. Pruebas de integración en el bloque "guardado atómico" de `test/integracion/postgres.test.js`.

---

## 4. Sprint 1 · pendientes

> Ninguna historia cumple la DoD: falta PR revisado en `main` y prueba manual en Telegram para todas. El PR ya no está bloqueado por privacidad (hallazgo 1 resuelto).

### DK-101 · Estructura base (2 pts) — 🟡 hecho técnico, pendiente DoD

- [x] ESLint y Prettier configurados (`eslint.config.js`, `.prettierrc.json`, `.prettierignore`); scripts `lint`, `format` y `format:check`. Ambos pasan.
- [x] Decisión de estructura documentada en `backend/docs/decisiones.md` (D1): se sigue `src/{channel,config,db,repositories,services}` de `AGENTS.md`.
- [x] `.env.example` completo: `USE_MOCK_REPOS`, `USE_MOCK_AI`, `TEST_DATABASE_URL`; `ANTHROPIC_MODEL=claude-sonnet-5-5`.
- [x] `.gitignore` (`node_modules`, `.env`), scripts `dev`/`start`/`test`.
- [ ] PR revisado en `main`.

### DK-102 · Express + `/health` + webhook (2 pts) — 🟡 hecho técnico, pendiente DoD

- [x] `express` instalado; `src/channel/http.js` con `GET /health`: `200 {"status":"ok","db":"ok"}` contra PostgreSQL real y `503` sin detalles si la BD no responde.
- [x] Webhook con validación de `WEBHOOK_SECRET` en tiempo constante (`timingSafeEqual`).
- [x] `main.js` arranca Express en ambos modos; en webhook llama a `setWebhook` y ya no aborta (solo sale si `TELEGRAM_MODE` es inválido).
- [x] Polling solo con `TELEGRAM_MODE=polling`.
- [x] Pruebas en `test/http.test.js`.
- [ ] Probar el webhook con Telegram real (no hay token ni dominio; se cubre en DK-305).
- [ ] PR revisado en `main`.

### DK-103 · Capa de datos PostgreSQL (5 pts) — 🟡 hecho técnico, pendiente DoD

- [x] `pg` instalado; `src/db/pool.js` (sesión en UTC, D7).
- [x] `src/db/schema.sql`: script base sin `DROP` ni datos de prueba (D3).
- [x] Migraciones 002–005 aplicadas con `npm run db:migrate`, con control en `schema_migraciones` e idempotente (D4).
- [x] Repositorios reales con SQL parametrizado: `patients`, `consentimiento`, `enfermedades`, `mediciones` (AES-256), `sintomas` (AES-256), `medicamentos`, `dosisLogs`, más `salud` para `/health`.
- [x] `repositories/index.js` elige mock o real en cada llamada (D8); `postgres.stubs.js` eliminado.
- [x] `src/db/roles.sql` crea `diag_app` con privilegios verificados (ver hallazgos 2, 5 y 6).
- [x] `docker-compose.yml` con PostgreSQL local.
- [x] Pruebas de integración en `test/integracion/postgres.test.js`: flujo `/registrar` y reporte confirmado guardado en PostgreSQL.
- [ ] PR revisado en `main`.
- Fuera del criterio de aceptación (repos para paciente y enfermedad), pero aún pendientes:
  - [ ] `citas.repo.js` (propuesta: mover al backlog de producto; el bot no usa citas).
  - [ ] `alertas.repo.js` y `resumenes.repo.js` (Sprint 3, DK-302).
  - [ ] `dueNow` y `markMissedOverdue` (DK-302).
  - [ ] Borrado o anonimización del paciente (DK-303).

### DK-104 · `/start` + privacidad (3 pts) — 🟡 hecho técnico, pendiente DoD

- [x] Bienvenida, aviso de privacidad (incluye que Telegram no tiene cifrado E2E), botones Acepto/No acepto, consentimiento registrado en `registros_consentimiento`.
- [ ] Verificación manual en el bot de desarrollo (incluye el criterio de respuesta < 3 s).
- [ ] PR revisado en `main`.

### DK-105 · Registro guiado (5 pts) — 🟡 hecho técnico, pendiente DoD

- [x] Flujo paso a paso, validaciones, no duplica pacientes, retoma registro a medias.
- [x] Perfil persistido en PostgreSQL gracias a la migración 003, verificado con prueba de integración.
- [x] Atomicidad: `confirmarRegistro` guarda `updatePerfil` y `asignar` en una sola transacción (hallazgo 3 resuelto).
- [ ] Verificación manual en Telegram.
- [ ] PR revisado en `main`.

### DK-106 · Pruebas y CI (3 pts) — 🟡 hecho técnico, pendiente DoD

- [x] 168 pruebas con `node --test` sin BD; 186 con PostgreSQL de prueba.
- [x] Pruebas de repositorios contra BD real (`test/integracion/`).
- [x] `.github/workflows/ci.yml` con servicio PostgreSQL 16: lint, formato y pruebas.
- [x] Decisión `node --test` en lugar de Jest documentada (D2).
- [ ] Ver CI ejecutándose en GitHub (no hay push ni PR todavía).
- [ ] PR revisado en `main`.

### Tareas técnicas del Sprint 1

- [ ] Bot de desarrollo en @BotFather con token en `.env` (pendiente del equipo).
- [x] Decisión polling (local) vs webhook (producción), implementada en `main.js`.
- [x] `src/db/seed.sql` idempotente con el catálogo de enfermedades y un paciente ficticio (ver hallazgo 4).
- [ ] Tablero del equipo con columnas Backlog · To Do · In Progress · Review · Done (pendiente del equipo; no verificable desde el repo).

---

## 5. Sprint 2 · pendientes

### DK-201 · Cliente Claude (3 pts) — 🔴 no iniciado

- [ ] Instalar `@anthropic-ai/sdk` y `zod` (aún no están en `package.json`).
- [ ] `src/ai/claude.js`: cliente único, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `max_tokens` por petición, timeout y manejo de errores.
- [ ] `src/ai/prompts.js`: prompt de sistema que solo extrae datos y prohíbe diagnosticar, prescribir o ajustar dosis.
- [ ] Implementar `extraerConClaude()` en `src/services/extractor.js`.
- [ ] Validar la salida JSON con Zod y reintentar una vez con mensaje de corrección si no cumple.
- [ ] Anonimizar **siempre** antes de llamar a Claude (ya existe `anonimizador.js`; conectarlo al camino real).
- [ ] Nunca registrar en logs el texto del paciente ni valores clínicos (usar `describirError` también en el camino de Claude).
- [ ] Pruebas con respuestas simuladas de Claude (sin gastar tokens en CI).
- [x] `ANTHROPIC_MODEL` unificado a `claude-sonnet-5-5` en `.env.example`.

**Hecho cuando:** con `USE_MOCK_AI=false` y una llave válida, un mensaje libre produce el mismo contrato JSON que el mock, y un fallo de red no tumba el bot.

### DK-202 · Síntomas (5 pts) — 🟡 parcial

- [x] Persistencia en PostgreSQL con `descripcion_cifrada` (AES-256) en `sintomas.repo.js`, cubierta por la prueba de integración del reporte confirmado.
- [x] Guardado atómico tras confirmar, con reintento sin duplicados (hallazgo 3 resuelto).
- [ ] Extraer fecha/hora del mensaje ("ayer en la noche") y pasarla al prompt con zona horaria; hoy todo se guarda con la hora de confirmación.
- [ ] Guardar el mensaje original para trazabilidad (tarea técnica del sprint; no existe tabla). Debe ir cifrado y con política de retención.
- [x] Síntoma, intensidad (se pregunta si falta), validación y confirmación antes de guardar.

### DK-203 · Mediciones (5 pts) — 🟡 parcial

- [x] Persistencia en PostgreSQL (`valor_cifrado` AES-256, `unidad`, `es_critica`) en `mediciones.repo.js`.
- [ ] Crear `src/config/thresholds.js` con valores `null` hasta revisión clínica; mientras sean `null`, `es_critica = false` (el archivo no existe).
- [ ] Definir quién valida los umbrales (profesional de la salud) y dejar constancia.
- [x] Glucosa, presión y peso; unidades; rechazo de valores fuera de rango; confirmación con resumen.

### DK-204 · Toma de medicamento (3 pts) — 🟡 parcial

- [ ] Comando `/tome` (no existe) que registre la toma sin pasar por todo el flujo de reporte.
- [x] Esquema listo: migración 004 (`horario_id` nulo, `medicamento_id`, `nombre_reportado`, `paciente_id`) y `dosisLogs.repo.js`.
- [ ] Asociar la toma al medicamento del catálogo o guardar el nombre reportado si no está en el catálogo (verificar con `/tome`).
- [x] Frase natural "me tomé la metformina" ya se extrae y se confirma dentro del flujo de reporte.

### DK-205 · Sin diagnósticos (2 pts) — 🟡 casi

- [x] Detección de preguntas médicas sin datos: responde que consulte a su médico y no registra nada.
- [ ] Prompt de sistema documentado (no existe porque no hay Claude todavía).
- [x] Pruebas de seguridad del flujo (pregunta médica, sin consentimiento, sin guardar sin confirmar).
- [ ] Completar los 5 casos de prueba de seguridad que pide el criterio y documentarlos.

### Tareas técnicas del Sprint 2

- [ ] Esquema JSON de Claude validado (Zod) — pendiente de DK-201.
- [ ] Guardar el mensaje original además del dato interpretado — pendiente (ver DK-202).
- [ ] Contexto de conversación (últimos N mensajes) por usuario — hoy solo hay máquina de estados.
- [ ] Pruebas con respuestas simuladas de Claude — pendiente.

---

## 6. Sprint 3 · pendientes

### DK-301 · Historial (5 pts) — 🔴

- [ ] Comando `/historial` y pregunta natural ("¿cómo ha estado mi glucosa esta semana?").
- [ ] Resumen de los últimos 7 días a partir de consultas a la BD (mediciones, síntomas, adherencia).
- [ ] Descifrado en el repositorio, nunca en el servicio.
- [ ] Tono informativo, sin diagnóstico; siempre remitir al médico.

### DK-302 · Recordatorios (5 pts) — 🔴

- [ ] Instalar `node-cron` y crear `src/jobs/scheduler.js`.
- [ ] Alta de medicamentos y horarios por el administrador (existe el repo; no hay flujo en el bot).
- [ ] `dueNow()`: horarios activos, medicamento vigente, paciente `ACTIVO` con consentimiento vigente, hora actual en la zona del paciente.
- [ ] Crear la fila `PENDIENTE` al enviar el recordatorio y evitar duplicados con el índice único de la migración 004.
- [ ] Botones "Ya la tomé" / "No la tomé" (ya existe el handler; falta conectarlo a datos reales).
- [ ] `markMissedOverdue()`: marcar `OMITIDA` tras el margen (ej. +2 h), cada 15 min.
- [x] Migración 005 (`pacientes.zona_horaria`) aplicada.
- [ ] Decidir si el cron evalúa la zona de cada paciente en lugar de un solo `TZ` global.
- [ ] Resumen semanal (domingos 20:00) con texto cifrado y porcentaje de adherencia (`resumenes.repo.js`).
- [ ] Alertas orientativas (`alertas.repo.js`) solo cuando los umbrales estén validados.

### DK-303 · Borrado de datos (3 pts) — 🔴

- [ ] Comando `/borrar_datos` con confirmación explícita.
- [ ] Implementar borrado/anonimización en repositorios.
- [ ] Decidir qué pasa con `registros_consentimiento`: hoy el `ON DELETE CASCADE` lo borra aunque `diag_app` no tenga `DELETE` (hallazgo 2).
- [ ] Probar que no quedan datos huérfanos ni descifrables.

### DK-304 · Seguridad de la BD (3 pts) — 🟡 parcial (adelantado en DK-103)

- [x] Rol de aplicación `diag_app` con privilegios mínimos, distinto del dueño del esquema (`roles.sql`).
- [ ] Corregir hallazgos 5 y 6 (privilegios por defecto, contraseña en logs, `EXECUTE` amplio).
- [ ] Conexión SSL/TLS en producción con verificación de certificado (`DATABASE_SSL_CA`, hallazgo 8).
- [ ] Respaldo automatizado con `pg_dump` documentado.
- [ ] **Probar la restauración** en una BD limpia.
- [ ] Documentar la limitación de `pgp_sym_encrypt` con la llave como parámetro (logs de PostgreSQL desactivados/restringidos en producción).

### DK-305 · Despliegue (3 pts) — 🔴

- [ ] Elegir Render/Railway/VPS y desplegar con `TELEGRAM_MODE=webhook`.
- [ ] Configurar todas las variables de entorno en el panel (sin secretos en el repo).
- [ ] `/health` accesible públicamente (sin revelar el modo, hallazgo 11).
- [ ] Bot de producción distinto al de pruebas y BD distinta.
- [ ] Fallar al arrancar en producción si falta `DATABASE_URL` (hallazgo 7).

### DK-306 · Documentación final (2 pts) — 🔴

- [ ] README técnico con instalación, arquitectura, comandos del bot y diagrama.
- [ ] Manual breve de usuario.
- [ ] `docs/retrospectiva-final.md` con velocidad real vs. planeada, historias que quedaron fuera y lecciones.
- [ ] Actualizar `backend/docs/sprint2-estado.md` (dice "nada está commiteado").

### Tareas técnicas del Sprint 3

- [ ] Programador de tareas (`node-cron` o tabla de recordatorios revisada cada minuto).
- [ ] Índices para historial: ya existen `(paciente_id, registrada_en)` en mediciones y síntomas, e `idx_alertas_paciente` (002); agregar los que pidan las consultas reales.
- [ ] Prueba de restauración del respaldo.
- [ ] *Code freeze* jueves 12 a las 18:00.

---

## 7. Base de datos

Esquema vigente: `backend/src/db/schema.sql` (script base sin `DROP` ni datos) + migraciones en `backend/src/db/migrations/`, aplicadas con `npm run db:migrate` (control en `schema_migraciones`). Datos ficticios: `npm run db:seed`. Rol de la app: `src/db/roles.sql`.

| Necesidad del código | Migración | Estado |
|---|---|---|
| `administradores`, `creado_por` en medicamentos | 002 | 🟢 aplicada |
| Alertas y resúmenes semanales (tablas) | 002 | 🟢 aplicada (faltan repos, Sprint 3) |
| Flujo pico (asma, opcional) | — | 🔴 no incluido en la 002 (`FLUJO_PICO` no aparece); el código no debe usarlo |
| `alias`, `anio_nacimiento`; `enfermedades` y `paciente_enfermedades` | 003 | 🟢 aplicada |
| Toma suelta (`horario_id` nulo, `medicamento_id`, `nombre_reportado`) | 004 | 🟢 aplicada |
| `registros_dosis.paciente_id` | 004 | 🟢 aplicada (no estaba planeado; D5) |
| Estado `PENDIENTE` en `registros_dosis` | 004 | 🟢 aplicada (solo en la 004, no en la 002; D6) |
| Zona horaria del paciente | 005 | 🟢 aplicada |
| Conservar `registros_consentimiento` al borrar al paciente (`ON DELETE RESTRICT`) | 006 (si el equipo elige la opción b del hallazgo 2) | 🔴 decisión pendiente |
| Trazabilidad del mensaje original (`mensajes_paciente`, cifrado) | 006/007 (solo si el equipo la aprueba) | 🔴 propuesta |

> Si se aprueban las dos migraciones nuevas, acordar el número antes de crearlas para no chocar.
>
> Consideración de privacidad: guardar el mensaje original es útil para auditar la extracción, pero aumenta el volumen de datos sensibles. Debe ir cifrado, con retención corta y documentado en el aviso de privacidad.

---

## 8. Archivos que faltan

```
backend/
├─ src/
│  ├─ ai/
│  │  ├─ claude.js            ← cliente Anthropic (DK-201)
│  │  └─ prompts.js           ← prompt de sistema + corrección (DK-201/205)
│  ├─ config/
│  │  └─ thresholds.js        ← umbrales clínicos en null (DK-203)
│  ├─ db/migrations/
│  │  └─ 006_…sql             ← según la decisión del hallazgo 2 / trazabilidad
│  ├─ jobs/
│  │  └─ scheduler.js         ← recordatorios, omitidas, resumen semanal (DK-302)
│  ├─ repositories/
│  │  ├─ citas.repo.js        ← propuesta: backlog de producto
│  │  ├─ alertas.repo.js      ← DK-302
│  │  └─ resumenes.repo.js    ← DK-302
│  ├─ services/
│  │  ├─ reminders.service.js
│  │  ├─ alerts.service.js
│  │  ├─ summaries.service.js
│  │  └─ history.service.js
│  └─ channel/handlers/
│     ├─ tome.js              ← /tome (DK-204)
│     ├─ history.js           ← /historial (DK-301)
│     ├─ delete.js            ← /borrar_datos (DK-303)
│     └─ admin.js             ← alta de medicamentos/horarios
└─ test/                      ← scheduler, historial, borrado, Claude mock
```

Ya existen (Sprint 1): `src/db/{pool.js,schema.sql,seed.sql,roles.sql,migrate.js,init-test-db.sql}`, migraciones 002–005, repos reales de `patients`, `consentimiento`, `enfermedades`, `mediciones`, `sintomas`, `medicamentos`, `dosisLogs` y `salud`, `src/channel/http.js`, `src/services/salud.service.js`, `.github/workflows/ci.yml`, `eslint.config.js`, `.prettierrc.json`, `docker-compose.yml`, `docs/decisiones.md`.

## 9. Archivos existentes que hay que tocar

| Archivo | Cambio |
|---|---|
| `backend/src/channel/bot.js` | Registrar `/tome`, `/historial`, `/borrar_datos` en `COMANDOS` |
| `backend/src/services/conversacion.js` | Fechas del mensaje; mensaje original |
| `backend/src/db/migrate.js` | Guardia extra del seed (`current_database()` o `ALLOW_SEED=true`, hallazgo 4) |
| `backend/src/db/roles.sql` | `ALTER DEFAULT PRIVILEGES`, `\password`, `EXECUTE` acotado (hallazgos 5 y 6); corregir comentario sobre el borrado del consentimiento (hallazgo 2) |
| `backend/src/db/pool.js` | `DATABASE_SSL_CA` en lugar de `rejectUnauthorized: false` (hallazgo 8) |
| `backend/src/config/env.js` | Error en producción si falta `DATABASE_URL` (hallazgo 7); validar `ANTHROPIC_API_KEY`, `ADMIN_TELEGRAM_IDS` |
| `backend/src/channel/http.js` / `salud.service.js` | No revelar `db: "mock"` (hallazgo 11) |
| `backend/src/channel/conversacion.instancia.js` | Sacar la composición de repositorios de `channel/` (hallazgo 9) |
| `backend/test/integracion/postgres.test.js` | Guardia: sufijo `_test` y rechazar `production` (hallazgo 10) |
| `backend/docs/decisiones.md` | Corregir D9 (hallazgo 2); documentar que `/start` crea al paciente antes del consentimiento (hallazgo 12) |
| `backend/package.json` | Dependencias `node-cron`, `@anthropic-ai/sdk`, `zod` |
| `backend/main.js` | Arranque del scheduler (DK-302) |
| `backend/src/services/extractor.js` | Implementar `extraerConClaude` |
| `backend/src/channel/handlers/menu.js` | Handlers de los comandos nuevos |
| `backend/AGENTS.md` | Corregir "Sprint 4" inexistente y la ruta del README |

---

## 10. Pruebas y CI

- [x] 168 pruebas unitarias y de flujo (`node --test "test/**/*.test.js"`), 0 fallos.
- [x] Pruebas de integración con PostgreSQL de prueba (`test/integracion/postgres.test.js`; 186 en total con `TEST_DATABASE_URL`).
- [x] Pruebas de `/health` (200 y 503) y webhook (`test/http.test.js`).
- [x] GitHub Actions (`ci.yml`): lint, formato y pruebas con PostgreSQL 16. **Falta verlo correr en GitHub** (no hay push/PR).
- [x] Prueba de que los logs no registran datos del paciente (`test/logs.test.js`, hallazgo 1).
- [x] Prueba de atomicidad: rollback completo y reintento sin duplicados (bloque "guardado atómico" en `test/integracion/postgres.test.js`, hallazgo 3).
- [ ] Endurecer la guardia de la BD de integración (hallazgo 10).
- [ ] Pruebas de `scheduler` con reloj inyectable (recordatorio a la hora, no duplicado, marcado de omitidas).
- [ ] Pruebas de `/historial` (rango de 7 días, cifrado/descifrado, paciente sin datos).
- [ ] Pruebas de `/borrar_datos` (no quedan filas hijas).
- [ ] Pruebas de `/tome` (con medicamento del catálogo y con nombre libre).
- [ ] Pruebas de Claude con respuestas simuladas (JSON válido, JSON inválido, timeout, error de red).

---

## 11. Seguridad y privacidad · pendientes

- [x] Cifrado AES-256 real con `pgcrypto` en `mediciones` y `sintomas` (repos reales, verificado con integración).
- [ ] Cifrado de `resumenes_semanales.texto_cifrado` (falta `resumenes.repo.js`).
- [ ] `ENCRYPTION_KEY` generada y guardada solo en `.env`/panel del proveedor (no verificable desde el repo).
- [x] Rol de BD con mínimo privilegio (`diag_app`). Pendientes: hallazgos 2, 5 y 6.
- [ ] SSL con verificación de certificado en producción (hallazgo 8).
- [x] Ningún log con datos del paciente: `describirError` en `bot.catch` y el aviso de respaldo (hallazgo 1 resuelto). Mantener la regla en el código nuevo (Claude, scheduler).
- [ ] Desactivar/restringir `log_statement` y `pg_stat_statements` en producción por la llave como parámetro.
- [ ] Anonimizar antes de llamar a Claude (el anonimizador existe, falta conectarlo al camino real).
- [x] Sin consentimiento vigente no se guarda nada (implementado; consentimiento en `registros_consentimiento` con PostgreSQL).
- [ ] Documentar que `/start` crea la fila del paciente antes del consentimiento (hallazgo 12).
- [x] El aviso de privacidad menciona que Telegram no tiene cifrado E2E.
- [ ] Seed protegido más allá de `NODE_ENV` (hallazgo 4).
- [ ] Política de retención y borrado de datos (DK-303, hallazgo 2).

---

## 12. Documentación pendiente

- [ ] `README.md` técnico (DK-306): instalación, arquitectura, comandos, diagrama, manual de usuario. **No modificar el README Scrum actual sin decisión del equipo**: hoy es el plan de trabajo.
- [ ] `docs/retrospectiva-final.md`.
- [ ] Actualizar `docs/sprint2-estado.md`: "nada está commiteado" ya no es cierto (`d9b11ea`).
- [ ] Corregir referencias a un "Sprint 4" inexistente en `validador.js` y `mediciones.mock.js` (las alertas son del Sprint 3).
- [x] Decisiones sobre el test runner (D2) y la estructura de carpetas (D1) en `backend/docs/decisiones.md`.
- [ ] Corregir D9 en `decisiones.md` según la decisión del hallazgo 2.
- [ ] Documentar el procedimiento de respaldo y restauración.

---

## 13. Plan recomendado

### Propuesta para el Product Owner (decide el PO)

- **Cierre del Sprint 1 dentro del Sprint 2:** dedicar el lunes 2 a una pasada final de `revisor-privacidad`, crear el bot de desarrollo, probar manualmente DK-101–106 y abrir/revisar el PR. Esto no suma puntos nuevos al Sprint 2, pero consume capacidad (~medio día del equipo).
- **Mover al backlog de producto:** `citas.repo.js` (el bot no usa citas y no está en ningún criterio de aceptación).
- **Si el Sprint 2 se aprieta:** aplicar la regla ya prevista en `sprint-3.md` (mover DK-303 si DK-204 se recorre). Decidir antes del miércoles 4 la opción del hallazgo 2, porque condiciona DK-303.

### Sprint 2 (2–6 nov, objetivo 16 pts)

| Día | Trabajo | Pts |
|---|---|---:|
| Lun 2 | Pasada final de `revisor-privacidad` · bot en BotFather · prueba manual de DK-101–106 · PR del Sprint 1 y CI · Planning | (cierre S1) |
| Mar 3 | Hallazgo 4 (guardia del seed) · DK-201 cliente Claude + prompt + Zod | 3 |
| Mié 4 | DK-202/203 (fechas del mensaje, `thresholds.js`) · decisión del PO sobre el hallazgo 2 | 5 |
| Jue 5 | DK-203 · DK-204 `/tome` · DK-205 casos de seguridad | 6 |
| Vie 6 | Prueba manual en Telegram · PRs · Review | 2 |

### Sprint 3 (9–13 nov, 21 pts)

| Día | Trabajo |
|---|---|
| Lun 9 | DK-304 (hallazgos 5, 6, 8; respaldo) · DK-301 historial |
| Mar 10 | DK-301 · DK-302 recordatorios + scheduler + zona horaria |
| Mié 11 | DK-302 · DK-303 borrado · DK-305 despliegue |
| Jue 12 | DK-306 documentación · code freeze 18:00 |
| Vie 13 | Ensayo de demo · Review final · Retrospectiva |

**Si el tiempo no alcanza**, el orden de sacrificio propuesto es: DK-303 → DK-306 → DK-304. No sacrificar DK-103, DK-201, DK-204 ni DK-301/302: son el producto.

---

## 14. Definición de terminado (global)

- [ ] Código en `main` vía PR revisado por al menos 1 compañero.
- [ ] Sin secretos en el repositorio (`.env` fuera de Git, `.env.example` actualizado).
- [ ] `npm test` pasa.
- [ ] Probado manualmente en el bot de desarrollo de Telegram.
- [ ] Documentado si cambia cómo se ejecuta o configura algo.
- [ ] Datos sensibles cifrados y con consentimiento registrado.
- [ ] Historia demostrable en la demo del viernes.

---

## 15. Comandos de verificación

```powershell
cd C:\Users\migue\Desktop\Diag-Knows\backend

npm install
npm test                 # 168 pruebas sin BD, deben seguir en verde
npm run lint
npm run format:check
npm run dev              # requiere TELEGRAM_BOT_TOKEN en .env

# PostgreSQL local (docker-compose.yml):
# docker compose up -d
# npm run db:migrate     # schema.sql + migraciones 002–005, idempotente
# npm run db:seed        # datos ficticios; nunca en el piloto
# psql ... -f src/db/roles.sql   # rol diag_app

# Pruebas de integración (186 en total):
# TEST_DATABASE_URL=postgres://diag:diag@localhost:5433/asistente_cronicas_test npm test

# Generar llave de cifrado:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Health:
# curl http://localhost:3000/health
```

---

## 16. Fuera de alcance (no implementar)

Panel web para el médico, WhatsApp Business, mensajes de voz/imágenes/archivos, idiomas distintos al español, integración con expedientes clínicos o dispositivos (glucómetros, baumanómetros), app móvil propia y pruebas de carga.

---

## 17. Inconsistencias detectadas (corregir en documentación)

1. 🔴 `backend/docs/sprint2-estado.md` dice que nada está commiteado; el commit `d9b11ea` ya incluye el bloque anterior.
2. 🔴 Varios comentarios hablan de un **Sprint 4** que no existe en el plan (`src/services/validador.js`, `src/repositories/mocks/mediciones.mock.js`). Son del Sprint 3.
3. 🔴 `AGENTS.md` menciona `src/config/thresholds.js`, que aún no existe.
4. 🔴 `AGENTS.md` pide `dotenv`, pero el código usa `process.loadEnvFile()` (Node 20.12+); es correcto, solo hay que alinearlo.
5. 🔴 `AGENTS.md` dice que el `README.md` está en `backend/`, pero está en la raíz.
6. 🟢 Resuelta: `ANTHROPIC_MODEL=claude-sonnet-5-5` en `.env.example` y `AGENTS.md`.
7. 🟢 Resuelta por decisión documentada (D1): estructura de `AGENTS.md` en lugar de `src/{bot,routes,services,db}`; ESLint + Prettier ya existen.
8. 🟢 Resuelta por decisión documentada (D2): `node --test` en lugar de Jest; ya hay BD de prueba.
9. 🟢 Resuelta: DK-105 guarda el perfil en PostgreSQL.
10. 🟢 Resuelta por las migraciones 003 y 005 (`alias`, `anio_nacimiento`, enfermedades del paciente, zona horaria).
11. 🔴 Nueva: D9 y el comentario de `roles.sql` dicen que la app no puede borrar `registros_consentimiento`, pero el `ON DELETE CASCADE` de `pacientes` sí lo borra (hallazgo 2).
