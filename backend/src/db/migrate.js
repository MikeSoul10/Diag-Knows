/**
 * Aplica el esquema base y las migraciones pendientes (DK-103).
 *
 *   npm run db:migrate          → schema.sql (si no existe `pacientes`) + migrations/*.sql
 *   npm run db:seed             → lo anterior + seed.sql (datos ficticios; bloqueado en producción)
 *
 * Cada migración corre en su propia transacción y queda anotada en
 * `schema_migraciones`, así que correrlo dos veces no repite nada.
 *
 * Lo ejecuta el dueño del esquema, no el rol de la aplicación (que no tiene
 * permisos de CREATE/ALTER; ver roles.sql).
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cargarEntorno } from '../config/env.js';
import { cerrarPool, enTransaccion, query } from './pool.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const DIR_MIGRACIONES = join(DIR, 'migrations');

async function existeTabla(nombre) {
  const { rows } = await query('SELECT to_regclass($1) IS NOT NULL AS existe', [
    `public.${nombre}`,
  ]);
  return rows[0].existe;
}

async function ejecutarArchivo(ruta, alTerminar) {
  const sql = await readFile(ruta, 'utf8');
  await enTransaccion(async (cliente) => {
    await cliente.query(sql);
    if (alTerminar) await alTerminar(cliente);
  });
}

export async function migrar({ log = console.log } = {}) {
  if (!(await existeTabla('pacientes'))) {
    log('Aplicando schema.sql');
    await ejecutarArchivo(join(DIR, 'schema.sql'));
  }

  await query(`CREATE TABLE IF NOT EXISTS schema_migraciones (
    nombre      VARCHAR(200) PRIMARY KEY,
    aplicada_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const { rows } = await query('SELECT nombre FROM schema_migraciones');
  const aplicadas = new Set(rows.map((fila) => fila.nombre));

  const archivos = (await readdir(DIR_MIGRACIONES)).filter((f) => f.endsWith('.sql')).sort();

  const nuevas = [];
  for (const archivo of archivos) {
    if (aplicadas.has(archivo)) continue;
    log(`Aplicando ${archivo}`);
    await ejecutarArchivo(join(DIR_MIGRACIONES, archivo), (cliente) =>
      cliente.query('INSERT INTO schema_migraciones (nombre) VALUES ($1)', [archivo])
    );
    nuevas.push(archivo);
  }

  if (nuevas.length === 0) log('El esquema ya está al día.');
  return nuevas;
}

export async function sembrar({ log = console.log } = {}) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed.sql tiene datos ficticios: no se ejecuta con NODE_ENV=production.');
  }
  log('Aplicando seed.sql');
  await ejecutarArchivo(join(DIR, 'seed.sql'));
}

const esPrincipal = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (esPrincipal) {
  cargarEntorno();
  try {
    await migrar();
    if (process.argv.includes('--seed')) await sembrar();
  } catch (err) {
    console.error('Falló la migración:', err.message);
    process.exitCode = 1;
  } finally {
    await cerrarPool();
  }
}
