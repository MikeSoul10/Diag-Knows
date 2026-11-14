/**
 * Mock en memoria de `alertas` (DK-302).
 *
 * Misma interfaz que `src/repositories/alertas.repo.js`:
 *   crear({ pacienteId, medicionId, tipo, severidad }) -> alerta
 *   listarPorPaciente(pacienteId) -> alertas
 *   marcarAtendida(id) -> alerta | null
 *   eliminarPorPaciente(pacienteId) -> cuántas se borraron
 *   __reset()
 *
 * DTO: { id, pacienteId, medicionId, tipo, severidad, enviadaEn, atendida }
 *
 * Con los umbrales clínicos en `null` normalmente no se crea ninguna alerta;
 * existe para probar el hook de conversación con umbrales inyectados.
 */

import { randomUUID } from 'node:crypto';

import { SEVERIDADES, TIPOS } from '../alertas.repo.js';

/** @type {Map<string, object>} id -> fila */
const porId = new Map();

function comoDTO(fila) {
  return {
    id: fila.id,
    pacienteId: fila.pacienteId,
    medicionId: fila.medicionId,
    tipo: fila.tipo,
    severidad: fila.severidad,
    enviadaEn: fila.enviadaEn,
    atendida: fila.atendida,
  };
}

function validarPacienteId(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  return String(pacienteId);
}

export async function crear({ pacienteId, medicionId = null, tipo, severidad, enviadaEn } = {}) {
  const idPaciente = validarPacienteId(pacienteId);
  if (!TIPOS.includes(tipo)) throw new Error(`Tipo de alerta inválido: ${tipo}`);
  if (!SEVERIDADES.includes(severidad)) {
    throw new Error(`Severidad de alerta inválida: ${severidad}`);
  }

  const fila = {
    id: randomUUID(),
    pacienteId: idPaciente,
    medicionId: medicionId ? String(medicionId) : null,
    tipo,
    severidad,
    enviadaEn: enviadaEn ? new Date(enviadaEn).toISOString() : new Date().toISOString(),
    atendida: false,
  };
  porId.set(fila.id, fila);
  return comoDTO(fila);
}

export async function listarPorPaciente(pacienteId) {
  const idPaciente = validarPacienteId(pacienteId);
  return [...porId.values()]
    .filter((fila) => fila.pacienteId === idPaciente)
    .sort((a, b) => a.enviadaEn.localeCompare(b.enviadaEn))
    .map(comoDTO);
}

export async function marcarAtendida(id) {
  const fila = porId.get(String(id ?? ''));
  if (!fila) return null;
  fila.atendida = true;
  return comoDTO(fila);
}

/** Borra todas las alertas del paciente (`/borrar_datos`, DK-303). */
export async function eliminarPorPaciente(pacienteId) {
  const idPaciente = String(pacienteId ?? '');
  let borradas = 0;
  for (const [id, fila] of porId) {
    if (fila.pacienteId === idPaciente) {
      porId.delete(id);
      borradas += 1;
    }
  }
  return borradas;
}

export function __reset() {
  porId.clear();
}
