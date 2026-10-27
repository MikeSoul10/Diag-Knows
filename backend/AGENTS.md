# Asistente conversacional para el seguimiento de enfermedades (Telegram)

> Contexto técnico del proyecto para el agente de código (OpenCode lee este archivo automáticamente).
>
> **Cómo se reparten los documentos del repo:**
> - `README.md` → plan de trabajo Scrum del equipo (sprints, roles, ceremonias, flujo de Git). **No lo modifiques.**
> - `sprint-1.md`, `sprint-2.md`, `sprint-3.md` → backlog y tareas de cada sprint.
> - `AGENTS.md` (este archivo) → qué es el bot, reglas, arquitectura, esquema y código base.
> - `base_datos_enfermedades_cronicas.sql` → esquema de la base de datos (ya implementada).
>
> **Antes de empezar cualquier tarea, lee el sprint activo** (`sprint-N.md`) y trabaja solo las historias que ahí aparecen. Si algo de aquí contradice el sprint en cuanto a *qué construir primero*, manda el sprint; si contradice las reglas de la sección 2, mandan las reglas.
>
> **Rutas (importante):** este archivo y `main.js` están en `backend/`, pero `README.md`, `sprint-1.md`, `sprint-2.md`, `sprint-3.md` y `base_datos_enfermedades_cronicas.sql` están **un nivel arriba**, en la raíz del repo (`../`). Léelos con `../README.md`, `../sprint-1.md`, etc. La carpeta `src/` aún no existe: créala cuando se pida la estructura. Todas las rutas `src/...` de este documento son relativas a `backend/`.
>
> Fuente: documento de la Actividad #13 de Administración de Bases de Datos (CUCEI, UdeG).

---

## 1. Qué es el proyecto

Bot de Telegram con IA y PostgreSQL para que una persona con enfermedad crónica (diabetes tipo 2, hipertensión, asma) registre **síntomas, medicación y mediciones** escribiendo en lenguaje natural, sin instalar otra app.

El bot:

1. Pregunta al paciente por síntomas, medicación y mediciones.
2. Interpreta mensajes libres con la API de Claude y los convierte a JSON estructurado.
3. **Pide confirmación al paciente antes de guardar** (botones en línea).
4. Guarda el historial con fecha en PostgreSQL, con datos sensibles cifrados (AES-256).
5. Envía recordatorios de dosis con botón «Ya la tomé», alertas orientativas y un resumen semanal.

Ejemplo de mensaje: *"Me tomé la pastilla y tengo glucosa en 115"* → medicación tomada + medición de glucosa 115 mg/dL.

**Metodología:** Scrum. Plan vigente: 3 sprints de 1 semana (26 oct – 13 nov 2026), detallado en `README.md` y `sprint-N.md`. **Equipo:** 3 estudiantes.

---

## 2. Reglas que NO se pueden romper

Estas vienen de los límites del documento. Cualquier código nuevo debe respetarlas.

- **El bot no diagnostica, no prescribe y no ajusta dosis.** Las alertas son orientativas: dicen que conviene acudir con un profesional de la salud.
- **Los umbrales críticos NO los inventa el equipo ni el agente.** Deben ser revisados por un profesional de la salud. En código viven en `src/config/thresholds.js` con valor `null` hasta que estén validados; si es `null`, no se dispara alerta.
- **Nunca guardar sin confirmación del paciente** lo que la IA extrajo de un mensaje libre.
- **Cifrar con AES-256 usando `pgcrypto`** (`pgp_sym_encrypt(..., 'cipher-algo=aes256')`) en columnas `bytea`: valor de mediciones, descripción de síntomas y texto de resúmenes. La llave sale de `.env`; el `'clave_demo'` del script SQL es solo de ejemplo y nunca va en el código.
- **Anonimizar antes de llamar a la IA:** no enviar nombres, teléfonos, IDs de Telegram ni ningún identificador. Solo texto.
- **No se guarda nada sin consentimiento registrado** (`consent_logs`). Sin consentimiento, el bot solo muestra el aviso de privacidad.
- **Telegram no cifra de extremo a extremo** los chats con bots; el aviso de privacidad debe decirlo.
- **Recolección mínima:** no pedir nombre completo, dirección ni datos que no se necesiten.
- Credenciales y llaves **solo en `.env`** (no versionado). Un token y una BD distintos por entorno (pruebas / producción).
- Consultas SQL **siempre parametrizadas**.
- El canal (Telegram) debe quedar **desacoplado** de la lógica de negocio para poder migrar a WhatsApp después.

### Fuera de alcance en esta versión (no implementar)

Panel web para el médico, WhatsApp Business, mensajes de voz/imágenes/archivos, otros idiomas distintos al español, integración con expedientes clínicos o dispositivos (glucómetros, baumanómetros), app móvil propia, pruebas de carga.

---

## 3. Stack

| Capa | Tecnología |
|---|---|
| Canal | Telegram Bot API vía **Telegraf** (v4) |
| Backend | Node.js (LTS, ES2022+) + Express (webhook en producción) |
| BD | PostgreSQL 16+ (driver `pg`) |
| IA | API de Claude (`@anthropic-ai/sdk`) |
| Tareas programadas | `node-cron` |
| Despliegue | Railway o Render (HTTPS) |
| Control de versiones | Git + GitHub |

Dependencias iniciales:

```bash
npm init -y
npm i telegraf express pg node-cron dotenv @anthropic-ai/sdk zod
npm i -D nodemon
```

> Usa ES Modules: en `package.json` pon `"type": "module"`.

---

## 4. Arquitectura en capas

Cada capa solo habla con la inmediata inferior.

```
Telegram (paciente / admin)
   │
   ▼
[1] Presentación / canal ......... Telegram (sin app propia)
[2] Adaptador de canal ........... Telegraf: webhook, comandos, inline keyboards, formato HTML
[3] Lógica de negocio ............ registro/consentimiento · extracción IA · recordatorios · alertas/resúmenes
[4] Acceso a datos y seguridad ... repositorios, consultas parametrizadas, transacciones, cifrado (pgcrypto), pool
[5] Persistencia ................. PostgreSQL (SSL/TLS, roles restringidos, respaldos)
                                   ↘ API de Claude (se consulta desde [3], solo texto anonimizado)
```

### Estructura de carpetas sugerida

```
backend/
├─ main.js                      # punto de entrada (ya existe): bot + cron (+ Express si webhook)
├─ README.md                    # plan Scrum (no tocar)
├─ AGENTS.md                    # este archivo
├─ sprint-1.md · sprint-2.md · sprint-3.md
├─ base_datos_enfermedades_cronicas.sql   # puede moverse a src/db/schema.sql
├─ src/
│  ├─ config/
│  │  ├─ env.js                 # lee y valida variables de entorno
│  │  └─ thresholds.js          # umbrales (null hasta revisión clínica)
│  ├─ channel/                  # [2] adaptador de canal (único lugar que importa Telegraf)
│  │  ├─ bot.js                 # crea la instancia Telegraf y registra handlers
│  │  ├─ handlers/
│  │  │  ├─ start.js            # /start, consentimiento
│  │  │  ├─ message.js          # texto libre → servicio de extracción
│  │  │  ├─ callbacks.js        # botones: confirmar, "Ya la tomé", etc.
│  │  │  ├─ history.js          # /historial
│  │  │  └─ admin.js            # comandos del administrador
│  │  └─ format.js              # helpers de mensajes HTML y teclados
│  ├─ services/                 # [3] lógica de negocio (no conoce Telegraf)
│  │  ├─ registration.service.js
│  │  ├─ extraction.service.js  # IA: texto → JSON
│  │  ├─ reminders.service.js
│  │  ├─ alerts.service.js
│  │  └─ summaries.service.js
│  ├─ ai/
│  │  ├─ claude.js              # cliente Anthropic
│  │  ├─ prompts.js
│  │  └─ anonymize.js
│  ├─ repositories/             # [4] SQL parametrizado + cifrado
│  │  ├─ patients.repo.js
│  │  ├─ measurements.repo.js
│  │  ├─ symptoms.repo.js
│  │  ├─ medications.repo.js
│  │  ├─ doseLogs.repo.js
│  │  ├─ alerts.repo.js
│  │  └─ summaries.repo.js
│  ├─ db/
│  │  ├─ pool.js
│  │  ├─ schema.sql             # base_datos_enfermedades_cronicas.sql (entregable)
│  │  └─ migrations/
│  │     └─ 002_admin_alertas_resumenes.sql
│  └─ jobs/
│     └─ scheduler.js           # node-cron
├─ .env.example
├─ .gitignore                   # incluir .env
└─ README.md
```

**Regla de dependencias:** `channel/` importa de `services/`; `services/` importa de `repositories/` y `ai/`; `repositories/` importa de `db/` y `security/`. Nunca al revés. Los servicios reciben/devuelven objetos simples, no `ctx` de Telegraf.

---

## 5. Variables de entorno

`.env.example`:

```env
NODE_ENV=development

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_MODE=polling            # polling (local) | webhook (producción)
WEBHOOK_DOMAIN=                  # https://tu-app.up.railway.app (solo webhook)
WEBHOOK_SECRET=                  # cadena aleatoria para validar el webhook
PORT=3000

# Base de datos
DATABASE_URL=postgres://user:pass@localhost:5432/asistente_cronicas
DATABASE_SSL=false

# IA
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5-5

# Passphrase para pgp_sym_encrypt / pgp_sym_decrypt (larga y aleatoria). Generar con:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=

# Administradores (Telegram IDs separados por coma)
ADMIN_TELEGRAM_IDS=

# Zona horaria para cron y recordatorios
TZ=America/Mexico_City
```

---

## 6. Modelo de datos (PostgreSQL)

**Fuente de verdad:** `base_datos_enfermedades_cronicas.sql` (PostgreSQL 13+). Cópialo a `src/db/schema.sql`. Usa llaves `UUID` (`gen_random_uuid()`), `pgcrypto` y los nombres de tablas y columnas **en español**; el código debe usarlos tal cual.

| Tabla | Para qué sirve | Columnas clave |
|---|---|---|
| `pacientes` | Entidad central | `telegram_chat_id` (único), `telefono_hash`, `estado` (`ACTIVO`/`INACTIVO`/`BLOQUEADO`) |
| `registros_consentimiento` | Bitácora de consentimiento | `aceptado`, `version_privacidad`, `aceptado_en` |
| `medicamentos` | Medicación recetada | `nombre`, `dosis`, `frecuencia`, `fecha_inicio`, `fecha_fin` |
| `horarios_medicamento` | Horas de toma por medicamento | `hora_programada` (TIME), `activo` |
| `registros_dosis` | Seguimiento de cada toma | `programada_en`, `tomada_en`, `estado` (`TOMADA`/`OMITIDA`/`SALTADA`) |
| `mediciones` | Glucosa, presión, peso | `tipo_medicion` (`GLUCOSA`/`PRESION_ARTERIAL`/`PESO`), `valor_cifrado` (bytea), `unidad`, `es_critica` |
| `sintomas` | Síntomas descritos | `descripcion_cifrada` (bytea), `nivel_gravedad` (`LEVE`/`MODERADO`/`GRAVE`) |
| `citas` | Citas médicas | `fecha_cita`, `nombre_medico`, `recordatorio_enviado` |

Cosas a tener presentes del script:

- **Cifrado en la BD, no en Node.** Se cifra con `pgp_sym_encrypt(valor, llave, 'cipher-algo=aes256')` y se descifra con `pgp_sym_decrypt(columna, llave)`. La llave se pasa como parámetro desde `process.env.ENCRYPTION_KEY`. Los valores se guardan como texto (la presión como `"120/80"`).
- **El consentimiento no vive en `pacientes.estado`.** Un paciente tiene consentimiento válido si su registro **más reciente** en `registros_consentimiento` tiene `aceptado = TRUE`.
- **`es_critica` la calcula la app** al insertar la medición, comparando contra `src/config/thresholds.js` (los umbrales siguen en `null` hasta la revisión clínica).
- **El script empieza con `DROP TABLE ... CASCADE` y termina con datos de prueba.** Úsalo solo en desarrollo. Nunca lo corras sobre la BD del piloto.
- Mapeo con el documento: lo que el PDF llama `MISSED` aquí es `OMITIDA` (no respondió) y `SALTADA` (el paciente dijo que no la tomó).

### Lo que el SQL aún no cubre respecto al documento

El PDF (Actividad #13) habla de **11 tablas**; el script tiene 8. Faltan `ADMINISTRATORS`, `ALERTS` y `WEEKLY_SUMMARIES`, además de un estado `PENDIENTE` para dosis y soporte para asma. Sugerencia: no editar el script base, sino agregar `src/db/migrations/002_admin_alertas_resumenes.sql`:

```sql
-- Administrador (rol del alcance) y trazabilidad de quién configura medicamentos
CREATE TABLE administradores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id  BIGINT NOT NULL UNIQUE,
  nombre            VARCHAR(150) NOT NULL,
  creado_en         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE medicamentos ADD COLUMN creado_por UUID REFERENCES administradores(id);

-- Alertas orientativas enviadas
CREATE TABLE alertas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id  UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  medicion_id  UUID REFERENCES mediciones(id) ON DELETE SET NULL,
  tipo         VARCHAR(20) NOT NULL CHECK (tipo IN ('UMBRAL_CRITICO','DOSIS_OMITIDA')),
  severidad    VARCHAR(10) NOT NULL CHECK (severidad IN ('BAJA','MEDIA','ALTA')),
  enviada_en   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atendida     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_alertas_paciente ON alertas(paciente_id, enviada_en);

-- Resúmenes semanales (texto cifrado)
CREATE TABLE resumenes_semanales (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id           UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  semana_inicio         DATE NOT NULL,
  porcentaje_adherencia NUMERIC(5,2),
  texto_cifrado         BYTEA NOT NULL,
  enviado_en            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (paciente_id, semana_inicio)
);

-- Dosis: estado PENDIENTE y una sola fila por horario y momento programado
ALTER TABLE registros_dosis DROP CONSTRAINT registros_dosis_estado_check;
ALTER TABLE registros_dosis ADD CONSTRAINT registros_dosis_estado_check
  CHECK (estado IN ('PENDIENTE','TOMADA','OMITIDA','SALTADA'));
ALTER TABLE registros_dosis ADD CONSTRAINT uq_dosis_horario_momento UNIQUE (horario_id, programada_en);

-- Asma: medición de flujo pico (opcional, si el equipo lo decide)
ALTER TABLE mediciones DROP CONSTRAINT mediciones_tipo_medicion_check;
ALTER TABLE mediciones ADD CONSTRAINT mediciones_tipo_medicion_check
  CHECK (tipo_medicion IN ('GLUCOSA','PRESION_ARTERIAL','PESO','FLUJO_PICO'));
```

> Los nombres de las restricciones (`..._check`) son los que PostgreSQL genera por defecto; si tu `\d registros_dosis` muestra otros, ajústalos. Mientras no apliques la migración, el código **no debe** usar `PENDIENTE`, `FLUJO_PICO` ni las tablas nuevas, y los administradores se identifican con `ADMIN_TELEGRAM_IDS` del `.env`.

**Rol de BD:** crea un rol de aplicación con mínimo privilegio (sin `DROP`/`CREATE`), distinto del dueño del esquema. En producción, conexión con SSL/TLS y respaldos programados.

---

## 7. Código base

### 7.1 Cifrado con pgcrypto (`src/repositories/mediciones.repo.js`)

El cifrado ocurre en SQL. Los repositorios son el único lugar que conoce la llave.

```js
import { pool } from '../db/pool.js';

const KEY = process.env.ENCRYPTION_KEY;
if (!KEY) throw new Error('Falta ENCRYPTION_KEY');

export async function insertar({ pacienteId, tipo, valor, unidad, esCritica }) {
  const { rows } = await pool.query(
    `INSERT INTO mediciones (paciente_id, tipo_medicion, valor_cifrado, unidad, es_critica)
     VALUES ($1, $2, pgp_sym_encrypt($3::text, $4::text, 'cipher-algo=aes256'), $5, $6)
     RETURNING id`,
    [pacienteId, tipo, String(valor), KEY, unidad, esCritica]
  );
  return rows[0].id;
}

export async function listarPorRango(pacienteId, desde, hasta) {
  const { rows } = await pool.query(
    `SELECT id, tipo_medicion, pgp_sym_decrypt(valor_cifrado, $4::text) AS valor,
            unidad, es_critica, registrada_en
       FROM mediciones
      WHERE paciente_id = $1 AND registrada_en >= $2 AND registrada_en < $3
      ORDER BY registrada_en`,
    [pacienteId, desde, hasta, KEY]
  );
  return rows;
}
```

`sintomas.repo.js` y `resumenes.repo.js` siguen el mismo patrón (`descripcion_cifrada`, `texto_cifrado`).

> Limitación conocida: como la llave viaja como parámetro de la consulta, podría aparecer en logs de PostgreSQL si se activa `log_statement = 'all'` o `pg_stat_statements`. Para el prototipo es aceptable; documenta que en producción esos logs deben estar desactivados o restringidos.

Consentimiento válido (usar en `registration.service.js`):

```sql
SELECT COALESCE(
  (SELECT aceptado FROM registros_consentimiento
    WHERE paciente_id = $1 ORDER BY aceptado_en DESC LIMIT 1), FALSE) AS consentimiento_vigente;
```

### 7.2 Pool de conexiones (`src/db/pool.js`)

```js
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
});
```

### 7.3 Bot Telegraf (`src/channel/bot.js`)

```js
import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import * as registration from '../services/registration.service.js';
import * as extraction from '../services/extraction.service.js';
import * as reminders from '../services/reminders.service.js';

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Telegram solo admite un subconjunto de HTML: <b>, <i>, <code>, <a>
const html = { parse_mode: 'HTML' };

bot.start(async (ctx) => {
  const patient = await registration.findOrCreate(ctx.from.id);
  if (!patient.consentimientoVigente) { // se calcula con el último registro de registros_consentimiento
    return ctx.reply(
      '<b>Aviso de privacidad</b>\n' +
      'Este asistente guarda tus síntomas, medicación y mediciones para dar seguimiento a tu salud. ' +
      'Los chats con bots de Telegram <b>no tienen cifrado de extremo a extremo</b>. ' +
      'No sustituyo a tu médico ni a urgencias.\n\n¿Aceptas?',
      {
        ...html,
        ...Markup.inlineKeyboard([
          Markup.button.callback('Acepto', 'consent:yes'),
          Markup.button.callback('No acepto', 'consent:no'),
        ]),
      }
    );
  }
  return ctx.reply('Hola de nuevo. Cuéntame cómo te sientes hoy.', html);
});

bot.action('consent:yes', async (ctx) => {
  await registration.recordConsent(ctx.from.id, true);
  await ctx.editMessageText('Gracias. Tu administrador configurará tus medicamentos y horarios.');
  await ctx.answerCbQuery();
});

bot.action('consent:no', async (ctx) => {
  await registration.recordConsent(ctx.from.id, false);
  await ctx.editMessageText('Entendido. No guardaré ningún dato.');
  await ctx.answerCbQuery();
});

// Texto libre → IA → confirmación → guardar
bot.on(message('text'), async (ctx) => {
  const patient = await registration.requireActive(ctx.from.id);
  if (!patient) return ctx.reply('Primero envía /start y acepta el aviso de privacidad.');

  const draft = await extraction.extract(patient, ctx.message.text); // NO guarda
  if (!draft.hasData) return ctx.reply('No identifiqué datos para registrar. ¿Me lo cuentas de otra forma?');

  const draftId = await extraction.saveDraft(patient.id, draft); // borrador temporal
  return ctx.reply(extraction.describe(draft), {
    ...html,
    ...Markup.inlineKeyboard([
      Markup.button.callback('Sí, guardar', `draft:ok:${draftId}`),
      Markup.button.callback('No, corregir', `draft:no:${draftId}`),
    ]),
  });
});

bot.action(/^draft:ok:(.+)$/, async (ctx) => {
  await extraction.commitDraft(ctx.from.id, ctx.match[1]); // aquí sí se cifra y guarda
  await ctx.editMessageText('✅ Registrado.');
  await ctx.answerCbQuery();
});

bot.action(/^draft:no:(.+)$/, async (ctx) => {
  await extraction.discardDraft(ctx.from.id, ctx.match[1]);
  await ctx.editMessageText('Listo, no guardé nada. Cuéntame de nuevo.');
  await ctx.answerCbQuery();
});

// Confirmación de dosis: "Ya la tomé" / "No la tomé"
bot.action(/^dose:(taken|skipped):(.+)$/, async (ctx) => {
  const [, accion, registroId] = ctx.match;
  // TOMADA (+ tomada_en = now()) o SALTADA; si el paciente no responde, el cron la marca OMITIDA
  await reminders.respond(ctx.from.id, registroId, accion === 'taken' ? 'TOMADA' : 'SALTADA');
  await ctx.editMessageText(accion === 'taken' ? '✅ Toma registrada.' : 'Anotado. Si tienes dudas, consulta a tu médico.');
  await ctx.answerCbQuery();
});

bot.catch((err, ctx) => console.error(`Error en update ${ctx.update.update_id}`, err));
```

> Importante: `callback_data` en Telegram admite máximo **64 bytes**. Usa IDs cortos (por eso el borrador se guarda en BD o memoria y solo se manda su id).

### 7.4 Arranque: polling local vs. webhook en producción (`main.js`)

```js
import 'dotenv/config';
import express from 'express';
import { bot } from './src/channel/bot.js';
import { startScheduler } from './src/jobs/scheduler.js';

startScheduler(bot);

if (process.env.TELEGRAM_MODE === 'webhook') {
  const app = express();
  const path = '/telegram/webhook';
  app.use(await bot.createWebhook({
    domain: process.env.WEBHOOK_DOMAIN,
    path,
    secret_token: process.env.WEBHOOK_SECRET,
  }));
  app.get('/health', (_req, res) => res.send('ok'));
  app.listen(process.env.PORT || 3000);
} else {
  await bot.launch(); // long polling para desarrollo local
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
```

> Si `createWebhook` da problemas con tu versión de Telegraf, la alternativa clásica es `bot.telegram.setWebhook(url, { secret_token })` + `app.use(path, bot.webhookCallback(path))`.

### 7.5 Anonimización + extracción con IA

`src/ai/anonymize.js` (mínimo viable; reforzar con pruebas):

```js
export function anonymize(text, knownTerms = []) {
  let out = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[telefono]');
  for (const term of knownTerms.filter(Boolean)) {
    out = out.replace(new RegExp(term, 'gi'), '[nombre]');
  }
  return out;
}
```

`src/ai/claude.js` + prompt de extracción (la IA **solo** devuelve JSON):

```js
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const client = new Anthropic(); // usa ANTHROPIC_API_KEY

const Extraction = z.object({
  medication_taken: z.array(z.object({
    name: z.string().nullable(),
    taken: z.boolean(),
  })).default([]),
  measurements: z.array(z.object({
    type: z.enum(['GLUCOSA', 'PRESION_ARTERIAL', 'PESO']), // + 'FLUJO_PICO' si se aplica la migración 002
    value: z.string(),            // "115" o "120/80" (se cifra al guardar)
    unit: z.string(),
  })).default([]),
  symptoms: z.array(z.object({
    description: z.string(),
    severity: z.enum(['LEVE', 'MODERADO', 'GRAVE']).nullable(), // si es null, el bot pregunta la gravedad con botones
  })).default([]),
});

const SYSTEM = `Eres un extractor de datos de seguimiento de salud. Recibes un mensaje de un paciente en español.
Devuelve ÚNICAMENTE un objeto JSON, sin texto adicional ni markdown, con las claves:
medication_taken, measurements, symptoms.
- No diagnostiques, no interpretes, no des consejos.
- Si un dato no está en el mensaje, no lo inventes: deja el arreglo vacío.
- type de measurements: GLUCOSA (mg/dL), PRESION_ARTERIAL ("sistólica/diastólica", mmHg), PESO (kg).
- severity de síntomas: LEVE, MODERADO o GRAVE solo si el paciente lo expresa; si no, null.`;

export async function extractFromText(text) {
  const res = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL,
    max_tokens: 600,
    system: SYSTEM,
    messages: [{ role: 'user', content: text }], // texto YA anonimizado
  });
  const raw = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
  return Extraction.parse(json); // valida la forma; luego validar rangos plausibles en el servicio
}
```

En `extraction.service.js`: anonimizar → `extractFromText` → **validar rangos plausibles** (p. ej. rechazar glucosa negativa o 10 000) → crear borrador → pedir confirmación (y gravedad si falta) → al confirmar, llamar a los repositorios, que cifran con `pgp_sym_encrypt` al hacer el `INSERT`. El borrador pendiente puede vivir en memoria con expiración corta; no lo guardes en claro en la BD.

### 7.6 Recordatorios (`src/jobs/scheduler.js`)

```js
import cron from 'node-cron';
import { Markup } from 'telegraf';
import * as reminders from '../services/reminders.service.js';
import * as summaries from '../services/summaries.service.js';

export function startScheduler(bot) {
  // Cada minuto: busca horarios de ahora (horarios_medicamento activos, medicamento vigente, paciente ACTIVO con consentimiento) y envía el recordatorio
  cron.schedule('* * * * *', async () => {
    const due = await reminders.dueNow(); // [{ registroId, telegramChatId, medNombre }]
    for (const d of due) {
      await bot.telegram.sendMessage(
        d.telegramChatId,
        `💊 Es hora de tu <b>${d.medNombre}</b>.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[
            Markup.button.callback('Ya la tomé', `dose:taken:${d.registroId}`),
            Markup.button.callback('No la tomé', `dose:skipped:${d.registroId}`),
          ]]),
        }
      );
    }
  }, { timezone: process.env.TZ });

  // Marcar OMITIDA las dosis sin respuesta tras un margen (ej. +2 h). Cada 15 min.
  cron.schedule('*/15 * * * *', () => reminders.markMissedOverdue(), { timezone: process.env.TZ });

  // Resumen semanal: domingos 20:00
  cron.schedule('0 20 * * 0', () => summaries.sendWeekly(bot), { timezone: process.env.TZ });
}
```

> Con el esquema actual no hay estado `PENDIENTE`, así que no existe una fila hasta que el paciente responde o vence el margen. Por eso se recomienda aplicar la migración 002 (estado `PENDIENTE` y `UNIQUE (horario_id, programada_en)`): permite crear la fila al enviar el recordatorio y evita recordatorios duplicados. Sin ella, `dueNow()` debe evitar duplicados por otro medio (por ejemplo, una tabla en memoria con los recordatorios ya enviados ese minuto).

La adherencia semanal se calcula con SQL sobre `registros_dosis`:

```sql
SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE rd.estado = 'TOMADA') / NULLIF(COUNT(*), 0), 2) AS porcentaje_adherencia
FROM registros_dosis rd
JOIN horarios_medicamento h ON h.id = rd.horario_id
JOIN medicamentos m         ON m.id = h.medicamento_id
WHERE m.paciente_id = $1
  AND rd.programada_en >= $2
  AND rd.programada_en <  $2::timestamp + INTERVAL '7 days'
  AND rd.estado <> 'PENDIENTE';   -- quitar esta línea si no se aplicó la migración 002
```

---

## 8. Backlog y plan por sprint

El backlog vive en `sprint-1.md`, `sprint-2.md` y `sprint-3.md` (no se duplica aquí). Resumen del plan de `README.md`:

| Sprint | Fechas | Objetivo |
|---|---|---|
| 1 | 26 – 30 oct 2026 | Base técnica: servidor, bot conectado y capa de datos |
| 2 | 2 – 6 nov 2026 | Conversación inteligente: Claude API + registro de seguimiento |
| 3 | 9 – 13 nov 2026 | Historial, recordatorios, seguridad y demo |

Reglas de prioridad si el tiempo no alcanza: primero lo indispensable para que funcione de extremo a extremo (registro con consentimiento → conversación con IA → recordatorios con confirmación → resumen/alertas). Quedan como futuro el panel web para el médico y todo lo listado como fuera de alcance en la sección 2. La migración 002 (sección 6) y los umbrales clínicos se atienden cuando el sprint correspondiente los pida.

---

## 9. Definición de terminado y flujo de Git

Definition of Done global (de `README.md`):

- Código en `main` vía Pull Request revisado por al menos 1 compañero.
- Sin secretos en el repositorio (tokens y credenciales en `.env`, con `.env.example` actualizado).
- Pruebas de la funcionalidad pasan (`npm test`).
- Probado manualmente en el bot de desarrollo de Telegram.
- Documentado si cambia cómo se ejecuta o configura algo.
- Datos sensibles cifrados y con consentimiento registrado (regla del proyecto).

Flujo de Git:

- `main` está protegida; no se hace push directo.
- Ramas: `feature/DK-<id>-descripcion-corta` y `fix/DK-<id>-...`.
- Commits: `DK-<id>: mensaje en imperativo` (ej. `DK-104: agrega comando /registrar`).
- Cada historia cierra con un PR que referencia su ID. **El agente no debe hacer commit ni push por su cuenta**: prepara los cambios y el equipo decide cuándo commitear.
- `npm test` debe existir y pasar; para pruebas se puede usar el test runner nativo de Node (`node --test`) o el que el equipo acuerde.

---

## 10. Entornos

| Entorno | Bot | Base de datos | Notas |
|---|---|---|---|
| Local | Bot de pruebas (BotFather), `polling` | `asistente_cronicas` con datos ficticios | Sin datos reales de pacientes |
| Pruebas | Bot de pruebas | BD separada con datos ficticios | Para el Sprint Review |
| Producción (piloto) | **Bot distinto** al de pruebas, `webhook` | PostgreSQL gestionado con respaldos | Railway o Render con HTTPS |

---

## 11. Cómo arrancar (primer día)

```bash
# 1. Crear el bot en Telegram con @BotFather y copiar el token a .env
# 2. Crear la BD y el esquema (si ya la tienes implementada, omite este paso).
#    El script hace DROP TABLE y mete datos de prueba: solo en desarrollo
createdb asistente_cronicas
psql asistente_cronicas -f src/db/schema.sql
psql asistente_cronicas -f src/db/migrations/002_admin_alertas_resumenes.sql   # opcional, ver sección 6

# 3. Generar la passphrase de cifrado y pegarla en .env como ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Instalar y correr
npm install
npm run dev        # "dev": "nodemon main.js"
```

`package.json` (scripts):

```json
{
  "type": "module",
  "scripts": {
    "start": "node main.js",
    "dev": "nodemon main.js"
  }
}
```

---

## 12. Instrucciones para el agente de código

- Lee `README.md` y el `sprint-N.md` activo antes de empezar. Trabaja **una historia a la vez** y menciona su ID `DK-<id>` al resumir lo que hiciste.
- No toques `README.md` ni los `sprint-N.md`, salvo que se te pida marcar tareas.
- Respeta la arquitectura en capas y la regla de dependencias de la sección 4.
- El esquema vigente es `src/db/schema.sql` más las migraciones en `src/db/migrations/`. Usa los nombres en español tal cual. Antes de agregar una tabla o columna, crea una migración nueva; no edites el script base.
- Cifra y descifra solo en los repositorios, con `pgp_sym_encrypt` / `pgp_sym_decrypt` y la llave de `process.env.ENCRYPTION_KEY`.
- No hardcodees umbrales clínicos, tokens ni llaves.
- Todo mensaje al paciente va en **español**, tono breve y claro, formato HTML de Telegram (`<b>`, `<i>`, `<code>`).
- Ante duda clínica, el bot **recomienda acudir con un profesional de la salud**; nunca da un diagnóstico.
- No agregues funciones fuera de alcance (sección 2).
- Cada historia debe poder demostrarse en una demo funcional al final del sprint.

---

## 13. Referencias de antecedentes (para inspiración, no para copiar)

**TensioBot** (Telegram, hipertensión; código abierto GPLv3) es el antecedente más cercano en canal y arquitectura. Otros: Clivi (WhatsApp, diabetes), CHAMP (WhatsApp, DM2), Medisafe (recordatorios con confirmación), mySugr, Lark Health y Florence.

**Qué aporta este proyecto frente a ellos:** registro en lenguaje natural con IA generativa, varias enfermedades en un mismo bot, síntomas descriptivos en el historial, privacidad desde el diseño de la BD (anonimización antes de la IA, cifrado AES-256, bitácora de consentimiento) y resumen semanal redactado.
