/**
 * Mock en memoria de `sintomas`.
 *
 * Misma interfaz que tendrá `src/repositories/sintomas.repo.js`:
 *   guardarSintoma({ pacienteId, descripcion, nivelGravedad, reportadoEn }) -> sintoma
 *   listarPorPaciente(pacienteId) -> sintomas
 *   __reset()
 *
 * Contrato del DTO (idéntico al que debe devolver el repo real):
 *   { id, pacienteId, descripcion, nivelGravedad, reportadoEn }
 *
 * `nivelGravedad` usa el vocabulario de la columna `nivel_gravedad`
 * ('LEVE' | 'MODERADO' | 'GRAVE'). El 1 | 2 | 3 que pregunta la conversación se
 * traduce antes de llamar aquí.
 *
 * En PostgreSQL la descripción se guarda cifrada en `descripcion_cifrada`
 * (`pgp_sym_encrypt`, AES-256). Aquí solo vive en memoria y nunca se registra
 * en logs.
 */

import { randomUUID } from 'node:crypto';

export const NIVELES_GRAVEDAD = Object.freeze(['LEVE', 'MODERADO', 'GRAVE']);

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
    descripcion: fila.descripcion,
    nivelGravedad: fila.nivelGravedad,
    reportadoEn: fila.reportadoEn,
  };
}

export async function guardarSintoma({ pacienteId, descripcion, nivelGravedad, reportadoEn } = {}) {
  const idPaciente = validarPacienteId(pacienteId);

  const texto = typeof descripcion === 'string' ? descripcion.trim() : '';
  if (!texto) throw new Error('descripcion es obligatoria');

  if (!NIVELES_GRAVEDAD.includes(nivelGravedad)) {
    throw new Error(`Nivel de gravedad inválido: ${nivelGravedad}`);
  }

  const fila = {
    id: randomUUID(),
    pacienteId: idPaciente,
    descripcion: texto,
    nivelGravedad,
    reportadoEn: reportadoEn ? new Date(reportadoEn).toISOString() : new Date().toISOString(),
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
