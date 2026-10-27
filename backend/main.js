/**
 * Punto de entrada.
 *
 * Sprint 1 (esta parte): arranca el bot en long polling.
 * DK-102 agrega el servidor Express con /health y el modo webhook.
 */

import { cargarEntorno, modoTelegram, usarRepositoriosMock } from './src/config/env.js';
import { crearBot, publicarComandos } from './src/channel/bot.js';

cargarEntorno();

const bot = crearBot();

// El menú de comandos se publica al arrancar; si falla, el bot sigue funcionando.
await publicarComandos(bot);

if (usarRepositoriosMock()) {
  console.log('Repositorios en memoria (mock). Configura DATABASE_URL para usar PostgreSQL.');
}

if (modoTelegram() === 'webhook') {
  console.error(
    'TELEGRAM_MODE=webhook todavía no está implementado: llega con DK-102 (Express + /health). Usa polling en local.'
  );
  process.exit(1);
}

await bot.launch();
console.log('Bot escuchando en modo polling. Ctrl+C para salir.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
