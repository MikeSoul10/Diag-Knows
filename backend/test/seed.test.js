/**
 * Guard de `seed.sql` (hallazgo #4).
 *
 * Los datos ficticios exigen NODE_ENV != production **y** ALLOW_SEED=true.
 * El guard lanza antes de leer seed.sql, así que estas pruebas no tocan la BD.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { puedeSembrar, sembrar } from '../src/db/migrate.js';

describe('guard de seed.sql', () => {
  test('sin ALLOW_SEED rechaza y dice cómo habilitarlo', async () => {
    await assert.rejects(() => sembrar({ log: () => {}, entorno: 'development', permitir: '' }), {
      message: /ALLOW_SEED/,
    });
  });

  test('NODE_ENV=production gana aunque ALLOW_SEED=true', async () => {
    await assert.rejects(
      () => sembrar({ log: () => {}, entorno: 'production', permitir: 'true' }),
      { message: /production/ }
    );
  });

  test('en desarrollo con ALLOW_SEED=true el guard no lanza', () => {
    assert.doesNotThrow(() => puedeSembrar('development', 'true'));
    assert.doesNotThrow(() => puedeSembrar('test', ' TRUE '));
  });

  test('cualquier otro valor de ALLOW_SEED no habilita el seed', () => {
    for (const bandera of [undefined, null, 'false', '1', 'si']) {
      assert.throws(() => puedeSembrar('development', bandera), { message: /ALLOW_SEED/ });
    }
  });
});
