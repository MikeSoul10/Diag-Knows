/**
 * Mock en memoria de `registros_dosis`.
 *
 * Misma interfaz que tendrá `src/repositories/dosisLogs.repo.js`:
 *   guardarTomaMedicamento({ pacienteId, medicamentoId, nombreReportado, tomada, tomadaEn, mensajeId }) -> registro
 *   listarPorPaciente(pacienteId) -> registros
 *   __reset()
 *
 * Contrato del DTO (idéntico al que debe devolver el repo real):
 *   { id, pacienteId, medicamentoId, nombreReportado, estado, tomadaEn, mensajeId }
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
    // Igual que el repo real: sin toma (PENDIENTE, SALTADA, OMITIDA) se expone el momento programado.
    tomadaEn: fila.tomadaEn ?? fila.programadaEn,
    mensajeId: fila.mensajeId,
  };
}

export async function guardarTomaMedicamento({
  pacienteId,
  medicamentoId = null,
  nombreReportado = null,
  tomada,
  tomadaEn,
  mensajeId = null,
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
    mensajeId: mensajeId ? String(mensajeId) : null,
  };

  if (!porPaciente.has(idPaciente)) porPaciente.set(idPaciente, []);
  porPaciente.get(idPaciente).push(fila);

  return comoDTO(fila);
}

export async function listarPorPaciente(pacienteId) {
  const filas = porPaciente.get(validarPacienteId(pacienteId)) ?? [];
  return filas.map(comoDTO);
}

/** Filas con `tomadaEn` en [desde, hasta), para el historial (DK-301). */
export async function listarPorRango(pacienteId, desde, hasta) {
  const inicio = new Date(desde).getTime();
  const fin = new Date(hasta).getTime();
  return (await listarPorPaciente(pacienteId)).filter((fila) => {
    const momento = new Date(fila.tomadaEn).getTime();
    return momento >= inicio && momento < fin;
  });
}

/** Borra todas las filas del paciente (`/borrar_datos`, DK-303). Devuelve cuántas. */
export async function eliminarPorPaciente(pacienteId) {
  const clave = String(pacienteId ?? '');
  const cantidad = porPaciente.get(clave)?.length ?? 0;
  porPaciente.delete(clave);
  return cantidad;
}

// ---------------------------------------------------------------------------
// Recordatorios (DK-302) — misma semántica que dosisLogs.repo.js
// ---------------------------------------------------------------------------

function todasLasFilas() {
  return [...porPaciente.values()].flat();
}

export async function crearPendiente({ pacienteId, horarioId, medicamentoId, programadaEn } = {}) {
  const idPaciente = validarPacienteId(pacienteId);
  if (!horarioId) throw new Error('horarioId es obligatorio');
  if (!programadaEn) throw new Error('programadaEn es obligatorio');
  const momento = new Date(programadaEn).toISOString();

  // Índice único parcial (horario_id, programada_en) de la migración 004.
  const repetida = todasLasFilas().some(
    (fila) => fila.horarioId === String(horarioId) && fila.programadaEn === momento
  );
  if (repetida) return null;

  const fila = {
    id: randomUUID(),
    pacienteId: idPaciente,
    horarioId: String(horarioId),
    medicamentoId: medicamentoId ? String(medicamentoId) : null,
    nombreReportado: null,
    estado: 'PENDIENTE',
    programadaEn: momento,
    tomadaEn: null,
    mensajeId: null,
  };
  if (!porPaciente.has(idPaciente)) porPaciente.set(idPaciente, []);
  porPaciente.get(idPaciente).push(fila);
  return comoDTO(fila);
}

export async function responderPendiente({ registroId, pacienteId, tomada, respondidaEn } = {}) {
  if (typeof tomada !== 'boolean') throw new Error('tomada debe ser booleano');
  const fila = (porPaciente.get(String(pacienteId ?? '')) ?? []).find(
    (item) => item.id === String(registroId ?? '')
  );
  if (!fila || !['PENDIENTE', 'OMITIDA'].includes(fila.estado)) return null;

  fila.estado = tomada ? 'TOMADA' : 'SALTADA';
  fila.tomadaEn = tomada ? new Date(respondidaEn ?? Date.now()).toISOString() : null;
  return comoDTO(fila);
}

export async function marcarOmitidas(limite) {
  const corte = new Date(limite).getTime();
  let marcadas = 0;
  for (const fila of todasLasFilas()) {
    if (fila.estado === 'PENDIENTE' && new Date(fila.programadaEn).getTime() < corte) {
      fila.estado = 'OMITIDA';
      marcadas += 1;
    }
  }
  return marcadas;
}

export function __reset() {
  porPaciente.clear();
}
