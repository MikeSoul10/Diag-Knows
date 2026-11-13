/**
 * Recordatorios de medicamento (DK-302).
 *
 * Cada minuto, `pendientesDeEnviar()` revisa los horarios activos y, para los
 * que ya tocan en la zona horaria de su paciente, crea la dosis PENDIENTE y
 * devuelve el aviso que el canal debe mandar. El índice único
 * (horario_id, programada_en) garantiza un solo recordatorio por toma aunque el
 * cron corra dos veces o el bot se reinicie.
 *
 * El paciente contesta con «Ya la tomé» (TOMADA) o «No la tomé» (SALTADA). Si
 * no contesta en `margenOmitidaMinutos`, `marcarOmitidas()` la deja OMITIDA;
 * todavía puede contestar después y se corrige.
 *
 * No conoce Telegraf: devuelve objetos `{ chatId, texto, botones }` y
 * `{ texto, aviso, editarMensaje }` con el texto en HTML de Telegram.
 */

import {
  patients,
  horarios as horariosRepo,
  dosisLogs as dosisRepo,
} from '../repositories/index.js';
import { localAUtc, partesEnZona, zonaValida } from './fechas.js';

const ZONA_RESPALDO = 'America/Mexico_City';

/** Si el bot estuvo caído unos minutos, todavía manda lo que tocó en este lapso. */
export const VENTANA_ENVIO_MINUTOS = 10;

/** Tras este margen sin respuesta, la dosis queda OMITIDA. */
export const MARGEN_OMITIDA_MINUTOS = 120;

/** `dosis:ok:<uuid>` / `dosis:no:<uuid>` (≤ 64 bytes). */
export const RE_DOSIS =
  /^dosis:(ok|no):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function escapar(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * @param {object} [dependencias]
 * @param {object} [dependencias.repos] `{ patients, horarios, dosisLogs }`
 * @param {() => Date} [dependencias.ahora]
 * @param {string} [dependencias.zonaHorariaPorDefecto]
 */
export function crearServicioRecordatorios({
  repos = { patients, horarios: horariosRepo, dosisLogs: dosisRepo },
  ahora = () => new Date(),
  zonaHorariaPorDefecto = ZONA_RESPALDO,
} = {}) {
  const relojMs = () => new Date(ahora()).getTime();

  function zonaDe(horario) {
    if (zonaValida(horario.zonaHoraria)) return horario.zonaHoraria;
    return zonaValida(zonaHorariaPorDefecto) ? zonaHorariaPorDefecto : ZONA_RESPALDO;
  }

  /**
   * Momento (UTC) de la toma de hoy —o de ayer, cerca de medianoche— que cae
   * dentro de la ventana de envío; null si no toca.
   */
  function momentoQueToca(horario, ahoraMs) {
    const zona = zonaDe(horario);
    const hoy = partesEnZona(new Date(ahoraMs), zona);
    const [hora, minuto] = horario.horaProgramada.split(':').map(Number);

    for (const diasAtras of [0, 1]) {
      const programada = localAUtc(
        { anio: hoy.anio, mes: hoy.mes, dia: hoy.dia - diasAtras, hora, minuto },
        zona
      );
      const diferencia = ahoraMs - programada.getTime();
      if (diferencia >= 0 && diferencia <= VENTANA_ENVIO_MINUTOS * 60 * 1000) return programada;
    }
    return null;
  }

  /**
   * Crea las dosis PENDIENTE que tocan ahora y devuelve los avisos a mandar.
   * Lo que ya se había mandado no se repite.
   *
   * @returns {Promise<Array<{ chatId: string, registroId: string, texto: string, botones: Array<Array<{texto: string, callback: string}>> }>>}
   */
  async function pendientesDeEnviar() {
    const ahoraMs = relojMs();
    const avisos = [];

    for (const horario of await repos.horarios.listarParaRecordatorio()) {
      const programada = momentoQueToca(horario, ahoraMs);
      if (!programada) continue;

      const registro = await repos.dosisLogs.crearPendiente({
        pacienteId: horario.pacienteId,
        horarioId: horario.horarioId,
        medicamentoId: horario.medicamentoId,
        programadaEn: programada.toISOString(),
      });
      if (!registro) continue; // ya se había mandado

      const dosis =
        horario.dosis && horario.dosis !== 'sin dosis' ? ` (${escapar(horario.dosis)})` : '';
      avisos.push({
        chatId: horario.telegramChatId,
        registroId: registro.id,
        texto: `💊 Es hora de tu <b>${escapar(horario.medicamentoNombre)}</b>${dosis} de las ${horario.horaProgramada}.\n¿Ya la tomaste?`,
        botones: [
          [
            { texto: '✅ Ya la tomé', callback: `dosis:ok:${registro.id}` },
            { texto: '❌ No la tomé', callback: `dosis:no:${registro.id}` },
          ],
        ],
      });
    }

    return avisos;
  }

  /** Respuesta del paciente a un recordatorio. */
  async function responder({ chatId, registroId, tomada } = {}) {
    const paciente = await repos.patients.findByTelegramChatId(String(chatId ?? ''));
    if (!paciente) {
      return {
        texto: 'No encontré tu registro. Envía /start.',
        aviso: 'Sin registro',
        editarMensaje: false,
      };
    }

    const actualizado = await repos.dosisLogs.responderPendiente({
      registroId: String(registroId ?? ''),
      pacienteId: paciente.id,
      tomada: tomada === true,
      respondidaEn: new Date(relojMs()).toISOString(),
    });

    if (!actualizado) {
      return {
        texto: 'Ese recordatorio ya estaba contestado.',
        aviso: 'Ya estaba contestado',
        editarMensaje: false,
      };
    }

    return tomada
      ? {
          texto: '✅ Anotado: ya tomaste tu medicamento.',
          aviso: 'Registrado',
          editarMensaje: true,
        }
      : {
          texto:
            'Anotado: esta vez no lo tomaste. Si tienes dudas sobre tu tratamiento, consúltalo con tu médico.',
          aviso: 'Registrado',
          editarMensaje: true,
        };
  }

  /** Deja OMITIDA toda dosis sin respuesta después del margen. Devuelve cuántas. */
  async function marcarOmitidas() {
    return repos.dosisLogs.marcarOmitidas(
      new Date(relojMs() - MARGEN_OMITIDA_MINUTOS * 60 * 1000).toISOString()
    );
  }

  return { pendientesDeEnviar, responder, marcarOmitidas };
}
