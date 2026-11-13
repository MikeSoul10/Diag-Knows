/**
 * Repositorio PostgreSQL de `horarios_medicamento` (DK-302).
 *
 * Misma interfaz y DTO que `mocks/horarios.mock.js`:
 *   crear({ medicamentoId, horaProgramada }) -> horario
 *   listarPorPaciente(pacienteId) -> horarios activos con el nombre del medicamento
 *   listarParaRecordatorio() -> horarios que pueden generar un recordatorio hoy
 *
 * DTO de horario: { id, medicamentoId, horaProgramada: 'HH:MM', activo }
 * `horaProgramada` es hora LOCAL del paciente (`pacientes.zona_horaria`).
 */

import { query } from '../db/pool.js';

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validarHora(hora) {
  const texto = String(hora ?? '').trim();
  if (!HORA_RE.test(texto)) throw new Error('horaProgramada debe tener el formato HH:MM');
  return texto;
}

function comoDTO(fila) {
  return {
    id: fila.id,
    medicamentoId: fila.medicamento_id,
    horaProgramada: fila.hora,
    activo: fila.activo,
  };
}

export async function crear({ medicamentoId, horaProgramada } = {}) {
  if (!medicamentoId) throw new Error('medicamentoId es obligatorio');
  const { rows } = await query(
    `INSERT INTO horarios_medicamento (medicamento_id, hora_programada)
     VALUES ($1, $2::time)
     RETURNING id, medicamento_id, to_char(hora_programada, 'HH24:MI') AS hora, activo`,
    [String(medicamentoId), validarHora(horaProgramada)]
  );
  return comoDTO(rows[0]);
}

/** Horarios activos del paciente con su medicamento, ordenados por hora. */
export async function listarPorPaciente(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  const { rows } = await query(
    `SELECT h.id, h.medicamento_id, to_char(h.hora_programada, 'HH24:MI') AS hora, h.activo,
            m.nombre AS medicamento_nombre, m.dosis
       FROM horarios_medicamento h
       JOIN medicamentos m ON m.id = h.medicamento_id
      WHERE m.paciente_id = $1 AND h.activo
      ORDER BY h.hora_programada, m.nombre`,
    [String(pacienteId)]
  );
  return rows.map((fila) => ({
    ...comoDTO(fila),
    medicamentoNombre: fila.medicamento_nombre,
    dosis: fila.dosis,
  }));
}

/**
 * Horarios que pueden disparar un recordatorio: horario activo, medicamento
 * vigente, paciente ACTIVO y con consentimiento vigente. Cuál toca "ahora" lo
 * decide el servicio con la zona horaria de cada paciente.
 */
export async function listarParaRecordatorio() {
  const { rows } = await query(
    `SELECT h.id AS horario_id, to_char(h.hora_programada, 'HH24:MI') AS hora,
            m.id AS medicamento_id, m.nombre AS medicamento_nombre, m.dosis,
            p.id AS paciente_id, p.telegram_chat_id, p.zona_horaria
       FROM horarios_medicamento h
       JOIN medicamentos m ON m.id = h.medicamento_id
       JOIN pacientes p    ON p.id = m.paciente_id
      WHERE h.activo
        AND p.estado = 'ACTIVO'
        AND m.fecha_inicio <= CURRENT_DATE
        AND (m.fecha_fin IS NULL OR m.fecha_fin >= CURRENT_DATE)
        AND COALESCE((SELECT rc.aceptado
                        FROM registros_consentimiento rc
                       WHERE rc.paciente_id = p.id
                       ORDER BY rc.aceptado_en DESC, rc.ctid DESC
                       LIMIT 1), FALSE)`
  );
  return rows.map((fila) => ({
    horarioId: fila.horario_id,
    horaProgramada: fila.hora,
    medicamentoId: fila.medicamento_id,
    medicamentoNombre: fila.medicamento_nombre,
    dosis: fila.dosis,
    pacienteId: fila.paciente_id,
    telegramChatId: String(fila.telegram_chat_id),
    zonaHoraria: fila.zona_horaria,
  }));
}

export function __reset() {}
