/**
 * Mock en memoria de `resumenes_semanales` (DK-302).
 *
 * Misma interfaz que `src/repositories/resumenes.repo.js`:
 *   calcularAdherencia({ pacienteId, desde, hasta }) -> { porcentaje, tomadas, esperadas }
 *   crear({ pacienteId, semanaInicio, porcentajeAdherencia, texto }) -> resumen | null
 *   listarPorPaciente(pacienteId) -> resúmenes
 *   listarCandidatos() -> pacientes ACTIVO con consentimiento vigente
 *   eliminarPorPaciente(pacienteId) -> cuántos se borraron
 *   __reset()
 *
 * En PostgreSQL el texto se cifra; aquí vive solo en memoria. La clave de
 * idempotencia es (pacienteId, semanaInicio), igual que el UNIQUE de la 002.
 */

import { randomUUID } from 'node:crypto';

import * as dosisLogs from './dosisLogs.mock.js';
import * as patients from './patients.mock.js';

/** @type {Map<string, Map<string, object>>} pacienteId -> semanaInicio -> fila */
const porPaciente = new Map();

const SEMANA_RE = /^\d{4}-\d{2}-\d{2}$/;

function validarPacienteId(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  return String(pacienteId);
}

function normalizarSemana(semanaInicio) {
  const texto =
    semanaInicio instanceof Date
      ? semanaInicio.toISOString().slice(0, 10)
      : String(semanaInicio ?? '').slice(0, 10);
  if (!SEMANA_RE.test(texto)) throw new Error('semanaInicio debe tener el formato YYYY-MM-DD');
  return texto;
}

function comoDTO(fila) {
  return {
    id: fila.id,
    pacienteId: fila.pacienteId,
    semanaInicio: fila.semanaInicio,
    porcentajeAdherencia: fila.porcentajeAdherencia,
    texto: fila.texto,
    enviadoEn: fila.enviadoEn,
  };
}

/**
 * En el mock, `tomadaEn` es el mejor proxy de `programada_en`: para las dosis
 * pendientes, omitidas o saltadas equivale al momento programado, y las tomas
 * del chat guardan el mismo instante en ambos campos.
 */
export async function calcularAdherencia({ pacienteId, desde, hasta } = {}) {
  const idPaciente = validarPacienteId(pacienteId);
  const inicio = new Date(desde).getTime();
  const fin = new Date(hasta).getTime();

  const filas = (await dosisLogs.listarPorPaciente(idPaciente)).filter((fila) => {
    const momento = new Date(fila.tomadaEn).getTime();
    return momento >= inicio && momento < fin;
  });

  const tomadas = filas.filter((fila) => fila.estado === 'TOMADA').length;
  const esperadas = filas.filter((fila) => fila.estado !== 'PENDIENTE').length;
  const porcentaje = esperadas === 0 ? 0 : Math.round((100 * tomadas * 100) / esperadas) / 100;

  return { porcentaje, tomadas, esperadas };
}

/** `null` si ese paciente ya tenía resumen para esa semana (idempotente). */
export async function crear({ pacienteId, semanaInicio, porcentajeAdherencia = null, texto } = {}) {
  const idPaciente = validarPacienteId(pacienteId);
  const semana = normalizarSemana(semanaInicio);
  const contenido = typeof texto === 'string' ? texto.trim() : '';
  if (!contenido) throw new Error('texto es obligatorio');

  if (!porPaciente.has(idPaciente)) porPaciente.set(idPaciente, new Map());
  const semanas = porPaciente.get(idPaciente);
  if (semanas.has(semana)) return null;

  const fila = {
    id: randomUUID(),
    pacienteId: idPaciente,
    semanaInicio: semana,
    porcentajeAdherencia:
      porcentajeAdherencia === null || porcentajeAdherencia === undefined
        ? null
        : Number(porcentajeAdherencia),
    texto: contenido,
    enviadoEn: new Date().toISOString(),
  };
  semanas.set(semana, fila);
  return comoDTO(fila);
}

export async function listarPorPaciente(pacienteId) {
  const idPaciente = validarPacienteId(pacienteId);
  return [...(porPaciente.get(idPaciente)?.values() ?? [])]
    .sort((a, b) => a.semanaInicio.localeCompare(b.semanaInicio))
    .map(comoDTO);
}

export async function listarCandidatos() {
  const candidatos = [];
  for (const paciente of await patients.listar()) {
    if (paciente.estado !== 'ACTIVO' || !paciente.consentimientoVigente) continue;
    candidatos.push({
      id: paciente.id,
      telegramChatId: paciente.telegramChatId,
      zonaHoraria: paciente.zonaHoraria,
      alias: paciente.alias,
    });
  }
  return candidatos;
}

/** Borra los resúmenes del paciente (`/borrar_datos`, DK-303). */
export async function eliminarPorPaciente(pacienteId) {
  const idPaciente = String(pacienteId ?? '');
  const semanas = porPaciente.get(idPaciente);
  const borrados = semanas?.size ?? 0;
  porPaciente.delete(idPaciente);
  return borrados;
}

export function __reset() {
  porPaciente.clear();
}
