# Sprint 2 · Conversación inteligente

**Fechas:** lunes 2 nov – viernes 6 nov 2026
**Objetivo del sprint:** Que el paciente pueda registrar síntomas, mediciones y tomas de medicamento hablando en lenguaje natural, y que Diag-Knows lo interprete con la Claude API y lo guarde en la base de datos.

> ⚠️ **Capacidad reducida:** el lunes 2 de noviembre puede ser día inhábil. La Sprint Planning se mueve al martes 3 y el compromiso baja a ~16 pts.

## Sprint Backlog

| ID | Historia de usuario | Criterios de aceptación | Pts | Resp. |
|---|---|---|---|---|
| DK-201 | Como equipo, quiero un servicio que conecte con la Claude API para centralizar las llamadas al modelo. | Módulo `services/claude.js`; clave en `.env`; manejo de errores y *timeout*; límite de tokens por petición. | 3 | |
| DK-202 | Como paciente, quiero escribir cómo me siento ("hoy me dolió la cabeza en la tarde") y que se registre como síntoma. | Claude devuelve JSON estructurado (síntoma, intensidad, fecha/hora); se valida antes de guardar; el bot confirma lo registrado. | 5 | |
| DK-203 | Como paciente, quiero registrar mediciones (glucosa, presión, peso) en texto libre. | Se reconocen al menos 3 tipos de medición con unidad; valores fuera de rango se marcan; confirmación al usuario. | 5 | |
| DK-204 | Como paciente, quiero indicar que tomé mi medicamento para llevar control de adherencia. | Comando `/tome` o frase natural; se guarda toma con hora; se asocia al tratamiento del paciente. | 3 | |
| DK-205 | Como paciente, quiero que el bot no me dé diagnósticos ni recete, para estar seguro de que la info es confiable. | Prompt de sistema documentado; ante preguntas médicas responde que consulte a su médico; 5 casos de prueba de seguridad pasan. | 2 | |

**Total comprometido:** 18 pts (bajar DK-204 al Sprint 3 si la velocidad del Sprint 1 fue < 18).

## Tareas técnicas

- [ ] Definir el esquema JSON de salida que Claude debe respetar y validarlo (ej. con `zod`).
- [ ] Guardar en la BD el mensaje original además del dato interpretado (trazabilidad).
- [ ] Manejar el contexto de la conversación (últimos N mensajes) por usuario.
- [ ] Pruebas con respuestas simuladas de Claude (*mocks*) para no gastar tokens en CI.

## Calendario

| Día | Actividad |
|---|---|
| Lun 2 | Posible día inhábil |
| Mar 3 | Sprint Planning · DK-201 · DK-205 |
| Mié 4 | Daily · DK-202 |
| Jue 5 | Daily · DK-203, DK-204 |
| Vie 6 | Cierre de PRs · Sprint Review · Retrospectiva |

## Entregable al Review

Demo: conversación de ejemplo donde un paciente reporta un síntoma, una medición de glucosa y la toma de su medicamento; se muestran los tres registros en la BD y una pregunta médica que el bot rechaza correctamente.

## Riesgos del sprint

- Claude interpreta mal fechas relativas ("ayer en la noche") → pasar la fecha y zona horaria actual en el prompt.
- Respuestas no estructuradas → reintento con mensaje de corrección y, si falla, pedir al usuario que reformule.
