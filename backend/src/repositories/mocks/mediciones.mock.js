/**
 * Mock en memoria de `mediciones`.
 *
 * Misma interfaz que tendrá `src/repositories/mediciones.repo.js`:
 *   guardarMedicion({ pacienteId, tipo, valor, valor2, unidad, medidaEn, esCritica, mensajeId }) -> medicion
 *   listarPorPaciente(pacienteId) -> mediciones
 *   __reset()
 *
 * Contrato del DTO (idéntico al que debe devolver el repo real):
 *   { id, pacienteId, tipo, valor, valor2, unidad, esCritica, medidaEn, mensajeId }
 *
 * `tipo` viaja en el vocabulario de la app ('glucosa' | 'presion' | 'peso'); el
 * repo real lo mapea a las columnas de PostgreSQL ('GLUCOSA',
 * 'PRESION_ARTERIAL', 'PESO'). Allá el valor se guarda cifrado con
 * `pgp_sym_encrypt(..., 'cipher-algo=aes256')` en `valor_cifrado`; aquí vive
 * solo en memoria y NUNCA se escribe en logs.
 *
 * `esCritica` llega del servicio, calculado con `config/thresholds.js`; mientras
 * los umbrales clínicos sigan en `null` siempre es FALSE.
 */

import { randomUUID } from 'node:crypto';

export const TIPOS = Object.freeze(['glucosa', 'presion', 'peso']);

const UNIDADES = Object.freeze({
  glucosa: 'mg/dL',
  presion: 'mmHg',
  peso: 'kg',
});

/** @type {Map<string, Array<object>>} pacienteId -> filas en orden de registro */
const porPaciente = new Map();

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
  return {
    id: fila.id,
    pacienteId: fila.pacienteId,
    tipo: fila.tipo,
    valor: fila.valor,
    valor2: fila.valor2,
    unidad: fila.unidad,
    esCritica: fila.esCritica,
    medidaEn: fila.medidaEn,
    mensajeId: fila.mensajeId,
  };
}

export async function guardarMedicion({
  pacienteId,
  tipo,
  valor,
  valor2 = null,
  unidad,
  medidaEn,
  esCritica = false,
  mensajeId = null,
} = {}) {
  const idPaciente = validarPacienteId(pacienteId);

  if (!TIPOS.includes(tipo)) {
    throw new Error(`Tipo de medición inválido: ${tipo}`);
  }

  const fila = {
    id: randomUUID(),
    pacienteId: idPaciente,
    tipo,
    valor: validarNumero(valor, 'valor'),
    valor2: tipo === 'presion' ? validarNumero(valor2, 'valor2') : null,
    unidad: unidad ? String(unidad) : UNIDADES[tipo],
    // Lo decide el servicio con config/thresholds.js (false mientras sean null).
    esCritica: esCritica === true,
    medidaEn: medidaEn ? new Date(medidaEn).toISOString() : new Date().toISOString(),
    mensajeId: mensajeId ? String(mensajeId) : null,
  };

  if (!porPaciente.has(idPaciente)) porPaciente.set(idPaciente, []);
  porPaciente.get(idPaciente).push(fila);

  return comoDTO(fila);
}

export async function listarPorPaciente(pacienteId) {
  const filas = porPaciente.get(validarPacienteId(pacienteId)) ?? [];
  return filas.map(comoDTO);
}

/** Filas con `medidaEn` en [desde, hasta), para el historial (DK-301). */
export async function listarPorRango(pacienteId, desde, hasta) {
  const inicio = new Date(desde).getTime();
  const fin = new Date(hasta).getTime();
  return (await listarPorPaciente(pacienteId)).filter((fila) => {
    const momento = new Date(fila.medidaEn).getTime();
    return momento >= inicio && momento < fin;
  });
}

/** Borra todas las filas del paciente (`/borrar_datos`, DK-303). Devuelve cuántas. */
export async function eliminarPorPaciente(pacienteId) {
  const clave = String(pacienteId ?? '');
  const cantidad = porPaciente.get(clave)?.length ?? 0;
  porPaciente.delete(clave);
  return cantidad;
}

export function __reset() {
  porPaciente.clear();
}
