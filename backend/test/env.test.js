/**
 * Guard de arranque (hallazgo #7): producción no puede caer al modo mock.
 *
 * Se prueba la función pura con un `env` inyectado; no depende de la BD ni
 * de las variables reales del proceso.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { validarEntorno } from '../src/config/env.js';

describe('validarEntorno', () => {
  test('producción sin DATABASE_URL lanza', () => {
    assert.throws(() => validarEntorno({ env: { NODE_ENV: 'production' } }), {
      message: /DATABASE_URL/,
    });
  });

  test('producción con DATABASE_URL y sin USE_MOCK_REPOS pasa', () => {
    assert.doesNotThrow(() =>
      validarEntorno({
        env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://user:pass@db:5432/diag' },
      })
    );
    assert.doesNotThrow(() =>
      validarEntorno({
        env: {
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://user:pass@db:5432/diag',
          USE_MOCK_REPOS: 'false',
        },
      })
    );
  });

  test('producción con USE_MOCK_REPOS=true lanza aunque haya DATABASE_URL', () => {
    assert.throws(
      () =>
        validarEntorno({
          env: {
            NODE_ENV: 'production',
            DATABASE_URL: 'postgres://user:pass@db:5432/diag',
            USE_MOCK_REPOS: ' TRUE ',
          },
        }),
      { message: /USE_MOCK_REPOS/ }
    );
  });

  test('desarrollo sin DATABASE_URL pasa', () => {
    assert.doesNotThrow(() => validarEntorno({ env: { NODE_ENV: 'development' } }));
    assert.doesNotThrow(() => validarEntorno({ env: {} }));
  });
});
