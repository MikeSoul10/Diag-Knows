/**
 * Repositorio PostgreSQL de `mediciones` (DK-103, DK-203).
 *
 * Misma interfaz y DTO que `mocks/mediciones.mock.js`:
 *   { id, pacienteId, tipo, valor, valor2, unidad, esCritica, medidaEn }
 *
 * - El valor se cifra EN SQL con pgp_sym_encrypt(..., 'cipher-algo=aes256') en
 *   `valor_cifrado` y se descifra con pgp_sym_decrypt al leer. La llave viaja
 *   como parámetro (ver limitación de logs de PostgreSQL en AGENTS.md §7.1).
 * - Se guarda como texto: "115", "72.5" o "120/80" para la presión.
 * - `tipo` se mapea entre el vocabulario de la app y el de la columna.
 * - `esCritica` siempre FALSE mientras los umbrales clínicos sigan en null.
 * - Nunca se registran valores en logs.
 */

import { query } from '../db/pool.js';
import { aIsoUtc, llaveCifrado, OPCIONES_PGP } from './cifrado.js';

export const TIPOS = Object.freeze(['glucosa', 'presion', 'peso']);

const A_COLUMNA = Object.freeze({
  glucosa: 'GLUCOSA',
  presion: 'PRESION_ARTERIAL',
  peso: 'PESO',
});
const DE_COLUMNA = Object.freeze(
  Object.fromEntries(Object.entries(A_COLUMNA).map(([app, columna]) => [columna, app]))
);

const UNIDADES = Object.freeze({ glucosa: 'mg/dL', presion: 'mmHg', peso: 'kg' });

function validarPacienteId(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  return String(pacienteId);
}

function validarNumero(valor, campo) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw new Error(`${campo} debe ser un número finito`);
  }
  return valor;
}

function comoDTO(fila) {
  const tipo = DE_COLUMNA[fila.tipo_medicion] ?? fila.tipo_medicion;
  const [valor, valor2] = String(fila.valor).split('/');
  return {
    id: fila.id,
    pacienteId: fila.paciente_id,
    tipo,
    valor: Number(valor),
    valor2: valor2 === undefined ? null : Number(valor2),
    unidad: fila.unidad,
    esCritica: fila.es_critica,
    medidaEn: fila.registrada_en,
  };
}

export async function guardarMedicion({
  pacienteId,
  tipo,
  valor,
  valor2 = null,
  unidad,
  medidaEn,
} = {}) {
  const idPaciente = validarPacienteId(pacienteId);
  if (!TIPOS.includes(tipo)) throw new Error(`Tipo de medición inválido: ${tipo}`);

  validarNumero(valor, 'valor');
  const texto = tipo === 'presion' ? `${valor}/${validarNumero(valor2, 'valor2')}` : String(valor);

  const { rows } = await query(
    `INSERT INTO mediciones (paciente_id, tipo_medicion, valor_cifrado, unidad, es_critica, registrada_en)
     VALUES ($1, $2, pgp_sym_encrypt($3::text, $4::text, '${OPCIONES_PGP}'), $5, FALSE,
             COALESCE($6::timestamp, CURRENT_TIMESTAMP))
     RETURNING id, paciente_id, tipo_medicion, $3::text AS valor, unidad, es_critica, registrada_en`,
    [
      idPaciente,
      A_COLUMNA[tipo],
      texto,
      llaveCifrado(),
      unidad ? String(unidad) : UNIDADES[tipo],
      aIsoUtc(medidaEn),
    ]
  );
  return comoDTO(rows[0]);
}

export async function listarPorPaciente(pacienteId) {
  const { rows } = await query(
    `SELECT id, paciente_id, tipo_medicion, pgp_sym_decrypt(valor_cifrado, $2::text) AS valor,
            unidad, es_critica, registrada_en
       FROM mediciones
      WHERE paciente_id = $1
      ORDER BY registrada_en, id`,
    [validarPacienteId(pacienteId), llaveCifrado()]
  );
  return rows.map(comoDTO);
}

/** Mediciones en [desde, hasta), para el historial (DK-301). */
export async function listarPorRango(pacienteId, desde, hasta) {
  const { rows } = await query(
    `SELECT id, paciente_id, tipo_medicion, pgp_sym_decrypt(valor_cifrado, $4::text) AS valor,
            unidad, es_critica, registrada_en
       FROM mediciones
      WHERE paciente_id = $1 AND registrada_en >= $2 AND registrada_en < $3
      ORDER BY registrada_en, id`,
    [validarPacienteId(pacienteId), aIsoUtc(desde), aIsoUtc(hasta), llaveCifrado()]
  );
  return rows.map(comoDTO);
}

export function __reset() {}
