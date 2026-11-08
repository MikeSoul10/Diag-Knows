# Diag-Knows · Instrucciones para Claude Code

Bot de Telegram para el seguimiento de enfermedades crónicas (diabetes tipo 2, hipertensión, asma).
Proyecto escolar de Administración de Bases de Datos (CUCEI, UdeG). Equipo de 3 personas, Scrum, 3 sprints de 1 semana (26 oct – 13 nov 2026).

## Contexto técnico (fuente de verdad)

@backend/AGENTS.md

## Mapa del repo

| Ruta | Qué es | ¿Se modifica? |
|---|---|---|
| `README.md` | Plan Scrum del equipo | **No**, salvo que el equipo lo pida |
| `sprint-1.md` · `sprint-2.md` · `sprint-3.md` | Backlog de cada sprint | Solo el agente `scrum-master` |
| `pendientes.md` | Estado real del proyecto y trabajo pendiente | Solo el agente `scrum-master` |
| `base_datos_enfermedades_cronicas.sql` | Esquema base (entregable) | **No**: los cambios van en migraciones |
| `backend/` | Código Node.js (ES Modules) | Sí |

Todos los comandos de Node se ejecutan desde `backend/`:

```bash
cd backend
npm test        # node --test (debe quedar en 0 fallos antes de cerrar cualquier tarea)
npm run dev     # bot en modo polling
```

## Cómo trabajar

1. Antes de programar, lee `pendientes.md` y el `sprint-N.md` activo. Trabaja solo lo que la tarea pide.
2. Respeta la arquitectura en capas: `channel/ → services/ → repositories/ + ai/ → db/`. Nunca al revés.
3. Las reglas de la sección 2 de `backend/AGENTS.md` (privacidad, consentimiento, cifrado, no diagnosticar) **no se negocian**.
4. Mientras `USE_MOCK_REPOS` / `USE_MOCK_AI` sean `true`, las pruebas no deben requerir red, BD ni llave de Anthropic.
5. No leas ni edites `.env`. Si falta una variable, agrégala a `.env.example` y avisa.
6. Commits con el formato del equipo: `DK-<id>: mensaje en imperativo`. No hagas commit ni push si no te lo piden.

## Agentes del proyecto (`.claude/agents/`)

| Agente | Úsalo para |
|---|---|
| `db-migraciones` | Migraciones SQL, `pool.js` y repositorios reales con `pg` (B1, B4) |
| `integracion-claude` | Cliente de la API de Claude, prompts, Zod, extractor real (B3, DK-201/202/203/205) |
| `tester` | Escribir y correr pruebas (`node --test`), integración con BD de prueba |
| `revisor-privacidad` | Revisar un cambio antes del PR contra las reglas de privacidad y seguridad |
| `scrum-master` | Actualizar `pendientes.md` y los sprints, preparar Daily, Review y Retro |

Flujo sugerido para cada historia: agente que implementa → `tester` → `revisor-privacidad` → `scrum-master` marca el avance.
