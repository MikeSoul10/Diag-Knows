/**
 * Verificación de la conexión a PostgreSQL para GET /health (DK-102).
 * Devuelve 'ok' o lanza; nunca expone la cadena de conexión ni el error.
 */

import { query } from '../db/pool.js';

export async function verificarBaseDatos({ timeoutMs = 2_000 } = {}) {
  let temporizador;
  const limite = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error('timeout')), timeoutMs);
  });
  try {
    await Promise.race([query('SELECT 1'), limite]);
    return 'ok';
  } finally {
    clearTimeout(temporizador);
  }
}
