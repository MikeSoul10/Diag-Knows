/**
 * Repositorio PostgreSQL de `medicamentos` (DK-103).
 *
 * Misma interfaz y DTO que `mocks/medicamentos.mock.js`:
 *   { id, pacienteId, nombre, dosis, frecuencia, fechaInicio, fechaFin }
 *
 * `fechaInicio`/`fechaFin` son DATE y se exponen como 'YYYY-MM-DD'.
 * Los datos ficticios de desarrollo viven en src/db/seed.sql, no aquí.
 */

import { query } from '../db/pool.js';

const COLUMNAS = 'id, paciente_id, nombre, dosis, frecuencia, fecha_inicio, fecha_fin';

function validarPacienteId(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  return String(pacienteId);
}

/** Minúsculas y sin acentos: "LOSARTAN" debe encontrar "Losartán". */
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function aFecha(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new Error('Fecha inválida');
  return fecha.toISOString().slice(0, 10);
}

function comoDTO(fila) {
  return {
    id: fila.id,
    pacienteId: fila.paciente_id,
    nombre: fila.nombre,
    dosis: fila.dosis,
    frecuencia: fila.frecuencia,
    fechaInicio: fila.fecha_inicio,
    fechaFin: fila.fecha_fin,
  };
}

export async function listarPorPaciente(pacienteId) {
  const { rows } = await query(
    `SELECT ${COLUMNAS} FROM medicamentos WHERE paciente_id = $1 ORDER BY fecha_inicio, nombre`,
    [validarPacienteId(pacienteId)]
  );
  return rows.map(comoDTO);
}

/**
 * Busca por nombre sin distinguir mayúsculas ni acentos; tolera que el
 * paciente diga solo una parte ("metformina" para "Metformina 850 mg").
 * La comparación se hace en Node para no depender de la extensión `unaccent`.
 */
export async function buscarPorNombre(pacienteId, nombre) {
  const buscado = normalizar(nombre);
  if (!buscado) return null;

  const medicamentos = await listarPorPaciente(pacienteId);
  return (
    medicamentos.find((m) => normalizar(m.nombre) === buscado) ??
    medicamentos.find((m) => normalizar(m.nombre).includes(buscado)) ??
    null
  );
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

  const { rows } = await query(
    `INSERT INTO medicamentos (paciente_id, nombre, dosis, frecuencia, fecha_inicio, fecha_fin)
     VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6::date)
     RETURNING ${COLUMNAS}`,
    [
      idPaciente,
      nombreLimpio,
      dosis ? String(dosis) : 'sin dosis',
      frecuencia ? String(frecuencia) : 'sin frecuencia',
      aFecha(fechaInicio),
      aFecha(fechaFin),
    ]
  );
  return comoDTO(rows[0]);
}

/** En PostgreSQL los datos ficticios se cargan con `npm run db:seed`. */
export async function sembrarDatosDesarrollo() {
  throw new Error('sembrarDatosDesarrollo solo existe en modo mock; usa npm run db:seed');
}

export function __reset() {}
