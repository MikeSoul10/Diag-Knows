/**
 * /tome: registrar una toma de medicamento sin pasar por el flujo de /reportar.
 *
 * No conoce Telegraf. Devuelve `{ texto, botones?, aviso?, sinConsentimiento? }`
 * con el texto en HTML de Telegram (los datos del paciente van escapados), igual
 * que `services/conversacion.js`, para que el canal use el mismo render.
 *
 *   iniciarTome({ chatId })                    -> pregunta cuál, o guarda directo
 *   registrarTome({ chatId, medicamentoId })   -> guarda la toma elegida
 *
 * Reglas:
 *   - Sin medicamentos en el catálogo: se guarda la toma "sin nombre".
 *   - Con un solo medicamento: se guarda directo, sin preguntar.
 *   - Con varios: botones; el id del botón se valida contra el catálogo del
 *     paciente, nunca se confía en el `callback_data`.
 *   - Solo registra tomas (`tomada: true`); no decide dosis ni horarios.
 */

import { medicamentos, dosisLogs } from '../repositories/index.js';
import { obtenerPacienteActivo } from './registration.service.js';
import { escaparHtml } from '../channel/format.js';

/** Valor del botón para registrar una toma sin elegir medicamento. */
export const TOME_SIN_NOMBRE = 'ninguno';

const ZONA_HORARIA = process.env.TZ || 'America/Mexico_City';

function horaLegible(fecha) {
  return fecha.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: ZONA_HORARIA,
  });
}

const SIN_CONSENTIMIENTO = Object.freeze({
  texto: 'Primero necesito que aceptes el aviso de privacidad.',
  sinConsentimiento: true,
});

async function guardar(paciente, medicamento, ahora) {
  const momento = ahora();

  await dosisLogs.guardarTomaMedicamento({
    pacienteId: paciente.id,
    medicamentoId: medicamento?.id ?? null,
    nombreReportado: medicamento?.nombre ?? null,
    tomada: true,
    tomadaEn: momento,
  });

  const que = medicamento
    ? `tu toma de <b>${escaparHtml(medicamento.nombre)}</b>`
    : 'tu toma de medicamento';

  return { texto: `Listo, registré ${que} a las ${horaLegible(momento)}.` };
}

export async function iniciarTome({ chatId, ahora = () => new Date() } = {}) {
  const paciente = await obtenerPacienteActivo(chatId);
  if (!paciente) return SIN_CONSENTIMIENTO;

  const lista = await medicamentos.listarPorPaciente(paciente.id);

  if (lista.length === 0) return guardar(paciente, null, ahora);
  if (lista.length === 1) return guardar(paciente, lista[0], ahora);

  const filas = lista.map((medicamento) => [
    { texto: medicamento.nombre, callback: `tome:${medicamento.id}` },
  ]);
  filas.push([{ texto: 'Otro / no sé el nombre', callback: `tome:${TOME_SIN_NOMBRE}` }]);

  return { texto: '¿Cuál medicamento tomaste?', botones: filas };
}

export async function registrarTome({ chatId, medicamentoId, ahora = () => new Date() } = {}) {
  const paciente = await obtenerPacienteActivo(chatId);
  if (!paciente) return SIN_CONSENTIMIENTO;

  if (medicamentoId === TOME_SIN_NOMBRE) return guardar(paciente, null, ahora);

  const lista = await medicamentos.listarPorPaciente(paciente.id);
  const elegido = lista.find((medicamento) => medicamento.id === medicamentoId);

  if (!elegido) {
    return {
      texto: 'Ese botón ya no está vigente. Escribe /tome para intentarlo de nuevo.',
      aviso: 'Ya no está vigente',
    };
  }

  return guardar(paciente, elegido, ahora);
}
