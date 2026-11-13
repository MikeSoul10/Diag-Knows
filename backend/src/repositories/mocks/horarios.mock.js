/**
 * Mock en memoria de `horarios_medicamento` (DK-302).
 *
 * Misma interfaz que `src/repositories/horarios.repo.js`. Para las consultas
 * que en SQL son JOIN (medicamento, paciente, consentimiento) usa los otros
 * mocks.
 */

import { randomUUID } from 'node:crypto';

import * as medicamentos from './medicamentos.mock.js';
import * as patients from './patients.mock.js';

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** @type {Map<string, object>} id -> fila */
const porId = new Map();

function comoDTO(fila) {
  return {
    id: fila.id,
    medicamentoId: fila.medicamentoId,
    horaProgramada: fila.horaProgramada,
    activo: fila.activo,
  };
}

export async function crear({ medicamentoId, horaProgramada } = {}) {
  if (!medicamentoId) throw new Error('medicamentoId es obligatorio');
  const hora = String(horaProgramada ?? '').trim();
  if (!HORA_RE.test(hora)) throw new Error('horaProgramada debe tener el formato HH:MM');

  const fila = {
    id: randomUUID(),
    medicamentoId: String(medicamentoId),
    horaProgramada: hora,
    activo: true,
  };
  porId.set(fila.id, fila);
  return comoDTO(fila);
}

export async function listarPorPaciente(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  const meds = new Map(
    (await medicamentos.listarPorPaciente(pacienteId)).map((med) => [med.id, med])
  );

  return [...porId.values()]
    .filter((fila) => fila.activo && meds.has(fila.medicamentoId))
    .map((fila) => ({
      ...comoDTO(fila),
      medicamentoNombre: meds.get(fila.medicamentoId).nombre,
      dosis: meds.get(fila.medicamentoId).dosis,
    }))
    .sort(
      (a, b) =>
        a.horaProgramada.localeCompare(b.horaProgramada) ||
        a.medicamentoNombre.localeCompare(b.medicamentoNombre)
    );
}

export async function listarParaRecordatorio() {
  const resultado = [];
  for (const fila of porId.values()) {
    if (!fila.activo) continue;
    const med = await medicamentos.obtener(fila.medicamentoId);
    if (!med) continue;
    if (med.fechaFin && new Date(med.fechaFin) < new Date(new Date().toDateString())) continue;

    const paciente = await patients.findById(med.pacienteId);
    if (!paciente || paciente.estado !== 'ACTIVO' || !paciente.consentimientoVigente) continue;

    resultado.push({
      horarioId: fila.id,
      horaProgramada: fila.horaProgramada,
      medicamentoId: med.id,
      medicamentoNombre: med.nombre,
      dosis: med.dosis,
      pacienteId: paciente.id,
      telegramChatId: paciente.telegramChatId,
      zonaHoraria: paciente.zonaHoraria,
    });
  }
  return resultado;
}

/** Borra los horarios de los medicamentos del paciente. Llamar ANTES de borrar sus medicamentos. */
export async function eliminarPorPaciente(pacienteId) {
  const meds = new Set((await medicamentos.listarPorPaciente(pacienteId)).map((med) => med.id));
  let borrados = 0;
  for (const [id, fila] of porId) {
    if (meds.has(fila.medicamentoId)) {
      porId.delete(id);
      borrados += 1;
    }
  }
  return borrados;
}

export function __reset() {
  porId.clear();
}
