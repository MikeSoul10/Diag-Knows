import * as registration from '../../services/registration.service.js';
import { conversacion } from '../conversacion.instancia.js';
import { atenderCallback, responder } from './render.js';

/**
 * Botones en línea:
 *   consent:yes / consent:no  -> aviso de privacidad
 *   reg:iniciar               -> arrancar registro
 *   enf:<uuid>                -> elegir enfermedad del catálogo
 *   reg:ok / reg:no           -> confirmar o descartar el resumen
 *   conv:ok|no|skip:<token>   -> conversación de seguimiento
 *   sev:<token>:<i>:<1|2|3>   -> intensidad de un síntoma
 */

const RE_CONV = /^conv:(ok|no|skip):([0-9a-z]{1,32})$/;
const RE_SEV = /^sev:([0-9a-z]{1,32}):(\d{1,3}):([1-3])$/;

/**
 * Traduce el `callback_data` de la conversación a datos del servicio.
 *
 * Devuelve null si no es un botón de la conversación (los demás se atienden en
 * sus propios handlers) o si trae una forma inesperada.
 *
 * @param {string} datos `callback_data` de Telegram.
 * @returns {{accion: string, token: string, indice?: number, valor?: number}|null}
 */
export function parsearCallbackConversacion(datos) {
  if (typeof datos !== 'string') return null;

  const conv = RE_CONV.exec(datos);
  if (conv) return { accion: conv[1], token: conv[2] };

  const sev = RE_SEV.exec(datos);
  if (sev) {
    return {
      accion: 'sev',
      token: sev[1],
      indice: Number(sev[2]),
      valor: Number(sev[3]),
    };
  }

  return null;
}

export function registrarCallbacks(bot, servicio = conversacion) {
  function atenderConversacion(ctx) {
    const datos = parsearCallbackConversacion(ctx.callbackQuery?.data);

    return atenderCallback(ctx, () =>
      datos
        ? servicio.procesarCallback({ chatId: ctx.from.id, ...datos })
        : Promise.resolve({
            texto: 'Esa opción no la reconozco. Escríbeme lo que quieres registrar.',
            aviso: 'Opción desconocida',
          })
    );
  }

  bot.action(RE_CONV, atenderConversacion);
  bot.action(RE_SEV, atenderConversacion);

  bot.action('consent:yes', async (ctx) => {
    await registration.aceptarConsentimiento(ctx.from.id);
    await ctx.answerCbQuery();
    await ctx.editMessageText('Gracias. Vamos con tu registro.');
    return responder(ctx, await registration.iniciarRegistro(ctx.from.id));
  });

  bot.action('consent:no', async (ctx) => {
    await registration.rechazarConsentimiento(ctx.from.id);
    await ctx.answerCbQuery();
    return ctx.editMessageText(
      'Entendido. No guardaré ningún dato tuyo. Si cambias de opinión, envía /start.'
    );
  });

  bot.action('reg:iniciar', async (ctx) => {
    await ctx.answerCbQuery();
    return responder(ctx, await registration.iniciarRegistro(ctx.from.id));
  });

  bot.action(/^enf:([0-9a-fA-F-]{36})$/, async (ctx) => {
    const [, enfermedadId] = ctx.match;
    await ctx.answerCbQuery();
    const resultado = await registration.elegirEnfermedad(ctx.from.id, enfermedadId);
    // Se edita el mensaje de la pregunta para que no queden teclados viejos activos.
    if (resultado.tipo === 'resumen') {
      return ctx.editMessageText(resultado.mensaje);
    }
    return responder(ctx, resultado);
  });

  bot.action('reg:ok', async (ctx) => {
    const resultado = await registration.confirmarRegistro(ctx.from.id);
    await ctx.answerCbQuery();

    if (resultado.tipo === 'completado') {
      return ctx.editMessageText(resultado.mensaje);
    }
    return responder(ctx, resultado);
  });

  bot.action('reg:no', async (ctx) => {
    await registration.cancelarRegistro(ctx.from.id);
    await ctx.answerCbQuery();
    return ctx.editMessageText('Listo, no guardé nada. Escribe /registrar cuando quieras.');
  });
}
