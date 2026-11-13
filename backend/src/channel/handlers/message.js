import { message } from 'telegraf/filters';
import * as registration from '../../services/registration.service.js';
import { MENSAJE_SOLO_TEXTO } from '../format.js';
import { conversacion, hayConversacionPendiente } from '../conversacion.instancia.js';
import { detectarConsultaHistorial } from '../../services/historial.js';
import { servicioMedicamentos } from '../../services/medicamentos.js';
import { responderHistorial } from './historial.js';
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
 *   3. Alta de medicamento a medias (DK-302).
 *   4. Conversación: síntoma, medición o toma en lenguaje natural.
 *
 * Voz, fotos y archivos se rechazan con una línea: esta versión solo entiende
 * texto (está fuera de alcance procesarlos).
 */
export function registrarMensajes(
  bot,
  servicio = conversacion,
  { medicamentos = servicioMedicamentos } = {}
) {
  bot.on(message('text'), async (ctx) => {
    const texto = ctx.message.text ?? '';

    // Los comandos ya los atienden sus handlers; Telegraf los procesa antes.
    if (texto.startsWith('/')) return;

    const paciente = await registration.obtenerPacienteActivo(ctx.from.id);
    if (!paciente) return recordarConsentimiento(ctx);

    if (registration.tieneRegistroEnCurso(ctx.from.id)) {
      return responder(ctx, await registration.procesarTexto(ctx.from.id, texto));
    }

    // Alta de medicamento a medias: el texto es el nombre, la dosis o la hora.
    if (medicamentos.tieneAltaEnCurso(ctx.from.id)) {
      const respuesta = await ejecutarConversacion('el alta de medicamento', () =>
        medicamentos.procesarTexto({ chatId: ctx.from.id, texto })
      );
      return responderConversacion(ctx, respuesta);
    }

    // "¿Cómo ha estado mi glucosa esta semana?": solo si no hay un reporte a medias.
    if (!hayConversacionPendiente(ctx.from.id)) {
      const consulta = detectarConsultaHistorial(texto);
      if (consulta) return responderHistorial(ctx, consulta);
    }

    const respuesta = await ejecutarConversacion('el mensaje', () =>
      servicio.procesarMensaje({ chatId: ctx.from.id, texto })
    );

    return responderConversacion(ctx, respuesta);
  });

  bot.on(TIPOS_NO_TEXTO, (ctx) => ctx.reply(MENSAJE_SOLO_TEXTO));
}
