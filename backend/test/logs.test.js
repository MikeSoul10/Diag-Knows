import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { describirError } from '../src/channel/bot.js';

describe('describirError (logs sin datos del paciente)', () => {
  test('un error de pg solo deja nombre y código, nunca el detail con la fila', () => {
    const error = Object.assign(new Error('new row violates check constraint'), {
      code: '23514',
      detail: 'Failing row contains (..., 999000112, AliasSecreto, 1800, ...)',
    });
    const linea = describirError(error);
    assert.equal(linea, 'Error (23514)');
    assert.ok(!linea.includes('AliasSecreto'));
    assert.ok(!linea.includes('999000112'));
  });

  test('un TelegramError no imprime el payload', () => {
    const error = {
      name: 'TelegramError',
      response: { error_code: 400 },
      on: { payload: { chat_id: 123, text: 'glucosa 115' } },
    };
    assert.equal(describirError(error), 'TelegramError (400)');
  });

  test('tolera errores raros', () => {
    assert.equal(describirError(undefined), 'Error');
    assert.equal(describirError({ name: 'TypeError' }), 'TypeError');
  });
});
