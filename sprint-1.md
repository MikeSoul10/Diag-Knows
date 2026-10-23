# Sprint 1 · Base técnica

**Fechas:** lunes 26 oct – viernes 30 oct 2026
**Objetivo del sprint:** Tener el bot de Telegram respondiendo desde un servidor Express conectado a la base de datos de Diag-Knows, con el registro inicial del paciente funcionando de punta a punta.

## Sprint Backlog

| ID | Historia de usuario | Criterios de aceptación | Pts | Resp. |
|---|---|---|---|---|
| DK-101 | Como equipo, quiero un repositorio con estructura base para trabajar en paralelo sin conflictos. | Estructura `src/{bot,routes,services,db}`, ESLint + Prettier, `.env.example`, scripts `dev`/`start`/`test`. | 2 | |
| DK-102 | Como equipo, quiero un servidor Express con endpoint de salud para verificar que la app está viva. | `GET /health` responde `200` con estado de la BD. | 2 | |
| DK-103 | Como equipo, quiero una capa de acceso a datos para no escribir SQL disperso en el código. | Pool de `pg` configurado por variables de entorno; repositorios para paciente y enfermedad; consultas parametrizadas. | 5 | |
| DK-104 | Como paciente, quiero iniciar el bot con `/start` y recibir una bienvenida que explique qué hace. | Mensaje de bienvenida + aviso de privacidad; responde en < 3 s. | 3 | |
| DK-105 | Como paciente, quiero registrarme (nombre, edad, enfermedad crónica) para que el bot me dé seguimiento. | Flujo guiado paso a paso; datos guardados en la BD; si el usuario ya existe, no se duplica. | 5 | |
| DK-106 | Como equipo, quiero pruebas automatizadas mínimas para detectar errores pronto. | Jest configurado; pruebas de repositorios con BD de prueba; GitHub Actions corre `npm test` en cada PR. | 3 | |

**Total comprometido:** 20 pts

## Tareas técnicas

- [ ] Crear el bot de desarrollo con @BotFather y guardar el token en `.env`.
- [ ] Elegir modo de conexión: *long polling* en desarrollo, *webhook* para despliegue.
- [ ] Script `db/seed.sql` con datos de prueba (enfermedades del catálogo).
- [ ] Configurar el tablero (GitHub Projects / Trello) con columnas: Backlog · To Do · In Progress · Review · Done.

## Calendario

| Día | Actividad |
|---|---|
| Lun 26 | Sprint Planning · DK-101 · creación del bot |
| Mar 27 | Daily · DK-102, DK-103 |
| Mié 28 | Daily · DK-103, DK-104 |
| Jue 29 | Daily · DK-105, DK-106 |
| Vie 30 | Cierre de PRs · Sprint Review · Retrospectiva |

## Entregable al Review

Demo en vivo: un integrante escribe `/start` al bot, se registra y el equipo muestra el registro creado en PostgreSQL.

## Riesgos del sprint

- Diferencias entre el esquema de la BD y lo que necesita el código → revisar el modelo el lunes antes de programar repositorios.
- Configuración de entornos distinta entre integrantes → `docker-compose` opcional con PostgreSQL local.
