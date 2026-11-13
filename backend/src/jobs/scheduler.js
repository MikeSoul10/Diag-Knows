/**
 * Tareas programadas (DK-302) con node-cron.
 *
 *   - Cada minuto: manda los recordatorios de medicamento que tocan.
 *   - Cada 15 minutos: marca OMITIDA lo que nadie contestó a tiempo.
 *
 * Las horas de cada paciente se calculan en su propia zona horaria dentro del
 * servicio, así que el cron no necesita `timezone`.
 *
 * No conoce Telegraf: el canal le pasa `enviar(aviso)`. Un fallo (red, paciente
 * que bloqueó el bot) nunca tumba el proceso ni frena a los demás avisos; en
 * los logs solo va el nombre del error.
 */

import { schedule } from 'node-cron';

function registrarErrorPorDefecto(contexto, error) {
  console.error(`[scheduler] Falló ${contexto}: ${error?.name ?? 'Error'}`);
}

/**
 * Una vuelta del envío. Exportada para probarla sin esperar al cron.
 *
 * @returns {Promise<number>} cuántos avisos se mandaron.
 */
export async function enviarRecordatorios({
  servicio,
  enviar,
  registrarError = registrarErrorPorDefecto,
}) {
  let avisos;
  try {
    avisos = await servicio.pendientesDeEnviar();
  } catch (error) {
    registrarError('la búsqueda de recordatorios', error);
    return 0;
  }

  let enviados = 0;
  for (const aviso of avisos) {
    try {
      await enviar(aviso);
      enviados += 1;
    } catch (error) {
      // La dosis queda PENDIENTE y, si nadie contesta, pasará a OMITIDA.
      registrarError('el envío de un recordatorio', error);
    }
  }
  return enviados;
}

export async function marcarOmitidas({ servicio, registrarError = registrarErrorPorDefecto }) {
  try {
    return await servicio.marcarOmitidas();
  } catch (error) {
    registrarError('marcar dosis omitidas', error);
    return 0;
  }
}

/**
 * Arranca las tareas.
 *
 * @param {object} opciones
 * @param {{ pendientesDeEnviar: Function, marcarOmitidas: Function }} opciones.servicio
 * @param {(aviso: object) => Promise<unknown>} opciones.enviar
 * @returns {() => void} detiene las tareas (al apagar el bot).
 */
export function iniciarScheduler({ servicio, enviar, registrarError = registrarErrorPorDefecto }) {
  // Evita vueltas encimadas si una tarda más de un minuto.
  let enviando = false;

  const tareaEnvio = schedule('* * * * *', async () => {
    if (enviando) return;
    enviando = true;
    try {
      await enviarRecordatorios({ servicio, enviar, registrarError });
    } finally {
      enviando = false;
    }
  });

  const tareaOmitidas = schedule('*/15 * * * *', () =>
    marcarOmitidas({ servicio, registrarError })
  );

  return () => {
    tareaEnvio.stop();
    tareaOmitidas.stop();
  };
}
