/**
 * Repositorio PostgreSQL de `resumenes_semanales` (DK-302).
 *
 * Misma interfaz y DTO que `mocks/resumenes.mock.js`:
 *   calcularAdherencia({ pacienteId, desde, hasta }) -> { porcentaje, tomadas, esperadas }
 *   crear({ pacienteId, semanaInicio, porcentajeAdherencia, texto }) -> resumen | null
 *   listarPorPaciente(pacienteId) -> resúmenes (texto descifrado)
 *   listarCandidatos() -> pacientes ACTIVO con consentimiento vigente
 *   __reset()
 *
 * El texto se cifra EN SQL con pgp_sym_encrypt(..., 'cipher-algo=aes256').
 * La migración 002 ya trae `UNIQUE (paciente_id, semana_inicio)`, así que
 * `crear()` es idempotente con ON CONFLICT ... DO NOTHING.
 */

import { query } from '../db/pool.js';
import { aIsoUtc, llaveCifrado, OPCIONES_PGP } from './cifrado.js';

const SEMANA_RE = /^\d{4}-\d{2}-\d{2}$/;

function validarPacienteId(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  return String(pacienteId);
}

function validarSemana(semanaInicio) {
  const texto = String(semanaInicio ?? '').slice(0, 10);
  if (!SEMANA_RE.test(texto)) throw new Error('semanaInicio debe tener el formato YYYY-MM-DD');
  return texto;
}

function comoDTO(fila) {
  if (!fila) return null;
  const dto = {
    id: fila.id,
    pacienteId: fila.paciente_id,
    semanaInicio: fila.semana_inicio,
    porcentajeAdherencia:
      fila.porcentaje_adherencia === null || fila.porcentaje_adherencia === undefined
        ? null
        : Number(fila.porcentaje_adherencia),
    enviadoEn: fila.enviado_en,
  };
  if (fila.texto !== undefined) dto.texto = fila.texto;
  return dto;
}

/**
 * Adherencia de la ventana [desde, hasta): TOMADA / (TOMADA + SALTADA + OMITIDA).
 * Las dosis PENDIENTE no cuentan (todavía no hay respuesta).
 */
export async function calcularAdherencia({ pacienteId, desde, hasta } = {}) {
  const { rows } = await query(
    `SELECT ROUND(
              100.0 * COUNT(*) FILTER (WHERE estado = 'TOMADA')
              / NULLIF(COUNT(*) FILTER (WHERE estado <> 'PENDIENTE'), 0)
            , 2) AS porcentaje,
            COUNT(*) FILTER (WHERE estado = 'TOMADA')     AS tomadas,
            COUNT(*) FILTER (WHERE estado <> 'PENDIENTE') AS esperadas
       FROM registros_dosis
      WHERE paciente_id = $1
        AND programada_en >= $2::timestamp
        AND programada_en <  $3::timestamp`,
    [validarPacienteId(pacienteId), aIsoUtc(desde), aIsoUtc(hasta)]
  );

  const fila = rows[0] ?? {};
  return {
    porcentaje:
      fila.porcentaje === null || fila.porcentaje === undefined ? 0 : Number(fila.porcentaje),
    tomadas: Number(fila.tomadas ?? 0),
    esperadas: Number(fila.esperadas ?? 0),
  };
}

/** `null` si ese paciente ya tenía resumen para esa semana (idempotente). */
export async function crear({ pacienteId, semanaInicio, porcentajeAdherencia = null, texto } = {}) {
  const idPaciente = validarPacienteId(pacienteId);
  const semana = validarSemana(semanaInicio);
  const contenido = typeof texto === 'string' ? texto.trim() : '';
  if (!contenido) throw new Error('texto es obligatorio');

  const { rows } = await query(
    `INSERT INTO resumenes_semanales
       (paciente_id, semana_inicio, porcentaje_adherencia, texto_cifrado)
     VALUES ($1, $2::date, $3, pgp_sym_encrypt($4::text, $5::text, '${OPCIONES_PGP}'))
     ON CONFLICT (paciente_id, semana_inicio) DO NOTHING
     RETURNING id, paciente_id, semana_inicio, porcentaje_adherencia, enviado_en`,
    [
      idPaciente,
      semana,
      porcentajeAdherencia === null || porcentajeAdherencia === undefined
        ? null
        : Number(porcentajeAdherencia),
      contenido,
      llaveCifrado(),
    ]
  );
  return comoDTO(rows[0]);
}

export async function listarPorPaciente(pacienteId) {
  const { rows } = await query(
    `SELECT id, paciente_id, semana_inicio, porcentaje_adherencia,
            pgp_sym_decrypt(texto_cifrado, $2::text) AS texto, enviado_en
       FROM resumenes_semanales
      WHERE paciente_id = $1
      ORDER BY semana_inicio, id`,
    [validarPacienteId(pacienteId), llaveCifrado()]
  );
  return rows.map(comoDTO);
}

/** Pacientes ACTIVO con consentimiento vigente (mismo criterio que horarios). */
export async function listarCandidatos() {
  const { rows } = await query(
    `SELECT p.id, p.telegram_chat_id, p.zona_horaria, p.alias
       FROM pacientes p
      WHERE p.estado = 'ACTIVO'
        AND COALESCE((SELECT rc.aceptado
                        FROM registros_consentimiento rc
                       WHERE rc.paciente_id = p.id
                       ORDER BY rc.aceptado_en DESC, rc.ctid DESC
                       LIMIT 1), FALSE)`
  );
  return rows.map((fila) => ({
    id: fila.id,
    telegramChatId: String(fila.telegram_chat_id),
    zonaHoraria: fila.zona_horaria,
    alias: fila.alias,
  }));
}

export function __reset() {}
