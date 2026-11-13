import { crearServicioBorrado } from '../../services/borrado.js';
import { patients, eliminarPaciente } from '../../repositories/index.js';
import * as registration from '../../services/registration.service.js';
import { servicioMedicamentos } from '../../services/medicamentos.js';
import { conversacion } from '../conversacion.instancia.js';
import { atenderCallback, ejecutarConversacion, responderConversacion } from './render.js';

/** `del:ok:<token>` o `del:no:<token>` (token de 32 hex; ≤ 64 bytes en total). */
export const RE_BORRADO = /^del:(ok|no):([0-9a-f]{32})$/;

export const servicioBorrado = crearServicioBorrado({
  obtenerPaciente: (chatId) => patients.findByTelegramChatId(chatId),
  eliminarPaciente,
  // Además del paciente, se descarta lo que estuviera a medias: alta, medicamento y reporte.
  limpiarEstado: async (chatId) => {
    await registration.cancelarRegistro(chatId);
    servicioMedicamentos.cancelar({ chatId });
    await conversacion.cancelar({ chatId });
  },
});

/** Comando /borrar_datos y sus botones. */
export function registrarComandoBorrado(bot, servicio = servicioBorrado) {
  bot.command('borrar_datos', async (ctx) => {
    const respuesta = await ejecutarConversacion('el comando /borrar_datos', () =>
      servicio.solicitar({ chatId: ctx.from.id })
    );
    return responderConversacion(ctx, respuesta);
  });

  bot.action(RE_BORRADO, (ctx) =>
    atenderCallback(ctx, async () => {
      const [, accion, token] = ctx.match ?? RE_BORRADO.exec(ctx.callbackQuery?.data) ?? [];
      const chatId = ctx.from.id;
      return accion === 'ok'
        ? servicio.confirmar({ chatId, token })
        : servicio.cancelar({ chatId, token });
    })
  );
}
