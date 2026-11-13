/**
 * Guardia de las pruebas de integración (hallazgo #10).
 *
 * Vive en un helper puro para poder probarla sin PostgreSQL. La regla es
 * simple: la suite destructiva (TRUNCATE) nunca corre en producción y solo
 * acepta bases cuyo nombre contenga "test".
 *
 * @param {string|undefined} url  TEST_DATABASE_URL
 * @param {string|undefined} entorno  NODE_ENV
 * @returns {{ omitir: boolean, motivo?: string }}
 */
export function evaluarGuardia(url, entorno = process.env.NODE_ENV) {
  if (entorno === 'production') {
    throw new Error('Las pruebas de integración no se ejecutan con NODE_ENV=production.');
  }
  if (!url) return { omitir: true, motivo: 'TEST_DATABASE_URL no está definida' };

  const u = new URL(url);
  const base = u.pathname.replace(/^\//, '');
  if (/prod|production|piloto/i.test(base) || /prod|production|piloto/i.test(u.hostname)) {
    throw new Error(`La BD "${base}" parece de producción: se rechaza la prueba destructiva.`);
  }
  if (!/test/i.test(base)) {
    return { omitir: true, motivo: `la BD "${base}" no parece de pruebas` };
  }
  return { omitir: false };
}
