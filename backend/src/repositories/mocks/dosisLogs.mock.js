/**
 * Mock en memoria de `registros_dosis`.
 *
 * Misma interfaz que tendrá `src/repositories/dosisLogs.repo.js`:
 *   guardarTomaMedicamento({ pacienteId, medicamentoId, nombreReportado, tomada, tomadaEn }) -> registro
 *   listarPorPaciente(pacienteId) -> registros
 *   __reset()
 *
 * Contrato del DTO (idéntico al que debe devolver el repo real):
 *   { id, pacienteId, medicamentoId, nombreReportado, estado, tomadaEn }
 *
 * `estado` usa el vocabulario de la columna `estado`: 'TOMADA' cuando el
 * paciente confirma la toma y 'SALTADA' cuando dice que no la tomó.
 *
 * OJO para el repo real (migración 004 pendiente): `registros_dosis.horario_id`
 * es NOT NULL y apunta a `horarios_medicamento`. Mientras no exista la
 * migración no se puede insertar una toma suelta desde el chat. Aquí el mock no
 * tiene esa restricción para poder demostrar DK-204.
 */

import { randomUUID } from 'node:crypto';

/** @type {Map<string, Array<object>>} pacienteId -> filas en orden de registro */
const porPaciente = new Map();

function validarPacienteId(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  return String(pacienteId);
}

function comoDTO(fila) {
  return {
    id: fila.id,
    pacienteId: fila.pacienteId,
    medicamentoId: fila.medicamentoId,
    nombreReportado: fila.nombreReportado,
    estado: fila.estado,
    tomadaEn: fila.tomadaEn,
  };
}

export async function guardarTomaMedicamento({
  pacienteId,
  medicamentoId = null,
  nombreReportado = null,
  tomada,
  tomadaEn,
} = {}) {
  const idPaciente = validarPacienteId(pacienteId);

  if (typeof tomada !== 'boolean') {
    throw new Error('tomada debe ser booleano');
  }

  const nombre = typeof nombreReportado === 'string' ? nombreReportado.trim() : '';

  const fila = {
    id: randomUUID(),
    pacienteId: idPaciente,
    // Puede ser null si el paciente habló de "la pastilla" sin decir cuál.
    medicamentoId: medicamentoId ? String(medicamentoId) : null,
    nombreReportado: nombre || null,
    estado: tomada ? 'TOMADA' : 'SALTADA',
    tomadaEn: tomadaEn ? new Date(tomadaEn).toISOString() : new Date().toISOString(),
  };

  if (!porPaciente.has(idPaciente)) porPaciente.set(idPaciente, []);
  porPaciente.get(idPaciente).push(fila);

  return comoDTO(fila);
}

export async function listarPorPaciente(pacienteId) {
  const filas = porPaciente.get(validarPacienteId(pacienteId)) ?? [];
  return filas.map(comoDTO);
}

export function __reset() {
  porPaciente.clear();
}
