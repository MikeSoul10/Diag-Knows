/**
 * Tareas programadas (DK-302) con node-cron.
 *
 *   - Cada minuto: manda los recordatorios de medicamento que tocan.
 *   - Cada 15 minutos: marca OMITIDA lo que nadie contestó a tiempo.
 *   - Cada hora: intenta el resumen semanal; el servicio decide por zona.
 *
 * Las horas de cada paciente se calculan en su propia zona horaria dentro del
 * servicio, así que el cron no necesita `timezone`.
 *
 * No conoce Telegraf: el canal le pasa `enviar(aviso)` y `enviarResumen(aviso)`.
 * Un fallo (red, paciente que bloqueó el bot) nunca tumba el proceso ni frena a
 * los demás avisos; en los logs solo va el nombre del error.
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
 * Una vuelta del resumen semanal. Exportada para probarla sin esperar al cron.
 * El servicio ya filtró a quién le toca en su zona horaria.
 *
 * @returns {Promise<number>} cuántos resúmenes se mandaron.
 */
export async function enviarResumenesSemanales({
  servicio,
  enviar,
  registrarError = registrarErrorPorDefecto,
}) {
  let pendientes;
  try {
    pendientes = await servicio.resumenesQueTocan();
  } catch (error) {
    registrarError('la búsqueda de resúmenes semanales', error);
    return 0;
  }

  let enviados = 0;
  for (const aviso of pendientes) {
    try {
      await enviar(aviso);
      enviados += 1;
    } catch (error) {
      registrarError('el envío de un resumen semanal', error);
    }
  }
  return enviados;
}

/**
 * Arranca las tareas.
 *
 * @param {object} opciones
 * @param {{ pendientesDeEnviar: Function, marcarOmitidas: Function }} opciones.servicio
 * @param {(aviso: object) => Promise<unknown>} opciones.enviar
 * @param {{ resumenesQueTocan: Function }} [opciones.resumenes]
 * @param {(aviso: object) => Promise<unknown>} [opciones.enviarResumen]
 * @returns {() => void} detiene las tareas (al apagar el bot).
 */
export function iniciarScheduler({
  servicio,
  enviar,
  resumenes,
  enviarResumen,
  registrarError = registrarErrorPorDefecto,
}) {
  // Evita vueltas encimadas si una tarda más de lo que dura su intervalo.
  let enviando = false;
  let enviandoResumenes = false;

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

  const tareas = [tareaEnvio, tareaOmitidas];

  if (resumenes && typeof enviarResumen === 'function') {
    tareas.push(
      schedule('0 * * * *', async () => {
        if (enviandoResumenes) return;
        enviandoResumenes = true;
        try {
          await enviarResumenesSemanales({
            servicio: resumenes,
            enviar: enviarResumen,
            registrarError,
          });
        } finally {
          enviandoResumenes = false;
        }
      })
    );
  }

  return () => {
    for (const tarea of tareas) tarea.stop();
  };
}
