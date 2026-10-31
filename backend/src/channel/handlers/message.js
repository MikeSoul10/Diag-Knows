import { message } from 'telegraf/filters';
import * as registration from '../../services/registration.service.js';
import { MENSAJE_SOLO_TEXTO } from '../format.js';
import { conversacion } from '../conversacion.instancia.js';
import {
  ejecutarConversacion,
  recordarConsentimiento,
  responder,
  responderConversacion,
} from './render.js';

/** Tipos de mensaje que el bot no puede leer en esta versión. */
const TIPOS_NO_TEXTO = [
  'voice',
  'photo',
  'document',
  'audio',
  'video',
  'video_note',
  'sticker',
  'animation',
];

/**
 * Texto libre.
 *
 * Orden de las comprobaciones:
 *   1. Consentimiento: sin paciente ACTIVO no se procesa nada.
 *   2. Registro: si hay un alta guiada a medias, el texto la alimenta.
 *   3. Conversación: síntoma, medición o toma en lenguaje natural.
 *
 * Voz, fotos y archivos se rechazan con una línea: esta versión solo entiende
 * texto (está fuera de alcance procesarlos).
 */
export function registrarMensajes(bot, servicio = conversacion) {
  bot.on(message('text'), async (ctx) => {
    const texto = ctx.message.text ?? '';

    // Los comandos ya los atienden sus handlers; Telegraf los procesa antes.
    if (texto.startsWith('/')) return;

    const paciente = await registration.obtenerPacienteActivo(ctx.from.id);
    if (!paciente) return recordarConsentimiento(ctx);

    if (registration.tieneRegistroEnCurso(ctx.from.id)) {
      return responder(ctx, await registration.procesarTexto(ctx.from.id, texto));
    }

    const respuesta = await ejecutarConversacion('el mensaje', () =>
      servicio.procesarMensaje({ chatId: ctx.from.id, texto })
    );

    return responderConversacion(ctx, respuesta);
  });

  bot.on(TIPOS_NO_TEXTO, (ctx) => ctx.reply(MENSAJE_SOLO_TEXTO));
}
