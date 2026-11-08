/**
 * /borrar_datos (DK-303): el paciente pide que se borre todo lo suyo.
 *
 * Dos pasos para que no se borre por accidente:
 *   1. solicitar({ chatId })          -> pregunta con botones y un token de un solo uso
 *   2. confirmar({ chatId, token })   -> borra; cancelar({ chatId, token }) -> no borra nada
 *
 * Qué se borra: la fila del paciente y, por cascada, consentimientos,
 * medicamentos, tomas, mediciones, síntomas, enfermedades, alertas y resúmenes.
 * También se descartan el registro y el reporte que estuvieran a medias.
 * Decisión vigente (D11): se borra TAMBIÉN la bitácora de consentimiento; el
 * paciente que vuelva a escribir /start empieza desde cero.
 *
 * No conoce Telegraf: devuelve `{ texto, botones?, aviso?, error? }` en HTML de
 * Telegram, igual que `services/tome.js`. Nunca registra datos del paciente.
 */

import { randomBytes } from 'node:crypto';

export const TTL_CONFIRMACION_MS = 5 * 60 * 1000;

export const TEXTO_PREGUNTA = [
  '<b>¿Borrar todos tus datos?</b>',
  '',
  'Voy a borrar de forma permanente tu registro, tus mediciones, síntomas, medicamentos y tomas, y tu consentimiento. No se puede deshacer.',
  '',
  'Tus mensajes en este chat de Telegram no los puedo borrar yo; eso lo haces tú desde la app.',
].join('\n');

export const TEXTO_SIN_DATOS =
  'No tengo datos tuyos guardados. Si quieres empezar, escribe /start.';

export const TEXTO_CANCELADO = 'Listo, no borré nada. Tus datos siguen como estaban.';

export const TEXTO_BORRADO = [
  'Listo, borré todos tus datos.',
  '',
  'Si quieres volver a usar el asistente, escribe /start y empezamos de nuevo.',
].join('\n');

export const TEXTO_ERROR =
  'No pude borrar tus datos en este momento y no se borró nada. Intenta de nuevo en un momento.';

const AVISO_CADUCADO = 'Ya no está vigente';

/**
 * @param {object} deps
 * @param {(chatId: string|number) => Promise<{id: string}|null>} deps.obtenerPaciente
 * @param {(pacienteId: string) => Promise<boolean>} deps.eliminarPaciente
 * @param {(chatId: string|number) => Promise<void>|void} [deps.limpiarEstado]
 *   Descarta lo que el chat tuviera a medias (registro, borrador de reporte).
 * @param {() => Date} [deps.ahora]
 * @param {() => string} [deps.generarToken]
 * @param {(contexto: string, error: Error) => void} [deps.registrarError]
 */
export function crearServicioBorrado({
  obtenerPaciente,
  eliminarPaciente,
  limpiarEstado = async () => {},
  ahora = () => new Date(),
  generarToken = () => randomBytes(16).toString('hex'),
  registrarError = (contexto, error) => {
    console.error(`[borrado] Falló ${contexto}: ${error?.name ?? 'Error'}`);
  },
} = {}) {
  if (typeof obtenerPaciente !== 'function') throw new Error('Falta obtenerPaciente');
  if (typeof eliminarPaciente !== 'function') throw new Error('Falta eliminarPaciente');

  /** chatId -> { token, venceEn } */
  const pendientes = new Map();
  const clave = (chatId) => String(chatId ?? '');
  const vigente = (pendiente, token) =>
    Boolean(pendiente) &&
    pendiente.token === token &&
    new Date(ahora()).getTime() <= pendiente.venceEn;

  return {
    async solicitar({ chatId }) {
      const paciente = await obtenerPaciente(chatId);
      if (!paciente) {
        pendientes.delete(clave(chatId));
        return { texto: TEXTO_SIN_DATOS };
      }

      const token = generarToken();
      pendientes.set(clave(chatId), {
        token,
        venceEn: new Date(ahora()).getTime() + TTL_CONFIRMACION_MS,
      });

      return {
        texto: TEXTO_PREGUNTA,
        botones: [
          [{ texto: 'Sí, borrar todo', callback: `del:ok:${token}` }],
          [{ texto: 'No, conservar mis datos', callback: `del:no:${token}` }],
        ],
      };
    },

    async confirmar({ chatId, token }) {
      const pendiente = pendientes.get(clave(chatId));
      // Se consume antes de borrar: un segundo clic nunca borra dos veces.
      if (!vigente(pendiente, token)) {
        pendientes.delete(clave(chatId));
        return {
          texto:
            'Esa confirmación ya no está vigente. Escribe /borrar_datos para empezar de nuevo.',
          aviso: AVISO_CADUCADO,
        };
      }
      pendientes.delete(clave(chatId));

      try {
        const paciente = await obtenerPaciente(chatId);
        if (!paciente) return { texto: TEXTO_SIN_DATOS };

        await eliminarPaciente(paciente.id);
        await limpiarEstado(chatId);
        return { texto: TEXTO_BORRADO, aviso: 'Datos borrados' };
      } catch (error) {
        registrarError('el borrado de datos', error);
        return { texto: TEXTO_ERROR, error: true };
      }
    },

    async cancelar({ chatId, token }) {
      const pendiente = pendientes.get(clave(chatId));
      if (!vigente(pendiente, token)) {
        pendientes.delete(clave(chatId));
        return {
          texto: 'Esa confirmación ya no está vigente. No borré nada.',
          aviso: AVISO_CADUCADO,
        };
      }
      pendientes.delete(clave(chatId));
      return { texto: TEXTO_CANCELADO };
    },

    /** Solo para pruebas. */
    __reset() {
      pendientes.clear();
    },
  };
}
