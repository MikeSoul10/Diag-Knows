/**
 * Repositorio PostgreSQL de `registros_dosis` (DK-103, DK-204).
 *
 * Misma interfaz y DTO que `mocks/dosisLogs.mock.js`:
 *   { id, pacienteId, medicamentoId, nombreReportado, estado, tomadaEn, mensajeId }
 *
 * Requiere la migración 004: una toma reportada en el chat no tiene horario
 * (`horario_id` NULL) y se liga directo al paciente. Para esas tomas,
 * `programada_en` = momento de la toma. Si el paciente dice que NO la tomó
 * (SALTADA), `tomada_en` queda NULL en la BD y el DTO expone el momento del
 * reporte, igual que el mock.
 */

import { query } from '../db/pool.js';
import { aIsoUtc } from './cifrado.js';

function validarPacienteId(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  return String(pacienteId);
}

function comoDTO(fila) {
  return {
    id: fila.id,
    pacienteId: fila.paciente_id,
    medicamentoId: fila.medicamento_id,
    nombreReportado: fila.nombre_reportado,
    estado: fila.estado,
    tomadaEn: fila.tomada_en ?? fila.programada_en,
    mensajeId: fila.mensaje_id ?? null,
  };
}

const COLUMNAS =
  'id, paciente_id, medicamento_id, nombre_reportado, estado, tomada_en, programada_en, mensaje_id';

export async function guardarTomaMedicamento({
  pacienteId,
  medicamentoId = null,
  nombreReportado = null,
  tomada,
  tomadaEn,
  mensajeId = null,
} = {}) {
  const idPaciente = validarPacienteId(pacienteId);
  if (typeof tomada !== 'boolean') throw new Error('tomada debe ser booleano');

  const nombre = typeof nombreReportado === 'string' ? nombreReportado.trim() : '';
  const momento = aIsoUtc(tomadaEn) ?? new Date().toISOString();

  const { rows } = await query(
    `INSERT INTO registros_dosis
       (paciente_id, medicamento_id, nombre_reportado, horario_id, programada_en, tomada_en,
        estado, mensaje_id)
     VALUES ($1, $2, $3, NULL, $4::timestamp, CASE WHEN $5 THEN $4::timestamp END, $6, $7)
     RETURNING ${COLUMNAS}`,
    [
      idPaciente,
      medicamentoId ? String(medicamentoId) : null,
      nombre ? nombre.slice(0, 150) : null,
      momento,
      tomada,
      tomada ? 'TOMADA' : 'SALTADA',
      mensajeId ? String(mensajeId) : null,
    ]
  );
  return comoDTO(rows[0]);
}

export async function listarPorPaciente(pacienteId) {
  const { rows } = await query(
    `SELECT ${COLUMNAS} FROM registros_dosis
      WHERE paciente_id = $1
      ORDER BY programada_en, id`,
    [validarPacienteId(pacienteId)]
  );
  return rows.map(comoDTO);
}

/** Tomas con `programada_en` en [desde, hasta), para el historial (DK-301). */
export async function listarPorRango(pacienteId, desde, hasta) {
  const { rows } = await query(
    `SELECT ${COLUMNAS} FROM registros_dosis
      WHERE paciente_id = $1 AND programada_en >= $2::timestamp AND programada_en < $3::timestamp
      ORDER BY programada_en, id`,
    [validarPacienteId(pacienteId), aIsoUtc(desde), aIsoUtc(hasta)]
  );
  return rows.map(comoDTO);
}

// ---------------------------------------------------------------------------
// Recordatorios (DK-302)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Crea la dosis PENDIENTE de un recordatorio. Devuelve null si ya existía una
 * para ese horario y momento (índice único parcial de la migración 004): así
 * dos vueltas del cron nunca mandan dos veces el mismo recordatorio.
 */
export async function crearPendiente({ pacienteId, horarioId, medicamentoId, programadaEn } = {}) {
  if (!horarioId) throw new Error('horarioId es obligatorio');
  const momento = aIsoUtc(programadaEn);
  if (!momento) throw new Error('programadaEn es obligatorio');

  const { rows } = await query(
    `INSERT INTO registros_dosis (paciente_id, horario_id, medicamento_id, programada_en, estado)
     VALUES ($1, $2, $3, $4::timestamp, 'PENDIENTE')
     ON CONFLICT (horario_id, programada_en) WHERE horario_id IS NOT NULL DO NOTHING
     RETURNING ${COLUMNAS}`,
    [
      validarPacienteId(pacienteId),
      String(horarioId),
      medicamentoId ? String(medicamentoId) : null,
      momento,
    ]
  );
  return rows[0] ? comoDTO(rows[0]) : null;
}

/**
 * Respuesta del paciente al recordatorio. Acepta una dosis PENDIENTE u
 * OMITIDA (contestó tarde) que sea suya; si no, devuelve null.
 */
export async function responderPendiente({ registroId, pacienteId, tomada, respondidaEn } = {}) {
  if (typeof registroId !== 'string' || !UUID_RE.test(registroId)) return null;
  if (typeof tomada !== 'boolean') throw new Error('tomada debe ser booleano');

  const { rows } = await query(
    `UPDATE registros_dosis
        SET estado = CASE WHEN $3 THEN 'TOMADA' ELSE 'SALTADA' END,
            tomada_en = CASE WHEN $3 THEN $4::timestamp END
      WHERE id = $1 AND paciente_id = $2 AND estado IN ('PENDIENTE', 'OMITIDA')
      RETURNING ${COLUMNAS}`,
    [
      registroId,
      validarPacienteId(pacienteId),
      tomada,
      aIsoUtc(respondidaEn) ?? new Date().toISOString(),
    ]
  );
  return rows[0] ? comoDTO(rows[0]) : null;
}

/** Marca OMITIDA toda dosis PENDIENTE programada antes de `limite`. Devuelve cuántas. */
export async function marcarOmitidas(limite) {
  const { rowCount } = await query(
    `UPDATE registros_dosis SET estado = 'OMITIDA'
      WHERE estado = 'PENDIENTE' AND programada_en < $1::timestamp`,
    [aIsoUtc(limite)]
  );
  return rowCount;
}

export function __reset() {}
