/** En modo mock no hay BD que verificar: /health reporta `db: "mock"`. */
export async function verificarBaseDatos() {
  return 'mock';
}

export function __reset() {}
