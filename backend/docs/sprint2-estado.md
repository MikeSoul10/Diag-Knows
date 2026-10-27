# Sprint 2 · estado al cierre del bloque 3

> Documento de trabajo del equipo. No sustituye a `../sprint-2.md` (backlog) ni a `../AGENTS.md` (reglas).
> Sin PostgreSQL ni Claude todavía: todo corre con mocks en memoria.

## Bloques

| Bloque | Alcance | Estado |
|---|---|---|
| 1 | `anonimizador`, `extractor` (mock + contrato), `validador` y sus pruebas | Terminado |
| 2 | Cuatro repos mock + `postgres.stubs.js`; `conversacion.js` con inyección de dependencias | Terminado |
| 3 | Adaptador Telegram: instancia, render, callbacks, mensajes, `/reportar`, `/cancelar`, menú de comandos | Entregado (pendiente demo en Telegram) |
| 4 | `/tome` (registrar toma sin pasar por el flujo de reporte) | Pendiente |

`npm test`: **157 pruebas, 0 fallos** (`node --test "test/**/*.test.js"`).

## Archivos

**Creados**
- `src/services/anonimizador.js`, `extractor.js`, `validador.js`, `conversacion.js`
- `src/repositories/mocks/mediciones.mock.js`, `sintomas.mock.js`, `medicamentos.mock.js`, `dosisLogs.mock.js`
- `src/repositories/postgres.stubs.js`
- `src/channel/conversacion.instancia.js`
- `test/anonimizador.test.js`, `extractor.test.js`, `validador.test.js`, `repos.test.js`, `conversacion.test.js`, `adaptador.test.js`

**Modificados**
- `src/config/env.js` (`usarIAMock`), `.env.example` (`USE_MOCK_AI`, `ANTHROPIC_MODEL`)
- `src/repositories/index.js` (nuevos repos + `reiniciarRepositorios`)
- `src/channel/format.js`, `handlers/render.js`, `handlers/message.js`, `handlers/callbacks.js`, `handlers/menu.js`, `bot.js`
- `main.js` (`await publicarComandos(bot)`)

## Decisiones vigentes

- **Extractor**: `medicacion [{ tomada, nombre? }]`, `mediciones [{ tipo, valor, valor2?, unidad }]`, `sintomas [{ descripcion, severidad? }]`. Recibe texto ya anonimizado; no diagnostica.
- **Intensidad**: la conversación pregunta 1/2/3 con botones Leve/Moderado/Fuerte; se guarda `LEVE`/`MODERADO`/`GRAVE`. Nunca se asume: si falta al guardar, falla.
- **Tokens**: 32 hex (16 bytes) por borrador; uno nuevo en cada cambio de borrador o paso, así todo botón anterior muere. `conv:ok` se consume antes de guardar y el estado queda `INACTIVO` con `token: null` (segundo clic = "ya quedó guardado", botón expirado o cancelado = "ya no está vigente"). Todos los `callback_data` ≤ 64 bytes (probado).
- **Estados por chat**: `INACTIVO`, `PREGUNTANDO_SINTOMAS`, `PREGUNTANDO_MEDICACION`, `PREGUNTANDO_MEDICIONES`, `ESPERANDO_CONFIRMACION`, `CORRIGIENDO`; expiran a los 30 min (reloj inyectable).
- **Servicio**: devuelve `{ texto, botones?, editarMensaje?, aviso? }`, texto en HTML con datos escapados y sin conocer Telegraf.
- **Guardado**: solo tras confirmar; un mensaje no entendido no toca el borrador; los rechazados se informan antes del resumen.
- **DK-205**: solo si es pregunta y no hay datos extraíbles; si hay datos, sigue el flujo normal.
- **Logs**: contexto + `error.name`, nunca texto del paciente ni valores clínicos.
- **Sin umbrales clínicos**: `esCritica` siempre `false`; las alertas son del Sprint 4.

## Qué falta

- **Bloque 4**: comando `/tome` con su handler y alta en `COMANDOS`.
- **Migración 004** (`src/db/migrations/`): `registros_dosis.horario_id` es `NOT NULL`, así que una toma suelta del chat no se puede insertar en PostgreSQL hasta agregar el soporte (y `PENDIENTE` para recordatorios).
- **Repos PostgreSQL reales**: hoy `postgres.stubs.js` solo avisa "No implementado"; conectar `pg` + `pgp_sym_encrypt` es del siguiente sprint.
- **Claude real**: `extraerConClaude` lanza "No implementado"; sin `ANTHROPIC_API_KEY` el bot usa `extraerMock`.
- **Demo del bloque 3 en Telegram** y revisión del PR (nada está commiteado).

## Siguiente paso exacto

Implementar el bloque 4: `src/channel/handlers/tome.js` que llame a `dosisLogs.guardarTomaMedicamento` para el medicamento del catálogo (o "sin nombre"), registrando `tomada: true` con la fecha/hora del mensaje, más `test/tome.test.js` y `npm test` en verde. Después, la migración 004 y la demo en Telegram.
