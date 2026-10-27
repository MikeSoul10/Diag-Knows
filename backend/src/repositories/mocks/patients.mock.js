/**
 * Mock en memoria de `pacientes`.
 *
 * Misma interfaz que tendrá `src/repositories/patients.repo.js`:
 *   findOrCreate(telegramChatId) -> paciente
 *   findByTelegramChatId(telegramChatId) -> paciente | null
 *   findById(id) -> paciente | null
 *   updatePerfil(id, { alias, anioNacimiento }) -> paciente | null
 *   setEstado(id, estado) -> paciente | null
 *   __reset()
 *
 * Contrato del DTO (idéntico al que debe devolver el repo real):
 *   { id, telegramChatId, alias, anioNacimiento, estado, creadoEn, consentimientoVigente }
 *
 * `telegramChatId` SIEMPRE se expone como string: en PostgreSQL la columna es
 * BIGINT y `pg` la entrega como string; normalizarla aquí evita que los
 * servicios se comporten distinto con mock y con la BD real.
 */

import { randomUUID } from 'node:crypto';
import * as consentimiento from './consentimiento.mock.js';

const ESTADOS_VALIDOS = ['ACTIVO', 'INACTIVO', 'BLOQUEADO'];

/** @type {Map<string, object>} chatId -> fila */
const porChatId = new Map();
/** @type {Map<string, object>} id -> fila */
const porId = new Map();

function normalizarChatId(telegramChatId) {
  if (telegramChatId === undefined || telegramChatId === null || telegramChatId === '') {
    throw new Error('telegramChatId es obligatorio');
  }
  return String(telegramChatId);
}

async function comoDTO(fila) {
  return {
    id: fila.id,
    telegramChatId: fila.telegramChatId,
    alias: fila.alias,
    anioNacimiento: fila.anioNacimiento,
    estado: fila.estado,
    creadoEn: fila.creadoEn,
    consentimientoVigente: await consentimiento.vigente(fila.id),
  };
}

export async function findOrCreate(telegramChatId) {
  const clave = normalizarChatId(telegramChatId);
  let fila = porChatId.get(clave);

  // Idempotente: en el repo real es INSERT ... ON CONFLICT (telegram_chat_id) DO NOTHING.
  if (!fila) {
    fila = {
      id: randomUUID(),
      telegramChatId: clave,
      alias: null,
      anioNacimiento: null,
      estado: 'ACTIVO',
      creadoEn: new Date().toISOString(),
    };
    porChatId.set(clave, fila);
    porId.set(fila.id, fila);
  }

  return comoDTO(fila);
}

export async function findByTelegramChatId(telegramChatId) {
  const fila = porChatId.get(normalizarChatId(telegramChatId));
  return fila ? comoDTO(fila) : null;
}

export async function findById(id) {
  const fila = porId.get(String(id ?? ''));
  return fila ? comoDTO(fila) : null;
}

export async function updatePerfil(id, { alias, anioNacimiento } = {}) {
  const fila = porId.get(String(id ?? ''));
  if (!fila) return null;

  if (alias !== undefined) fila.alias = alias;
  if (anioNacimiento !== undefined) fila.anioNacimiento = anioNacimiento;

  return comoDTO(fila);
}

export async function setEstado(id, estado) {
  if (!ESTADOS_VALIDOS.includes(estado)) {
    throw new Error(`Estado inválido: ${estado}`);
  }
  const fila = porId.get(String(id ?? ''));
  if (!fila) return null;

  fila.estado = estado;
  return comoDTO(fila);
}

export function __reset() {
  porChatId.clear();
  porId.clear();
}
