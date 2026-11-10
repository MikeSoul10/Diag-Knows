/**
 * Retención del mensaje original de los reportes (trazabilidad, migración 006).
 *
 * Cada mensaje guardado caduca a los MENSAJES_RETENCION_DIAS (90 por defecto).
 * Este servicio borra los vencidos al arrancar y luego una vez al día. Los
 * registros clínicos se conservan; solo pierden el enlace al mensaje.
 *
 * Cuando exista `jobs/scheduler.js` con node-cron (DK-302), esta tarea puede
 * moverse ahí sin cambiar la función `depurarMensajesVencidos`.
 */

import { mensajes as mensajesRepo } from '../repositories/index.js';

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * @returns {Promise<number>} cuántos mensajes se borraron (0 si falló).
 */
export async function depurarMensajesVencidos({
  mensajes = mensajesRepo,
  ahora = new Date(),
  registrarError = (error) =>
    console.error(`[retencion] Falló la depuración: ${error?.name ?? 'Error'}`),
} = {}) {
  try {
    return await mensajes.eliminarVencidos(ahora);
  } catch (error) {
    // Nunca tumba el bot: se reintenta en la siguiente vuelta.
    registrarError(error);
    return 0;
  }
}

/**
 * Corre la depuración ahora y cada `intervaloMs`. El temporizador no mantiene
 * vivo el proceso (unref).
 *
 * @returns {() => void} función para detenerla.
 */
export function iniciarDepuracionPeriodica({ intervaloMs = UN_DIA_MS, ...opciones } = {}) {
  const correr = () => depurarMensajesVencidos({ ...opciones, ahora: new Date() });
  correr();
  const temporizador = setInterval(correr, intervaloMs);
  temporizador.unref?.();
  return () => clearInterval(temporizador);
}
