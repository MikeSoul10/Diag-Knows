/**
 * Mock en memoria de `mensajes_reporte` (trazabilidad, migración 006).
 *
 * Misma interfaz que `src/repositories/mensajes.repo.js`:
 *   guardarMensaje({ pacienteId, texto, recibidoEn, retencionDias }) -> { id, pacienteId, recibidoEn, expiraEn }
 *   obtener(id) -> { id, pacienteId, texto, recibidoEn, expiraEn } | null
 *   eliminarVencidos(ahora) -> número de mensajes borrados
 *   eliminarPorPaciente(pacienteId) -> número de mensajes borrados
 *   __reset()
 *
 * En PostgreSQL el texto se cifra; aquí vive solo en memoria y nunca va a logs.
 */

import { randomUUID } from 'node:crypto';

import { diasRetencionMensajes } from '../../config/env.js';

/** @type {Map<string, object>} id -> fila */
const porId = new Map();

const DIA_MS = 24 * 60 * 60 * 1000;

function validarPacienteId(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  return String(pacienteId);
}

export async function guardarMensaje({
  pacienteId,
  texto,
  recibidoEn,
  retencionDias = diasRetencionMensajes(),
} = {}) {
  const idPaciente = validarPacienteId(pacienteId);
  const contenido = typeof texto === 'string' ? texto.trim() : '';
  if (!contenido) throw new Error('texto es obligatorio');
  if (!Number.isInteger(retencionDias) || retencionDias < 1) {
    throw new Error('retencionDias debe ser un entero ≥ 1');
  }

  const recibido = recibidoEn ? new Date(recibidoEn) : new Date();
  const fila = {
    id: randomUUID(),
    pacienteId: idPaciente,
    texto: contenido,
    recibidoEn: recibido.toISOString(),
    expiraEn: new Date(recibido.getTime() + retencionDias * DIA_MS).toISOString(),
  };
  porId.set(fila.id, fila);

  const { texto: _texto, ...sinTexto } = fila;
  return { ...sinTexto };
}

export async function obtener(id) {
  const fila = porId.get(String(id ?? ''));
  return fila ? { ...fila } : null;
}

export async function eliminarVencidos(ahora = new Date()) {
  const limite = new Date(ahora).getTime();
  let borrados = 0;
  for (const [id, fila] of porId) {
    if (new Date(fila.expiraEn).getTime() <= limite) {
      porId.delete(id);
      borrados += 1;
    }
  }
  return borrados;
}

export async function eliminarPorPaciente(pacienteId) {
  const clave = String(pacienteId ?? '');
  let borrados = 0;
  for (const [id, fila] of porId) {
    if (fila.pacienteId === clave) {
      porId.delete(id);
      borrados += 1;
    }
  }
  return borrados;
}

export function __reset() {
  porId.clear();
}
