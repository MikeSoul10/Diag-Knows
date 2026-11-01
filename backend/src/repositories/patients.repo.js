/**
 * Repositorio PostgreSQL de `pacientes` (DK-103, DK-105).
 *
 * Misma interfaz y DTO que `mocks/patients.mock.js`:
 *   { id, telegramChatId, alias, anioNacimiento, estado, creadoEn, consentimientoVigente }
 *
 * Requiere la migración 003 (alias, anio_nacimiento).
 * `consentimientoVigente` sale del registro MÁS RECIENTE de registros_consentimiento.
 */

import { query } from '../db/pool.js';

const ESTADOS_VALIDOS = ['ACTIVO', 'INACTIVO', 'BLOQUEADO'];

const SELECT_PACIENTE = `
  SELECT p.id, p.telegram_chat_id, p.alias, p.anio_nacimiento, p.estado, p.creado_en,
         COALESCE((SELECT rc.aceptado
                     FROM registros_consentimiento rc
                    WHERE rc.paciente_id = p.id
                    ORDER BY rc.aceptado_en DESC, rc.ctid DESC
                    LIMIT 1), FALSE) AS consentimiento_vigente
    FROM pacientes p`;

function comoDTO(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    telegramChatId: String(fila.telegram_chat_id),
    alias: fila.alias,
    anioNacimiento: fila.anio_nacimiento,
    estado: fila.estado,
    creadoEn: fila.creado_en,
    consentimientoVigente: fila.consentimiento_vigente,
  };
}

function normalizarChatId(telegramChatId) {
  if (telegramChatId === undefined || telegramChatId === null || telegramChatId === '') {
    throw new Error('telegramChatId es obligatorio');
  }
  const texto = String(telegramChatId);
  if (!/^-?\d+$/.test(texto)) throw new Error('telegramChatId debe ser numérico');
  return texto;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id que no es UUID no existe (y evita un error de tipo en PostgreSQL). */
function idValido(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

export async function findOrCreate(telegramChatId) {
  const chatId = normalizarChatId(telegramChatId);
  await query(
    `INSERT INTO pacientes (telegram_chat_id) VALUES ($1)
     ON CONFLICT (telegram_chat_id) DO NOTHING`,
    [chatId]
  );
  return findByTelegramChatId(chatId);
}

export async function findByTelegramChatId(telegramChatId) {
  const chatId = normalizarChatId(telegramChatId);
  const { rows } = await query(`${SELECT_PACIENTE} WHERE p.telegram_chat_id = $1`, [chatId]);
  return comoDTO(rows[0]);
}

export async function findById(id) {
  if (!idValido(id)) return null;
  const { rows } = await query(`${SELECT_PACIENTE} WHERE p.id = $1`, [id]);
  return comoDTO(rows[0]);
}

export async function updatePerfil(id, { alias, anioNacimiento } = {}) {
  if (!idValido(id)) return null;

  // Solo se actualiza lo que viene definido (igual que el mock).
  const { rowCount } = await query(
    `UPDATE pacientes
        SET alias           = CASE WHEN $2 THEN $3 ELSE alias END,
            anio_nacimiento = CASE WHEN $4 THEN $5::smallint ELSE anio_nacimiento END
      WHERE id = $1`,
    [id, alias !== undefined, alias ?? null, anioNacimiento !== undefined, anioNacimiento ?? null]
  );
  return rowCount ? findById(id) : null;
}

export async function setEstado(id, estado) {
  if (!ESTADOS_VALIDOS.includes(estado)) {
    throw new Error(`Estado inválido: ${estado}`);
  }
  if (!idValido(id)) return null;

  const { rowCount } = await query('UPDATE pacientes SET estado = $2 WHERE id = $1', [id, estado]);
  return rowCount ? findById(id) : null;
}

/** Sin estado en memoria: las pruebas de integración limpian la BD con TRUNCATE. */
export function __reset() {}
