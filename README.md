# Diag-Knows · Plan de trabajo Scrum (3 semanas)

> Asistente conversacional en Telegram para el seguimiento de enfermedades crónicas.
> Stack: **Node.js + Express**, **Telegram Bot API**, **Claude API**, **PostgreSQL**.

## Contexto

La base de datos ya está diseñada e implementada. Este plan cubre la construcción de la aplicación sobre ella en **3 sprints de 1 semana** cada uno.

| Sprint | Fechas | Objetivo |
|---|---|---|
| [Sprint 1](./sprint-1.md) | lun 26 oct – vie 30 oct 2026 | Base técnica: servidor, bot conectado y capa de datos |
| [Sprint 2](./sprint-2.md) | lun 2 nov – vie 6 nov 2026 | Conversación inteligente: Claude API + registro de seguimiento |
| [Sprint 3](./sprint-3.md) | lun 9 nov – vie 13 nov 2026 | Valor al paciente: historial, recordatorios, seguridad y demo |

## Roles

| Rol | Responsable |
|---|---|
| Product Owner | _por asignar_ |
| Scrum Master | _por asignar_ |
| Dev Team | _integrantes del equipo_ |

En las tablas de backlog, la columna **Resp.** queda vacía para que el equipo la asigne en la Sprint Planning.

## Ceremonias (cada sprint)

| Ceremonia | Cuándo | Duración | Salida |
|---|---|---|---|
| Sprint Planning | Lunes, inicio del sprint | 45 min | Sprint backlog comprometido y tareas asignadas |
| Daily Scrum | Mar – Jue | 15 min | ¿Qué hice? ¿Qué haré? ¿Qué me bloquea? |
| Sprint Review | Viernes | 30 min | Demo del incremento al PO |
| Retrospectiva | Viernes, después del Review | 30 min | 1–3 acciones de mejora para el siguiente sprint |

## Estimación

Puntos de historia en escala Fibonacci (1, 2, 3, 5, 8). Velocidad objetivo inicial: **~20 pts/sprint**; se recalibra en cada retrospectiva.

## Definition of Done (global)

- [ ] Código en `main` vía Pull Request revisado por al menos 1 compañero.
- [ ] Sin secretos en el repositorio (tokens y credenciales en `.env`, con `.env.example` actualizado).
- [ ] Pruebas de la funcionalidad pasan (`npm test`).
- [ ] Probado manualmente en el bot de desarrollo de Telegram.
- [ ] Documentado (README o comentarios) si cambia cómo se ejecuta o configura algo.
- [ ] Tarjeta movida a **Done** en el tablero.

## Flujo de Git

- Rama principal: `main` (protegida).
- Ramas de trabajo: `feature/DK-<id>-descripcion-corta`, `fix/DK-<id>-...`.
- Commits: `DK-<id>: mensaje en imperativo` (ej. `DK-104: agrega comando /registrar`).
- Cada historia se cierra con un PR que referencia su ID.

## Riesgos generales

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Límites o costos de la Claude API | Medio | Límite de tokens por mensaje, caché de respuestas comunes, clave de pruebas compartida |
| Datos de salud sensibles | Alto | Cifrado en tránsito, mínimo de datos personales, aviso de privacidad en `/start` |
| El bot dé consejos médicos | Alto | Prompt de sistema que lo limita a seguimiento y siempre remite al médico |
| Días inhábiles (2 nov) | Medio | Sprint 2 planeado con menor capacidad |
