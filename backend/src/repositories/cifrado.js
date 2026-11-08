/**
 * Llave de cifrado para pgp_sym_encrypt / pgp_sym_decrypt (AES-256).
 *
 * Solo la usan los repositorios: el cifrado ocurre en SQL, nunca en Node, y la
 * llave nunca sale de esta capa. Se lee en cada uso (no al importar) para que
 * el modo mock no exija ENCRYPTION_KEY.
 */

export const OPCIONES_PGP = 'cipher-algo=aes256';

export function llaveCifrado(env = process.env) {
  const llave = (env.ENCRYPTION_KEY || '').trim();
  if (!llave) {
    throw new Error('Falta ENCRYPTION_KEY: no se pueden cifrar ni descifrar datos del paciente.');
  }
  if (llave.length < 32) {
    throw new Error('ENCRYPTION_KEY es demasiado corta (mínimo 32 caracteres).');
  }
  return llave;
}

/** Convierte cualquier fecha aceptada por `Date` a ISO UTC; `null` si no viene. */
export function aIsoUtc(fecha) {
  if (fecha === undefined || fecha === null || fecha === '') return null;
  const valor = new Date(fecha);
  if (Number.isNaN(valor.getTime())) throw new Error('Fecha inválida');
  return valor.toISOString();
}
