import * as registration from '../../services/registration.service.js';
import { AYUDA, EXTRA_HTML, escaparHtml, tecladoRegistrar } from '../format.js';
import { conversacion, hayConversacionPendiente } from '../conversacion.instancia.js';
import {
  ejecutarConversacion,
  recordarConsentimiento,
  responder,
  responderConversacion,
} from './render.js';

/** Comandos: /registrar, /reportar, /perfil, /cancelar, /ayuda. */
export function registrarMenu(bot, servicio = conversacion) {
  bot.command('registrar', async (ctx) => {
    return responder(ctx, await registration.iniciarRegistro(ctx.from.id));
  });

  bot.command('reportar', async (ctx) => {
    const respuesta = await ejecutarConversacion('el comando /reportar', () =>
      servicio.iniciar({ chatId: ctx.from.id })
    );

    return responderConversacion(ctx, respuesta);
  });

  bot.command('perfil', async (ctx) => {
    const perfil = await registration.obtenerPerfil(ctx.from.id);
    if (!perfil) return recordarConsentimiento(ctx);

    if (!perfil.paciente.consentimientoVigente) return recordarConsentimiento(ctx);

    const { paciente, enfermedades } = perfil;
    if (!paciente.alias || !paciente.anioNacimiento) {
      return ctx.reply('Todavía no tengo tu registro completo.', tecladoRegistrar());
    }

    const edad = registration.anioActual() - paciente.anioNacimiento;
    const lista =
      enfermedades.length > 0
        ? enfermedades.map((enfermedad) => escaparHtml(enfermedad.nombre)).join(', ')
        : 'sin registrar';

    return ctx.reply(
      [
        '<b>Tus datos</b>',
        '',
        `Apodo: ${escaparHtml(paciente.alias)}`,
        `Edad aproximada: ${edad} años`,
        `Enfermedad: ${lista}`,
        '',
        'Si algo está mal, escribe /registrar.',
      ].join('\n'),
      EXTRA_HTML
    );
  });

  bot.command('cancelar', async (ctx) => {
    // Se descartan las dos cosas: el alta a medias y lo que estuviera reportando.
    const registroEnCurso = await registration.cancelarRegistro(ctx.from.id);
    const reportePendiente = hayConversacionPendiente(ctx.from.id);

    const respuesta = await ejecutarConversacion('el comando /cancelar', () =>
      servicio.cancelar({ chatId: ctx.from.id })
    );
    if (respuesta?.error) return ctx.reply(respuesta.texto);

    const habia = registroEnCurso || reportePendiente;

    return ctx.reply(
      habia
        ? 'Listo, descarté lo que teníamos a medias y no guardé nada.'
        : 'No había nada pendiente que descartar. Cuando quieras, escribe /reportar.'
    );
  });

  bot.command('ayuda', async (ctx) => ctx.reply(AYUDA, EXTRA_HTML));
}
