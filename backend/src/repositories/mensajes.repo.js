/**
 * Repositorio PostgreSQL de `mensajes_reporte` (trazabilidad, migración 006).
 *
 * Misma interfaz y DTO que `mocks/mensajes.mock.js`:
 *   guardarMensaje({ pacienteId, texto, recibidoEn, retencionDias }) -> { id, pacienteId, recibidoEn, expiraEn }
 *   obtener(id) -> { id, pacienteId, texto, recibidoEn, expiraEn } | null
 *   eliminarVencidos(ahora) -> número de mensajes borrados
 *
 * - El texto llega YA anonimizado y se cifra EN SQL con pgp_sym_encrypt (AES-256).
 * - `guardarMensaje` no devuelve el texto: solo hace falta el id para enlazarlo.
 * - Nunca se registra el texto en logs.
 */

import { query } from '../db/pool.js';
import { aIsoUtc, llaveCifrado, OPCIONES_PGP } from './cifrado.js';
import { diasRetencionMensajes } from '../config/env.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validarPacienteId(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  return String(pacienteId);
}

function validarDias(dias) {
  if (!Number.isInteger(dias) || dias < 1) throw new Error('retencionDias debe ser un entero ≥ 1');
  return dias;
}

function comoDTO(fila) {
  if (!fila) return null;
  const dto = {
    id: fila.id,
    pacienteId: fila.paciente_id,
    recibidoEn: fila.recibido_en,
    expiraEn: fila.expira_en,
  };
  if (fila.texto !== undefined) dto.texto = fila.texto;
  return dto;
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

  const recibido = aIsoUtc(recibidoEn) ?? new Date().toISOString();
  const dias = validarDias(retencionDias);

  const { rows } = await query(
    `INSERT INTO mensajes_reporte (paciente_id, texto_cifrado, recibido_en, expira_en)
     VALUES ($1, pgp_sym_encrypt($2::text, $3::text, '${OPCIONES_PGP}'), $4::timestamp,
             $4::timestamp + make_interval(days => $5::int))
     RETURNING id, paciente_id, recibido_en, expira_en`,
    [idPaciente, contenido, llaveCifrado(), recibido, dias]
  );
  return comoDTO(rows[0]);
}

export async function obtener(id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  const { rows } = await query(
    `SELECT id, paciente_id, pgp_sym_decrypt(texto_cifrado, $2::text) AS texto,
            recibido_en, expira_en
       FROM mensajes_reporte
      WHERE id = $1`,
    [id, llaveCifrado()]
  );
  return comoDTO(rows[0]);
}

/** Borra los mensajes cuya retención ya venció. Los registros quedan con mensaje_id NULL. */
export async function eliminarVencidos(ahora = new Date()) {
  const { rowCount } = await query('DELETE FROM mensajes_reporte WHERE expira_en <= $1', [
    aIsoUtc(ahora),
  ]);
  return rowCount;
}

export function __reset() {}
