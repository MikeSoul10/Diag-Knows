/**
 * Instancia de la conversación de seguimiento para el canal Telegram.
 *
 * Aquí se enchufan las implementaciones concretas: los repositorios de
 * `repositories/index.js`, el extractor (mock o Claude según `.env`), el
 * anonimizador y el validador. El servicio (`services/conversacion.js`) recibe
 * todo por inyección y no sabe de dónde viene.
 *
 * Pasar a Claude o a PostgreSQL debe implicar cambiar solo esas dos
 * implementaciones, no este archivo ni los handlers.
 */

import { randomBytes } from 'node:crypto';

import {
  patients,
  mediciones,
  sintomas,
  medicamentos,
  dosisLogs,
} from '../repositories/index.js';
import { extraer } from '../services/extractor.js';
import { anonimizar } from '../services/anonimizador.js';
import { validarExtraccion } from '../services/validador.js';
import {
  TTL_MINUTOS,
  crearAlmacenMemoria,
  crearServicioConversacion,
} from '../services/conversacion.js';

/**
 * Token de los botones: 32 caracteres hex (16 bytes al azar).
 *
 * Los `callback_data` quedan holgados por debajo del límite de 64 bytes de
 * Telegram: `conv:skip:` + 32 = 42, `sev:` + 32 + `:0:3` = 40.
 */
export function generarTokenConversacion() {
  return randomBytes(16).toString('hex');
}

/**
 * Construye el servicio con las dependencias reales.
 *
 * @param {object} [opciones]
 * @param {object} [opciones.almacen] Almacén de estados por chat.
 * @param {() => Date} [opciones.ahora] Reloj inyectable (pruebas de expiración).
 * @param {() => string} [opciones.generarToken] Tokens de los botones.
 * @param {(contexto: string, error: Error) => void} [opciones.registrarError]
 */
export function crearConversacion({
  almacen,
  ahora,
  generarToken = generarTokenConversacion,
  registrarError,
} = {}) {
  return crearServicioConversacion({
    repos: { patients, mediciones, sintomas, medicamentos, dosisLogs },
    extractor: { extraer },
    anonimizar,
    validar: validarExtraccion,
    almacenEstado: almacen ?? crearAlmacenMemoria(),
    ahora,
    generarToken,
    registrarError,
  });
}

/** Almacén compartido por la instancia del bot (y consultable por `/cancelar`). */
export const almacenConversacion = crearAlmacenMemoria();

/** Instancia única que usan los handlers del canal. */
export const conversacion = crearConversacion({ almacen: almacenConversacion });

/**
 * ¿Hay algo a medio reportar en este chat?
 *
 * Se respeta la misma expiración que el servicio para no decirle al paciente
 * que descartamos algo que ya había caducado.
 */
export function hayConversacionPendiente(chatId, ahoraMs = Date.now()) {
  const estado = almacenConversacion.obtener(chatId);
  if (!estado) return false;
  return ahoraMs - estado.actualizadoEn <= TTL_MINUTOS * 60 * 1000;
}
