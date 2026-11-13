/**
 * Estado de la aplicación para GET /health (DK-102).
 *
 * Solo dice si la app responde. Nunca incluye el adaptador activo (mock o
 * PostgreSQL), mensajes de error, cadenas de conexión ni versiones: el
 * endpoint es público en producción (hallazgo #11).
 */

import { salud } from '../repositories/index.js';

/**
 * @returns {Promise<{ codigoHttp: number, cuerpo: { status: 'ok'|'error' } }>}
 */
export async function estadoSalud({ registrarError = () => {} } = {}) {
  try {
    await salud.verificarBaseDatos();
    return { codigoHttp: 200, cuerpo: { status: 'ok' } };
  } catch (err) {
    registrarError(err);
    return { codigoHttp: 503, cuerpo: { status: 'error' } };
  }
}
