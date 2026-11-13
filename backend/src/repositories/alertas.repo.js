/**
 * Repositorio PostgreSQL de `alertas` (DK-302).
 *
 * Misma interfaz y DTO que `mocks/alertas.mock.js`:
 *   crear({ pacienteId, medicionId, tipo, severidad }) -> alerta
 *   listarPorPaciente(pacienteId) -> alertas
 *   marcarAtendida(id) -> alerta | null
 *   __reset()
 *
 * DTO: { id, pacienteId, medicionId, tipo, severidad, enviadaEn, atendida }
 *
 * Solo se insertan alertas cuando el servicio detecta un umbral crítico
 * validado (`config/thresholds.js`, hoy en `null`). Aquí no se decide nada
 * clínico: el repo solo persiste.
 */

import { query } from '../db/pool.js';
import { aIsoUtc } from './cifrado.js';

export const TIPOS = Object.freeze(['UMBRAL_CRITICO', 'DOSIS_OMITIDA']);
export const SEVERIDADES = Object.freeze(['BAJA', 'MEDIA', 'ALTA']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNAS = 'id, paciente_id, medicion_id, tipo, severidad, enviada_en, atendida';

function comoDTO(fila) {
  return {
    id: fila.id,
    pacienteId: fila.paciente_id,
    medicionId: fila.medicion_id ?? null,
    tipo: fila.tipo,
    severidad: fila.severidad,
    enviadaEn: fila.enviada_en,
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

  const { rows } = await query(
    `INSERT INTO alertas (paciente_id, medicion_id, tipo, severidad, enviada_en)
     VALUES ($1, $2, $3, $4, COALESCE($5::timestamp, CURRENT_TIMESTAMP))
     RETURNING ${COLUMNAS}`,
    [idPaciente, medicionId ? String(medicionId) : null, tipo, severidad, aIsoUtc(enviadaEn)]
  );
  return comoDTO(rows[0]);
}

export async function listarPorPaciente(pacienteId) {
  const { rows } = await query(
    `SELECT ${COLUMNAS} FROM alertas
      WHERE paciente_id = $1
      ORDER BY enviada_en, id`,
    [validarPacienteId(pacienteId)]
  );
  return rows.map(comoDTO);
}

export async function marcarAtendida(id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  const { rows } = await query(
    `UPDATE alertas SET atendida = TRUE
      WHERE id = $1
      RETURNING ${COLUMNAS}`,
    [id]
  );
  return rows[0] ? comoDTO(rows[0]) : null;
}

export function __reset() {}
