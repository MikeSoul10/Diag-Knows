/**
 * Repositorio PostgreSQL de `registros_dosis` (DK-103, DK-204).
 *
 * Misma interfaz y DTO que `mocks/dosisLogs.mock.js`:
 *   { id, pacienteId, medicamentoId, nombreReportado, estado, tomadaEn }
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
  };
}

const COLUMNAS =
  'id, paciente_id, medicamento_id, nombre_reportado, estado, tomada_en, programada_en';

export async function guardarTomaMedicamento({
  pacienteId,
  medicamentoId = null,
  nombreReportado = null,
  tomada,
  tomadaEn,
} = {}) {
  const idPaciente = validarPacienteId(pacienteId);
  if (typeof tomada !== 'boolean') throw new Error('tomada debe ser booleano');

  const nombre = typeof nombreReportado === 'string' ? nombreReportado.trim() : '';
  const momento = aIsoUtc(tomadaEn) ?? new Date().toISOString();

  const { rows } = await query(
    `INSERT INTO registros_dosis
       (paciente_id, medicamento_id, nombre_reportado, horario_id, programada_en, tomada_en, estado)
     VALUES ($1, $2, $3, NULL, $4::timestamp, CASE WHEN $5 THEN $4::timestamp END, $6)
     RETURNING ${COLUMNAS}`,
    [
      idPaciente,
      medicamentoId ? String(medicamentoId) : null,
      nombre ? nombre.slice(0, 150) : null,
      momento,
      tomada,
      tomada ? 'TOMADA' : 'SALTADA',
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

export function __reset() {}
