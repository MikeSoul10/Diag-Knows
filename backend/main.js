/**
 * Punto de entrada.
 *
 * - Siempre levanta Express con GET /health (DK-102).
 * - TELEGRAM_MODE=polling (local): el bot usa long polling.
 * - TELEGRAM_MODE=webhook (producción): Telegram entrega los updates en
 *   POST /telegram/webhook, validando WEBHOOK_SECRET.
 */

import {
  cargarEntorno,
  configuracionWebhook,
  modoTelegram,
  puertoHttp,
  usarIAMock,
  usarRepositoriosMock,
} from './src/config/env.js';
import { crearBot, publicarComandos } from './src/channel/bot.js';
import { crearAppHttp, RUTA_WEBHOOK } from './src/channel/http.js';
import { estadoSalud } from './src/services/salud.service.js';
import { cerrarPool } from './src/db/pool.js';

cargarEntorno();

const modo = modoTelegram();
if (!['polling', 'webhook'].includes(modo)) {
  console.error(`TELEGRAM_MODE inválido: "${modo}". Usa polling o webhook.`);
  process.exit(1);
}

const bot = crearBot();

console.log(
  usarRepositoriosMock()
    ? 'Repositorios en memoria (mock). Configura DATABASE_URL y USE_MOCK_REPOS=false para PostgreSQL.'
    : 'Repositorios PostgreSQL.'
);
if (usarIAMock()) console.log('Extractor simulado (sin llamadas a Claude).');

let webhook;
if (modo === 'webhook') {
  const { dominio, secreto } = configuracionWebhook();
  await bot.telegram.setWebhook(`${dominio}${RUTA_WEBHOOK}`, {
    secret_token: secreto,
    drop_pending_updates: false,
  });
  webhook = { secreto, manejador: bot.webhookCallback(RUTA_WEBHOOK, { secretToken: secreto }) };
}

const app = crearAppHttp({
  estadoSalud: () =>
    estadoSalud({ registrarError: (err) => console.error('Health: BD sin respuesta', err?.code) }),
  webhook,
});

const puerto = puertoHttp();
const servidor = app.listen(puerto, () => {
  console.log(`HTTP escuchando en el puerto ${puerto} (GET /health).`);
});

// El menú de comandos se publica al arrancar; si falla, el bot sigue funcionando.
await publicarComandos(bot);

if (modo === 'polling') {
  // launch() no resuelve mientras el bot esté corriendo: no se espera.
  bot.launch().catch((err) => {
    console.error('El bot dejó de recibir mensajes:', err?.message);
    process.exitCode = 1;
  });
  console.log('Bot escuchando en modo polling. Ctrl+C para salir.');
} else {
  console.log('Bot escuchando por webhook.');
}

async function apagar(senal) {
  console.log(`Recibí ${senal}, cerrando…`);
  if (modo === 'polling') {
    try {
      bot.stop(senal);
    } catch {
      // ya estaba detenido
    }
  }
  servidor.close();
  await cerrarPool().catch(() => {});
}

process.once('SIGINT', () => apagar('SIGINT'));
process.once('SIGTERM', () => apagar('SIGTERM'));
