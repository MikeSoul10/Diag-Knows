/**
 * Repositorio PostgreSQL de `enfermedades` y `paciente_enfermedades` (DK-103, DK-105).
 *
 * Misma interfaz y DTO que `mocks/enfermedades.mock.js`: { id, codigo, nombre }.
 * Requiere la migración 003. El catálogo se ordena igual que el mock
 * (diabetes, hipertensión, asma) para que los botones salgan en el mismo orden.
 */

import { query } from '../db/pool.js';

const orden = (t = '') =>
  `CASE ${t}codigo WHEN 'DIABETES_TIPO_2' THEN 1 WHEN 'HIPERTENSION' THEN 2 WHEN 'ASMA' THEN 3 ELSE 4 END, ${t}nombre`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function comoDTO(fila) {
  return { id: fila.id, codigo: fila.codigo, nombre: fila.nombre };
}

export async function listar() {
  const { rows } = await query(`SELECT id, codigo, nombre FROM enfermedades ORDER BY ${orden()}`);
  return rows.map(comoDTO);
}

export async function obtenerPorId(id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  const { rows } = await query('SELECT id, codigo, nombre FROM enfermedades WHERE id = $1', [id]);
  return rows[0] ? comoDTO(rows[0]) : null;
}

export async function listarPorPaciente(pacienteId) {
  if (typeof pacienteId !== 'string' || !UUID_RE.test(pacienteId)) return [];
  const { rows } = await query(
    `SELECT e.id, e.codigo, e.nombre
       FROM paciente_enfermedades pe
       JOIN enfermedades e ON e.id = pe.enfermedad_id
      WHERE pe.paciente_id = $1
      ORDER BY ${orden('e.')}`,
    [pacienteId]
  );
  return rows.map(comoDTO);
}

export async function asignar({ pacienteId, enfermedadId, diagnosticadaEn = null }) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');

  const enfermedad = await obtenerPorId(enfermedadId);
  if (!enfermedad) throw new Error('Enfermedad fuera del catálogo');

  await query(
    `INSERT INTO paciente_enfermedades (paciente_id, enfermedad_id, diagnosticada_en)
     VALUES ($1, $2, $3)
     ON CONFLICT (paciente_id, enfermedad_id)
     DO UPDATE SET diagnosticada_en = EXCLUDED.diagnosticada_en`,
    [String(pacienteId), enfermedad.id, diagnosticadaEn]
  );
  return { pacienteId: String(pacienteId), enfermedadId: enfermedad.id, diagnosticadaEn };
}

export function __reset() {}
