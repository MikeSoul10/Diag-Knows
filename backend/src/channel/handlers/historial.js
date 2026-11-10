import { resumenHistorial, tipoDeArgumento } from '../../services/historial.js';
import { EXTRA_HTML } from '../format.js';
import { ejecutarConversacion, recordarConsentimiento } from './render.js';

/**
 * Envía el resumen del historial. Lo usan el comando /historial y la pregunta
 * en lenguaje natural (handlers/message.js).
 */
export async function responderHistorial(ctx, { tipo = null } = {}) {
  const respuesta = await ejecutarConversacion('el historial', () =>
    resumenHistorial({ chatId: ctx.from.id, tipo })
  );

  if (respuesta?.sinConsentimiento) return recordarConsentimiento(ctx);
  return ctx.reply(respuesta.texto, respuesta.error ? undefined : EXTRA_HTML);
}

/** Comando /historial [glucosa|presión|peso]. */
export function registrarComandoHistorial(bot) {
  bot.command('historial', async (ctx) => {
    const argumento = String(ctx.message?.text ?? '')
      .replace(/^\/historial(@\w+)?/i, '')
      .trim();

    return responderHistorial(ctx, { tipo: tipoDeArgumento(argumento) });
  });
}
