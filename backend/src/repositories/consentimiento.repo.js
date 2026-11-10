/**
 * Repositorio PostgreSQL de `registros_consentimiento` (DK-103, DK-104).
 *
 * Misma interfaz y DTO que `mocks/consentimiento.mock.js`:
 *   { id, pacienteId, aceptado, versionPrivacidad, aceptadoEn }
 *
 * Es una bitácora: nunca se actualiza ni se borra un registro, se agrega otro.
 * El consentimiento vigente es el del registro MÁS RECIENTE. `aceptado_en` se
 * fija con clock_timestamp() para que dos registros de la misma transacción no
 * empaten; `ctid` desempata si caen en el mismo microsegundo.
 */

import { query } from '../db/pool.js';

function comoDTO(fila) {
  return {
    id: fila.id,
    pacienteId: fila.paciente_id,
    aceptado: fila.aceptado,
    versionPrivacidad: fila.version_privacidad,
    aceptadoEn: fila.aceptado_en,
  };
}

function validarPacienteId(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  return String(pacienteId);
}

export async function registrar({ pacienteId, aceptado, versionPrivacidad }) {
  const idPaciente = validarPacienteId(pacienteId);
  if (typeof aceptado !== 'boolean') throw new Error('aceptado debe ser booleano');
  if (!versionPrivacidad) throw new Error('versionPrivacidad es obligatoria');

  const { rows } = await query(
    `INSERT INTO registros_consentimiento (paciente_id, aceptado, version_privacidad, aceptado_en)
     VALUES ($1, $2, $3, clock_timestamp() AT TIME ZONE 'UTC')
     RETURNING id, paciente_id, aceptado, version_privacidad, aceptado_en`,
    [idPaciente, aceptado, String(versionPrivacidad)]
  );
  return comoDTO(rows[0]);
}

export async function vigente(pacienteId) {
  const { rows } = await query(
    `SELECT COALESCE(
       (SELECT aceptado FROM registros_consentimiento
         WHERE paciente_id = $1
         ORDER BY aceptado_en DESC, ctid DESC LIMIT 1), FALSE) AS consentimiento_vigente`,
    [validarPacienteId(pacienteId)]
  );
  return rows[0].consentimiento_vigente;
}

export async function listarPorPaciente(pacienteId) {
  const { rows } = await query(
    `SELECT id, paciente_id, aceptado, version_privacidad, aceptado_en
       FROM registros_consentimiento
      WHERE paciente_id = $1
      ORDER BY aceptado_en, ctid`,
    [validarPacienteId(pacienteId)]
  );
  return rows.map(comoDTO);
}

export function __reset() {}
