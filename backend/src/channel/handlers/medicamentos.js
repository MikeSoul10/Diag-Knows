import { servicioMedicamentos } from '../../services/medicamentos.js';
import { crearServicioRecordatorios, RE_DOSIS } from '../../services/recordatorios.js';
import { zonaHorariaPorDefecto } from '../../config/env.js';
import { BOTONES_MENU, EXTRA_HTML, tecladoConversacion } from '../format.js';
import { alComandoYBoton } from './menu.js';
import {
  atenderCallback,
  ejecutarConversacion,
  recordarConsentimiento,
  responderConversacion,
} from './render.js';

/** Instancia que usan el bot (botones) y el scheduler (envíos). */
export const servicioRecordatorios = crearServicioRecordatorios({
  zonaHorariaPorDefecto: zonaHorariaPorDefecto(),
});

/**
 * Manda un aviso del scheduler por Telegram. Es la única pieza del envío que
 * conoce Telegraf.
 */
export function crearEnviadorRecordatorios(bot) {
  return (aviso) =>
    bot.telegram.sendMessage(aviso.chatId, aviso.texto, {
      ...EXTRA_HTML,
      ...(tecladoConversacion(aviso.botones) ?? {}),
    });
}

/**
 * «Mis medicamentos» (/medicamentos y el botón del menú), el alta guiada
 * (med:nuevo, med:ok, med:no) y las respuestas a los recordatorios (dosis:ok|no).
 */
export function registrarMedicamentos(
  bot,
  { medicamentos = servicioMedicamentos, recordatorios = servicioRecordatorios } = {}
) {
  alComandoYBoton(bot, 'medicamentos', BOTONES_MENU.medicamentos, async (ctx) => {
    const respuesta = await ejecutarConversacion('el comando /medicamentos', () =>
      medicamentos.listar({ chatId: ctx.from.id })
    );
    if (respuesta?.sinConsentimiento) return recordarConsentimiento(ctx);
    return responderConversacion(ctx, respuesta);
  });

  bot.action('med:nuevo', (ctx) =>
    atenderCallback(ctx, async () => {
      const respuesta = await medicamentos.iniciarAlta({ chatId: ctx.from.id });
      if (respuesta?.sinConsentimiento) {
        await recordarConsentimiento(ctx);
        return { texto: '', aviso: 'Primero acepta el aviso de privacidad' };
      }
      return respuesta;
    })
  );

  bot.action('med:ok', (ctx) =>
    atenderCallback(ctx, () => medicamentos.confirmar({ chatId: ctx.from.id }))
  );
  bot.action('med:no', (ctx) =>
    atenderCallback(ctx, () => medicamentos.corregir({ chatId: ctx.from.id }))
  );

  bot.action(RE_DOSIS, (ctx) =>
    atenderCallback(ctx, async () => {
      const [, accion, registroId] = ctx.match ?? RE_DOSIS.exec(ctx.callbackQuery?.data) ?? [];
      return recordatorios.responder({ chatId: ctx.from.id, registroId, tomada: accion === 'ok' });
    })
  );
}
