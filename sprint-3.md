# Sprint 3 · Seguimiento, seguridad y entrega

**Fechas:** lunes 9 nov – viernes 13 nov 2026
**Objetivo del sprint:** Cerrar el ciclo de seguimiento (consultar historial y recibir recordatorios), endurecer la seguridad de los datos de salud y entregar una versión desplegada y demostrable de Diag-Knows.

## Sprint Backlog

| ID | Historia de usuario | Criterios de aceptación | Pts | Resp. |
|---|---|---|---|---|
| DK-301 | Como paciente, quiero consultar mi historial ("¿cómo ha estado mi glucosa esta semana?") para ver mi evolución. | Comando `/historial` y pregunta natural; resumen de los últimos 7 días generado a partir de consultas a la BD. | 5 | |
| DK-302 | Como paciente, quiero recordatorios de mi medicamento para no olvidar las tomas. | Configurar hora del recordatorio; el bot envía mensaje programado; se respeta la zona horaria del usuario. | 5 | |
| DK-303 | Como paciente, quiero poder borrar mis datos para tener control sobre mi información. | Comando `/borrar_datos` con confirmación; elimina o anonimiza registros del usuario. | 3 | |
| DK-304 | Como equipo, quiero proteger la base de datos para cumplir buenas prácticas con datos sensibles. | Usuario de BD con privilegios mínimos; conexión SSL; respaldo automatizado (`pg_dump`) documentado y probado. | 3 | |
| DK-305 | Como equipo, quiero el bot desplegado en un servidor para presentarlo sin depender de una laptop. | Despliegue (Render / Railway / VPS) con webhook; variables de entorno configuradas; `/health` accesible. | 3 | |
| DK-306 | Como equipo, quiero documentación final para la entrega del proyecto. | README con instalación, arquitectura, comandos del bot y diagrama; manual breve de usuario. | 2 | |

**Total comprometido:** 21 pts (si DK-204 pasó desde el Sprint 2, mover DK-303 al backlog de producto).

## Tareas técnicas

- [ ] Programador de tareas (`node-cron` o tabla de recordatorios revisada cada minuto).
- [ ] Índices en las tablas de registros por `paciente_id` + fecha para el historial.
- [ ] Prueba de restauración del respaldo en una BD limpia.
- [ ] *Code freeze* el jueves 12 a las 18:00: después solo se corrigen bugs.

## Calendario

| Día | Actividad |
|---|---|
| Lun 9 | Sprint Planning · DK-304 · DK-301 |
| Mar 10 | Daily · DK-301, DK-302 |
| Mié 11 | Daily · DK-302, DK-303, DK-305 |
| Jue 12 | Daily · DK-306 · *code freeze* 18:00 |
| Vie 13 | Ensayo de demo · Sprint Review final · Retrospectiva del proyecto |

## Entregable al Review

Demo completa sobre el bot desplegado: registro → reporte de síntomas y mediciones → recordatorio recibido → consulta de historial → borrado de datos. Se entrega el repositorio con README y respaldo de la BD.

## Retrospectiva final

Además de la retro normal, documentar en `docs/retrospectiva-final.md`:

- Velocidad real de los 3 sprints vs. la planeada.
- Historias que quedaron en el backlog de producto y por qué.
- Lecciones para una siguiente versión.
