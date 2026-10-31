/**
 * Mock en memoria de `mediciones`.
 *
 * Misma interfaz que tendrá `src/repositories/mediciones.repo.js`:
 *   guardarMedicion({ pacienteId, tipo, valor, valor2, unidad, medidaEn }) -> medicion
 *   listarPorPaciente(pacienteId) -> mediciones
 *   __reset()
 *
 * Contrato del DTO (idéntico al que debe devolver el repo real):
 *   { id, pacienteId, tipo, valor, valor2, unidad, esCritica, medidaEn }
 *
 * `tipo` viaja en el vocabulario de la app ('glucosa' | 'presion' | 'peso'); el
 * repo real lo mapea a las columnas de PostgreSQL ('GLUCOSA',
 * 'PRESION_ARTERIAL', 'PESO'). Allá el valor se guarda cifrado con
 * `pgp_sym_encrypt(..., 'cipher-algo=aes256')` en `valor_cifrado`; aquí vive
 * solo en memoria y NUNCA se escribe en logs.
 *
 * `esCritica` siempre FALSE: los umbrales clínicos siguen en `null`
 * (`config/thresholds.js`) y las alertas son del Sprint 4.
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
    // Pendiente de umbrales clínicos validados (Sprint 4).
    esCritica: false,
    medidaEn: medidaEn ? new Date(medidaEn).toISOString() : new Date().toISOString(),
  };

  if (!porPaciente.has(idPaciente)) porPaciente.set(idPaciente, []);
  porPaciente.get(idPaciente).push(fila);

  return comoDTO(fila);
}

export async function listarPorPaciente(pacienteId) {
  const filas = porPaciente.get(validarPacienteId(pacienteId)) ?? [];
  return filas.map(comoDTO);
}

export function __reset() {
  porPaciente.clear();
}
