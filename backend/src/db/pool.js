/**
 * Pool de conexiones a PostgreSQL (DK-103).
 *
 * Se crea de forma perezosa: en modo mock (USE_MOCK_REPOS=true) nunca se abre
 * una conexión y las pruebas no necesitan BD.
 *
 * Convenciones de fechas:
 *   - La sesión corre en UTC (`timezone=UTC`). Las columnas son TIMESTAMP sin
 *     zona, así que todo lo que se guarda y se lee está en UTC.
 *   - TIMESTAMP se lee como ISO UTC (`...Z`) y DATE como texto `YYYY-MM-DD`,
 *     igual que los DTO de los mocks.
 *   - Al escribir, los repositorios pasan `Date#toISOString()`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import pg from 'pg';

const TIMESTAMP_OID = 1114;
const DATE_OID = 1082;

pg.types.setTypeParser(TIMESTAMP_OID, (valor) =>
  valor === null ? null : new Date(`${valor.replace(' ', 'T')}Z`).toISOString()
);
pg.types.setTypeParser(DATE_OID, (valor) => valor);

let pool = null;

/** Cliente de la transacción en curso (si la hay) para el flujo async actual. */
const transaccionActual = new AsyncLocalStorage();

export function configuracionPool(env = process.env) {
  const connectionString = (env.DATABASE_URL || '').trim();
  if (!connectionString) {
    throw new Error('Falta DATABASE_URL. Configúrala en .env o usa USE_MOCK_REPOS=true.');
  }
  return {
    connectionString,
    ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    options: '-c timezone=UTC',
  };
}

export function obtenerPool() {
  if (!pool) {
    pool = new pg.Pool(configuracionPool());
    // Un cliente inactivo que pierde la conexión no debe tumbar el proceso.
    // No se imprime el error completo: puede incluir parámetros de la consulta.
    pool.on('error', (err) => console.error('Error en conexión inactiva de PostgreSQL:', err.code));
  }
  return pool;
}

/**
 * Atajo para consultas parametrizadas: `query('SELECT ... $1', [valor])`.
 * Dentro de `enTransaccion` usa automáticamente el cliente de la transacción,
 * así los repositorios no necesitan recibirlo como parámetro.
 */
export function query(texto, parametros = []) {
  const cliente = transaccionActual.getStore();
  return (cliente ?? obtenerPool()).query(texto, parametros);
}

/**
 * Ejecuta `fn(cliente)` dentro de una transacción; hace ROLLBACK si falla.
 * Toda llamada a `query()` hecha dentro de `fn` (aunque sea en otro módulo)
 * usa la misma transacción. Si ya hay una en curso, se reutiliza.
 */
export async function enTransaccion(fn) {
  const enCurso = transaccionActual.getStore();
  if (enCurso) return fn(enCurso);

  const cliente = await obtenerPool().connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await transaccionActual.run(cliente, () => fn(cliente));
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

export async function cerrarPool() {
  if (pool) {
    const actual = pool;
    pool = null;
    await actual.end();
  }
}
