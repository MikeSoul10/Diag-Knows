/**
 * Repositorio PostgreSQL de `sintomas` (DK-103, DK-202).
 *
 * Misma interfaz y DTO que `mocks/sintomas.mock.js`:
 *   { id, pacienteId, descripcion, nivelGravedad, reportadoEn }
 *
 * La descripción se cifra EN SQL con pgp_sym_encrypt (AES-256) en
 * `descripcion_cifrada`. Nunca se registra en logs.
 */

import { query } from '../db/pool.js';
import { aIsoUtc, llaveCifrado, OPCIONES_PGP } from './cifrado.js';

export const NIVELES_GRAVEDAD = Object.freeze(['LEVE', 'MODERADO', 'GRAVE']);

function validarPacienteId(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  return String(pacienteId);
}

function comoDTO(fila) {
  return {
    id: fila.id,
    pacienteId: fila.paciente_id,
    descripcion: fila.descripcion,
    nivelGravedad: fila.nivel_gravedad,
    reportadoEn: fila.registrado_en,
  };
}

export async function guardarSintoma({ pacienteId, descripcion, nivelGravedad, reportadoEn } = {}) {
  const idPaciente = validarPacienteId(pacienteId);

  const texto = typeof descripcion === 'string' ? descripcion.trim() : '';
  if (!texto) throw new Error('descripcion es obligatoria');
  if (!NIVELES_GRAVEDAD.includes(nivelGravedad)) {
    throw new Error(`Nivel de gravedad inválido: ${nivelGravedad}`);
  }

  const { rows } = await query(
    `INSERT INTO sintomas (paciente_id, descripcion_cifrada, nivel_gravedad, registrado_en)
     VALUES ($1, pgp_sym_encrypt($2::text, $3::text, '${OPCIONES_PGP}'), $4,
             COALESCE($5::timestamp, CURRENT_TIMESTAMP))
     RETURNING id, paciente_id, $2::text AS descripcion, nivel_gravedad, registrado_en`,
    [idPaciente, texto, llaveCifrado(), nivelGravedad, aIsoUtc(reportadoEn)]
  );
  return comoDTO(rows[0]);
}

export async function listarPorPaciente(pacienteId) {
  const { rows } = await query(
    `SELECT id, paciente_id, pgp_sym_decrypt(descripcion_cifrada, $2::text) AS descripcion,
            nivel_gravedad, registrado_en
       FROM sintomas
      WHERE paciente_id = $1
      ORDER BY registrado_en, id`,
    [validarPacienteId(pacienteId), llaveCifrado()]
  );
  return rows.map(comoDTO);
}

/** Síntomas en [desde, hasta), para el historial (DK-301). */
export async function listarPorRango(pacienteId, desde, hasta) {
  const { rows } = await query(
    `SELECT id, paciente_id, pgp_sym_decrypt(descripcion_cifrada, $4::text) AS descripcion,
            nivel_gravedad, registrado_en
       FROM sintomas
      WHERE paciente_id = $1 AND registrado_en >= $2 AND registrado_en < $3
      ORDER BY registrado_en, id`,
    [validarPacienteId(pacienteId), aIsoUtc(desde), aIsoUtc(hasta), llaveCifrado()]
  );
  return rows.map(comoDTO);
}

export function __reset() {}
