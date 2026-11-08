/**
 * Estado de la aplicación para GET /health (DK-102).
 *
 * Solo dice si la app y la BD responden. Nunca incluye mensajes de error,
 * cadenas de conexión ni versiones: el endpoint es público en producción.
 */

import { salud } from '../repositories/index.js';

/**
 * @returns {Promise<{ codigoHttp: number, cuerpo: { status: 'ok'|'error', db: 'ok'|'mock'|'error' } }>}
 */
export async function estadoSalud({ registrarError = () => {} } = {}) {
  try {
    const db = await salud.verificarBaseDatos();
    return { codigoHttp: 200, cuerpo: { status: 'ok', db } };
  } catch (err) {
    registrarError(err);
    return { codigoHttp: 503, cuerpo: { status: 'error', db: 'error' } };
  }
}
