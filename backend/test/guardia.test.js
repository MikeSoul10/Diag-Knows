/**
 * Guardia de las pruebas de integración (hallazgo #10).
 *
 * Es una función pura: no abre conexiones ni necesita PostgreSQL.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluarGuardia } from './helpers/guardia.js';

const URL_TEST = 'postgres://diag:diag@localhost:5433/asistente_cronicas_test';

describe('guardia de integración', () => {
  test('con NODE_ENV=production lanza aunque la URL sea de pruebas', () => {
    assert.throws(() => evaluarGuardia(URL_TEST, 'production'), { message: /production/ });
    assert.throws(() => evaluarGuardia('', 'production'), { message: /production/ });
  });

  test('rechaza bases con "produccion" o "piloto" en la base o en el host', () => {
    assert.throws(() => evaluarGuardia('postgres://u:p@localhost/asistente_produccion', 'test'), {
      message: /producción/,
    });
    assert.throws(() => evaluarGuardia('postgres://u:p@db-piloto.local/asistente', 'test'), {
      message: /producción/,
    });
  });

  test('base sin "test" se omite con motivo', () => {
    assert.deepEqual(evaluarGuardia('postgres://u:p@localhost/asistente_cronicas', 'test'), {
      omitir: true,
      motivo: 'la BD "asistente_cronicas" no parece de pruebas',
    });
  });

  test('asistente_cronicas_test se ejecuta', () => {
    assert.deepEqual(evaluarGuardia(URL_TEST, 'test'), { omitir: false });
  });

  test('sin TEST_DATABASE_URL se omite', () => {
    assert.deepEqual(evaluarGuardia('', 'test'), {
      omitir: true,
      motivo: 'TEST_DATABASE_URL no está definida',
    });
    assert.deepEqual(evaluarGuardia(undefined, 'development'), {
      omitir: true,
      motivo: 'TEST_DATABASE_URL no está definida',
    });
  });
});
