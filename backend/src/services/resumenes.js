/**
 * Resumen semanal (DK-302).
 *
 * El cron corre cada hora y este servicio decide, en la zona horaria de cada
 * paciente, si ya es domingo a las 20:00. La ventana que se resume va del
 * lunes 00:00 de la semana en curso al domingo 20:00 (ambos locales), pasada a
 * UTC con `localAUtc`; se evalúa como [desde, hasta).
 *
 * Si no hubo tomas esperadas (0 de 0) no se manda nada. Si el repo devuelve
 * `null` es que esa semana ya se envió: tampoco se repite.
 *
 * El texto es neutro y no diagnostica.
 */

import { resumenes as resumenesRepo } from '../repositories/index.js';
import { localAUtc, partesEnZona, zonaValida } from './fechas.js';

const ZONA_RESPALDO = 'America/Mexico_City';

/** Hora local del envío (domingo). */
export const HORA_RESUMEN = 20;

/** Día de la semana local: 0 = domingo. */
function diaSemanaLocal(partes) {
  return new Date(Date.UTC(partes.anio, partes.mes - 1, partes.dia)).getUTCDay();
}

function fechaIso(anio, mes, dia) {
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.toISOString().slice(0, 10);
}

function formatearPorcentaje(porcentaje) {
  return Number.isInteger(porcentaje) ? String(porcentaje) : porcentaje.toFixed(1);
}

/**
 * Ventana de la semana en curso para las partes locales dadas.
 *
 * @param {{ anio: number, mes: number, dia: number }} partes
 * @param {string} zona
 * @returns {{ semanaInicio: string, desde: Date, hasta: Date }}
 */
export function ventanaSemana(partes, zona) {
  const desdeLunes = (diaSemanaLocal(partes) + 6) % 7;
  const lunes = { anio: partes.anio, mes: partes.mes, dia: partes.dia - desdeLunes };

  return {
    semanaInicio: fechaIso(lunes.anio, lunes.mes, lunes.dia),
    desde: localAUtc({ ...lunes, hora: 0, minuto: 0 }, zona),
    hasta: localAUtc({ ...lunes, dia: lunes.dia + 6, hora: HORA_RESUMEN, minuto: 0 }, zona),
  };
}

export function textoResumen({ tomadas, esperadas, porcentaje }) {
  return (
    `Resumen de tu semana: registraste ${tomadas} de ${esperadas} tomas ` +
    `(${formatearPorcentaje(porcentaje)}%). Si tienes dudas, consúltalo con tu ` +
    'profesional de la salud.'
  );
}

/**
 * @param {object} [dependencias]
 * @param {{ listarCandidatos: Function, calcularAdherencia: Function, crear: Function }} [dependencias.repos]
 * @param {() => Date} [dependencias.ahora]
 * @param {string} [dependencias.zonaHorariaPorDefecto]
 * @param {(contexto: string, error: Error) => void} [dependencias.registrarError]
 */
export function crearServicioResumenes({
  repos = { resumenes: resumenesRepo },
  ahora = () => new Date(),
  zonaHorariaPorDefecto = ZONA_RESPALDO,
  registrarError = (contexto, error) => {
    console.error(`[resumenes] Falló ${contexto}: ${error?.name ?? 'Error'}`);
  },
} = {}) {
  function zonaDe(paciente) {
    if (zonaValida(paciente.zonaHoraria)) return paciente.zonaHoraria;
    return zonaValida(zonaHorariaPorDefecto) ? zonaHorariaPorDefecto : ZONA_RESPALDO;
  }

  /**
   * Resúmenes que toca enviar en esta vuelta.
   *
   * @returns {Promise<Array<{ chatId: string, texto: string, semanaInicio: string }>>}
   */
  async function resumenesQueTocan() {
    const ahoraMs = new Date(ahora()).getTime();
    const pendientes = [];

    for (const paciente of await repos.resumenes.listarCandidatos()) {
      try {
        const zona = zonaDe(paciente);
        const partes = partesEnZona(new Date(ahoraMs), zona);
        if (diaSemanaLocal(partes) !== 0 || partes.hora !== HORA_RESUMEN) continue;

        const { semanaInicio, desde, hasta } = ventanaSemana(partes, zona);
        const { porcentaje, tomadas, esperadas } = await repos.resumenes.calcularAdherencia({
          pacienteId: paciente.id,
          desde,
          hasta,
        });
        if (esperadas === 0) continue;

        const texto = textoResumen({ tomadas, esperadas, porcentaje });
        const creado = await repos.resumenes.crear({
          pacienteId: paciente.id,
          semanaInicio,
          porcentajeAdherencia: porcentaje,
          texto,
        });
        if (!creado) continue; // ya se envió esa semana

        pendientes.push({ chatId: paciente.telegramChatId, texto, semanaInicio });
      } catch (error) {
        // Un paciente con problemas no impide el resumen de los demás.
        registrarError('el resumen semanal de un paciente', error);
      }
    }

    return pendientes;
  }

  return { resumenesQueTocan };
}
