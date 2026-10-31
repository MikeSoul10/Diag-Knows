/**
 * Sesiones del flujo de registro en memoria.
 *
 * Un paciente está "a medio registro" mientras dure la conversación guiada.
 * Se guarda en proceso con expiración corta (5 min) para no dejar datos
 * personales colgando si la persona abandona el chat.
 *
 * No conoce Telegraf: recibe y devuelve objetos simples.
 */

const TTL_MS = 5 * 60 * 1000;

/** @type {Map<string, {paso:string, datos:object, actualizadoEn:number}>} */
const sesiones = new Map();

function clave(chatId) {
  if (chatId === undefined || chatId === null || chatId === '') {
    throw new Error('chatId es obligatorio');
  }
  return String(chatId);
}

export function obtener(chatId) {
  const id = clave(chatId);
  const sesion = sesiones.get(id);
  if (!sesion) return null;

  if (Date.now() - sesion.actualizadoEn > TTL_MS) {
    sesiones.delete(id);
    return null;
  }
  return sesion;
}

export function guardar(chatId, sesion) {
  const id = clave(chatId);
  const actualizada = { ...sesion, actualizadoEn: Date.now() };
  sesiones.set(id, actualizada);
  return actualizada;
}

export function borrar(chatId) {
  return sesiones.delete(clave(chatId));
}

export function existe(chatId) {
  return obtener(chatId) !== null;
}

/** Limpieza oportunista para que el Map no crezca sin control. */
export function limpiarExpiradas(ahora = Date.now()) {
  for (const [id, sesion] of sesiones) {
    if (ahora - sesion.actualizadoEn > TTL_MS) sesiones.delete(id);
  }
}

export function __reset() {
  sesiones.clear();
}

export const TTL_MINUTOS = TTL_MS / 60000;
