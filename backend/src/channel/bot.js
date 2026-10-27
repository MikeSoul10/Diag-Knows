/**
 * Adaptador de canal: el ÚNICO lugar que conoce Telegraf.
 *
 * La lógica vive en `src/services/`; aquí solo se traducen updates de Telegram
 * a llamadas de servicio y viceversa. Migrar a WhatsApp debería implicar
 * escribir otro adaptador, no tocar los servicios.
 */

import { Telegraf } from 'telegraf';
import { obtenerTokenTelegram } from '../config/env.js';
import { registrarStart } from './handlers/start.js';
import { registrarMenu } from './handlers/menu.js';
import { registrarCallbacks } from './handlers/callbacks.js';
import { registrarMensajes } from './handlers/message.js';
import { conversacion } from './conversacion.instancia.js';

/**
 * Comandos del menú de Telegram.
 *
 * `/start` no se publica: siempre está disponible y Telegram lo muestra aparte.
 */
export const COMANDOS = Object.freeze([
  { command: 'registrar', description: 'Darte de alta paso a paso' },
  { command: 'reportar', description: 'Contar síntomas, mediciones o tomas' },
  { command: 'perfil', description: 'Ver tus datos guardados' },
  { command: 'cancelar', description: 'Salir de lo que tengas a medias' },
  { command: 'ayuda', description: 'Ver qué puedo hacer' },
]);

/**
 * Publica el menú de comandos en Telegram.
 *
 * Si falla (red, token de prueba), solo se registra el nombre del error: el bot
 * arranca igual y los comandos se siguen pudiendo escribir a mano.
 */
export async function publicarComandos(bot) {
  try {
    await bot.telegram.setMyCommands(COMANDOS);
    return true;
  } catch (error) {
    console.error(`[bot] No se pudieron publicar los comandos: ${error?.name ?? 'Error'}`);
    return false;
  }
}

export function crearBot(servicioConversacion = conversacion) {
  const bot = new Telegraf(obtenerTokenTelegram());

  // El orden importa: comandos, luego acciones de botones, al final texto libre.
  registrarStart(bot);
  registrarMenu(bot, servicioConversacion);
  registrarCallbacks(bot, servicioConversacion);
  registrarMensajes(bot, servicioConversacion);

  bot.catch(async (error, ctx) => {
    const updateId = ctx?.update?.update_id ?? 'desconocido';
    console.error(`Error en update ${updateId}:`, error);

    // Nunca se filtra el detalle técnico al paciente.
    try {
      await ctx?.reply?.('No pude completar eso. Intenta de nuevo en un momento.');
    } catch (errorDeRespuesta) {
      console.error('Tampoco se pudo avisar al paciente:', errorDeRespuesta);
    }
  });

  return bot;
}
