import * as registration from '../../services/registration.service.js';
import { AVISO_PRIVACIDAD, EXTRA_HTML, tecladoConsentimiento } from '../format.js';
import { responder } from './render.js';

/**
 * /start — primer contacto y control del consentimiento.
 * Sin consentimiento vigente el bot no guarda ni procesa nada más.
 */
export function registrarStart(bot) {
  bot.start(async (ctx) => {
    const { requiereConsentimiento } = await registration.iniciar(ctx.from.id);

    if (requiereConsentimiento) {
      return ctx.reply(AVISO_PRIVACIDAD, {
        ...EXTRA_HTML,
        ...tecladoConsentimiento(),
      });
    }

    return responder(ctx, await registration.iniciarRegistro(ctx.from.id));
  });
}
