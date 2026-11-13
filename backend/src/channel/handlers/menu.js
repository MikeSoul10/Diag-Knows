import * as registration from '../../services/registration.service.js';
import {
  AYUDA,
  BOTONES_MENU,
  EXTRA_HTML,
  escaparHtml,
  tecladoMenu,
  tecladoRegistrar,
} from '../format.js';
import { conversacion, hayConversacionPendiente } from '../conversacion.instancia.js';
import {
  ejecutarConversacion,
  recordarConsentimiento,
  responder,
  responderConversacion,
} from './render.js';

/**
 * Registra un handler para el comando y, si se indica, para el botón del menú
 * principal que hace lo mismo (Telegram manda el texto del botón como mensaje).
 */
export function alComandoYBoton(bot, comando, boton, handler) {
  bot.command(comando, handler);
  if (boton) bot.hears(boton, handler);
}

/** Comandos y botones del menú: registrar, reportar, perfil, cancelar, ayuda. */
export function registrarMenu(bot, servicio = conversacion) {
  bot.command('registrar', async (ctx) => {
    return responder(ctx, await registration.iniciarRegistro(ctx.from.id));
  });

  alComandoYBoton(bot, 'reportar', BOTONES_MENU.reportar, async (ctx) => {
    const respuesta = await ejecutarConversacion('el comando /reportar', () =>
      servicio.iniciar({ chatId: ctx.from.id })
    );

    return responderConversacion(ctx, respuesta);
  });

  alComandoYBoton(bot, 'perfil', BOTONES_MENU.perfil, async (ctx) => {
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
      { ...EXTRA_HTML, ...tecladoMenu() }
    );
  });

  alComandoYBoton(bot, 'cancelar', BOTONES_MENU.cancelar, async (ctx) => {
    // Se descartan las dos cosas: el alta a medias y lo que estuviera reportando.
    const registroEnCurso = await registration.cancelarRegistro(ctx.from.id);
    const reportePendiente = hayConversacionPendiente(ctx.from.id);

    const respuesta = await ejecutarConversacion('el comando /cancelar', () =>
      servicio.cancelar({ chatId: ctx.from.id })
    );
    if (respuesta?.error) return ctx.reply(respuesta.texto);

    const habia = registroEnCurso || reportePendiente;

    // Vuelve el menú principal (por si la barra mostraba los síntomas de /reportar).
    return ctx.reply(
      habia
        ? 'Listo, descarté lo que teníamos a medias y no guardé nada.'
        : `No había nada pendiente que descartar. Cuando quieras, toca ${BOTONES_MENU.reportar}.`,
      tecladoMenu()
    );
  });

  alComandoYBoton(bot, 'ayuda', BOTONES_MENU.ayuda, async (ctx) =>
    ctx.reply(AYUDA, { ...EXTRA_HTML, ...tecladoMenu() })
  );
}
