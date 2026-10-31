/**
 * Mock en memoria de `medicamentos`.
 *
 * Misma interfaz que tendrá `src/repositories/medicamentos.repo.js`:
 *   listarPorPaciente(pacienteId) -> medicamentos
 *   buscarPorNombre(pacienteId, nombre) -> medicamento | null
 *   crear({ pacienteId, nombre, dosis, frecuencia, fechaInicio, fechaFin }) -> medicamento
 *   sembrarDatosDesarrollo(pacienteId) -> medicamentos  (solo desarrollo)
 *   __reset()
 *
 * Contrato del DTO (idéntico al que debe devolver el repo real):
 *   { id, pacienteId, nombre, dosis, frecuencia, fechaInicio, fechaFin }
 *
 * `sembrarDatosDesarrollo` es la única fuente de medicamentos ficticios. Existe
 * para poder demostrar DK-204 sin la BD: el paciente dice "me tomé la
 * metformina" y la toma se asocia a un tratamiento real del catálogo. Nunca
 * corre en producción y no toca nada del Sprint 1: hay que llamarla a mano.
 */

import { randomUUID } from 'node:crypto';

import { usarRepositoriosMock } from '../../config/env.js';

/** Medicamentos ficticios para las demos y las pruebas. */
export const MEDICAMENTOS_DESARROLLO = Object.freeze([
  { nombre: 'Metformina', dosis: '850 mg', frecuencia: 'Cada 12 horas' },
  { nombre: 'Losartán', dosis: '50 mg', frecuencia: 'Cada 24 horas' },
]);

/** @type {Map<string, Array<object>>} pacienteId -> filas */
const porPaciente = new Map();

function validarPacienteId(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  return String(pacienteId);
}

/** Minúsculas y sin acentos: "LOSARTAN" debe encontrar "Losartán". */
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function comoDTO(fila) {
  return {
    id: fila.id,
    pacienteId: fila.pacienteId,
    nombre: fila.nombre,
    dosis: fila.dosis,
    frecuencia: fila.frecuencia,
    fechaInicio: fila.fechaInicio,
    fechaFin: fila.fechaFin,
  };
}

export async function listarPorPaciente(pacienteId) {
  const filas = porPaciente.get(validarPacienteId(pacienteId)) ?? [];
  return filas.map(comoDTO);
}

/**
 * Busca el medicamento del paciente por nombre, sin distinguir mayúsculas ni
 * acentos. Tolera que el paciente diga solo una parte ("metformina" para
 * "Metformina 850 mg").
 */
export async function buscarPorNombre(pacienteId, nombre) {
  const buscado = normalizar(nombre);
  if (!buscado) return null;

  const filas = porPaciente.get(validarPacienteId(pacienteId)) ?? [];

  const exacto = filas.find((fila) => normalizar(fila.nombre) === buscado);
  if (exacto) return comoDTO(exacto);

  const parcial = filas.find((fila) => normalizar(fila.nombre).includes(buscado));
  return parcial ? comoDTO(parcial) : null;
}

export async function crear({
  pacienteId,
  nombre,
  dosis,
  frecuencia,
  fechaInicio,
  fechaFin = null,
} = {}) {
  const idPaciente = validarPacienteId(pacienteId);

  const nombreLimpio = typeof nombre === 'string' ? nombre.trim() : '';
  if (!nombreLimpio) throw new Error('nombre es obligatorio');

  const fila = {
    id: randomUUID(),
    pacienteId: idPaciente,
    nombre: nombreLimpio,
    dosis: dosis ? String(dosis) : 'sin dosis',
    frecuencia: frecuencia ? String(frecuencia) : 'sin frecuencia',
    fechaInicio: fechaInicio ? new Date(fechaInicio).toISOString() : new Date().toISOString(),
    fechaFin: fechaFin ? new Date(fechaFin).toISOString() : null,
  };

  if (!porPaciente.has(idPaciente)) porPaciente.set(idPaciente, []);
  porPaciente.get(idPaciente).push(fila);

  return comoDTO(fila);
}

/**
 * Siembra el catálogo ficticio para un paciente.
 *
 * @param {string} pacienteId
 * @returns {Promise<Array<object>>}
 * @throws {Error} En producción o cuando los repositorios no son mock.
 */
export async function sembrarDatosDesarrollo(pacienteId) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('sembrarDatosDesarrollo no está permitido en producción');
  }
  if (!usarRepositoriosMock()) {
    throw new Error('sembrarDatosDesarrollo solo existe en modo mock');
  }

  const creados = [];
  for (const datos of MEDICAMENTOS_DESARROLLO) {
    creados.push(await crear({ pacienteId, ...datos }));
  }
  return creados;
}

export function __reset() {
  porPaciente.clear();
}
