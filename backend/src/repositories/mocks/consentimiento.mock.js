/**
 * Mock en memoria de `registros_consentimiento`.
 *
 * Misma interfaz que tendrá `src/repositories/consentimiento.repo.js`:
 *   registrar({ pacienteId, aceptado, versionPrivacidad }) -> registro
 *   vigente(pacienteId) -> boolean
 *   listarPorPaciente(pacienteId) -> registros
 *   __reset()
 *
 * Regla del proyecto: un paciente tiene consentimiento vigente si su registro
 * MÁS RECIENTE tiene aceptado = TRUE (no vive en pacientes.estado).
 */

import { randomUUID } from 'node:crypto';

// El orden de inserción desempata cuando dos registros caen en el mismo milisegundo.
let secuencia = 0;

/** @type {Array<{id:string,pacienteId:string,aceptado:boolean,versionPrivacidad:string,aceptadoEn:string,_orden:number}>} */
let registros = [];

function comoDTO(fila) {
  return {
    id: fila.id,
    pacienteId: fila.pacienteId,
    aceptado: fila.aceptado,
    versionPrivacidad: fila.versionPrivacidad,
    aceptadoEn: fila.aceptadoEn,
  };
}

function validarPacienteId(pacienteId) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');
  return String(pacienteId);
}

export async function registrar({ pacienteId, aceptado, versionPrivacidad }) {
  const idPaciente = validarPacienteId(pacienteId);

  if (typeof aceptado !== 'boolean') {
    throw new Error('aceptado debe ser booleano');
  }
  if (!versionPrivacidad) {
    throw new Error('versionPrivacidad es obligatoria');
  }

  const fila = {
    id: randomUUID(),
    pacienteId: idPaciente,
    aceptado,
    versionPrivacidad: String(versionPrivacidad),
    aceptadoEn: new Date().toISOString(),
    _orden: ++secuencia,
  };

  registros.push(fila);
  return comoDTO(fila);
}

export async function vigente(pacienteId) {
  const ultimo = ultimoRegistro(pacienteId);
  return ultimo ? ultimo.aceptado : false;
}

export async function listarPorPaciente(pacienteId) {
  const idPaciente = validarPacienteId(pacienteId);
  return registros
    .filter((fila) => fila.pacienteId === idPaciente)
    .sort((a, b) => a._orden - b._orden)
    .map(comoDTO);
}

function ultimoRegistro(pacienteId) {
  const idPaciente = validarPacienteId(pacienteId);
  for (let i = registros.length - 1; i >= 0; i -= 1) {
    if (registros[i].pacienteId === idPaciente) return registros[i];
  }
  return null;
}

export function __reset() {
  registros = [];
  secuencia = 0;
}
