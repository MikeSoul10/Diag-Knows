import { iniciarTome, registrarTome } from '../../services/tome.js';
import { BOTONES_MENU } from '../format.js';
import { alComandoYBoton } from './menu.js';
import {
  atenderCallback,
  ejecutarConversacion,
  recordarConsentimiento,
  responderConversacion,
} from './render.js';

/** `tome:<uuid del medicamento>` o `tome:ninguno` (≤ 64 bytes). */
export const RE_TOME = /^tome:(ninguno|[0-9a-fA-F-]{36})$/;

/** Comando /tome, el botón «Ya me la tomé» del menú y sus botones en línea. */
export function registrarComandoTome(bot) {
  alComandoYBoton(bot, 'tome', BOTONES_MENU.tome, async (ctx) => {
    const respuesta = await ejecutarConversacion('el comando /tome', () =>
      iniciarTome({ chatId: ctx.from.id })
    );

    if (respuesta?.sinConsentimiento) return recordarConsentimiento(ctx);
    return responderConversacion(ctx, respuesta);
  });

  bot.action(RE_TOME, (ctx) =>
    atenderCallback(ctx, async () => {
      const [, medicamentoId] = ctx.match ?? RE_TOME.exec(ctx.callbackQuery?.data) ?? [];
      return registrarTome({ chatId: ctx.from.id, medicamentoId });
    })
  );
}
