/**
 * En modo mock no hay BD que verificar. Devuelve `mock`, pero `/health` ya no
 * publica este valor: solo responde `status: ok/error` (hallazgo #11).
 */
export async function verificarBaseDatos() {
  return 'mock';
}

export function __reset() {}
