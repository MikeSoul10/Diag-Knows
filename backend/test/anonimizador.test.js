import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { anonimizar } from '../src/services/anonimizador.js';

describe('anonimizador', () => {
  test('tapa un teléfono de 10 dígitos', () => {
    assert.equal(anonimizar('mi número es 5512345678'), 'mi número es [TELEFONO]');
  });

  test('tapa un teléfono con espacios', () => {
    assert.equal(anonimizar('llámame al 55 1234 5678'), 'llámame al [TELEFONO]');
  });

  test('tapa un teléfono con prefijo internacional', () => {
    assert.equal(anonimizar('es +52 55 1234 5678'), 'es [TELEFONO]');
  });

  test('tapa un número de 7 dígitos suelto', () => {
    assert.equal(anonimizar('mi expediente es 1234567'), 'mi expediente es [TELEFONO]');
  });

  test('tapa correos', () => {
    assert.equal(anonimizar('escríbeme a ana.lopez@correo.com'), 'escríbeme a [CORREO]');
  });

  test('tapa URLs', () => {
    assert.equal(
      anonimizar('mi perfil está en https://ejemplo.com/paciente/ana'),
      'mi perfil está en [URL]'
    );
  });

  test('tapa nombres conocidos y respeta mayúsculas', () => {
    assert.equal(
      anonimizar('Hola, soy Ana y mi glucosa es 115', { nombres: ['Ana'] }),
      'Hola, soy [NOMBRE] y mi glucosa es 115'
    );
    assert.equal(
      anonimizar('ANA dice que está bien', { nombres: ['ana'] }),
      '[NOMBRE] dice que está bien'
    );
  });

  test('tapa nombres con caracteres especiales de regex', () => {
    assert.equal(
      anonimizar('Ana (mamá) me acompañó', { nombres: ['Ana (mamá)'] }),
      '[NOMBRE] me acompañó'
    );
  });

  test('ignora nombres de menos de 3 letras', () => {
    assert.equal(anonimizar('Al me acompañó', { nombres: ['Al'] }), 'Al me acompañó');
  });

  test('no altera valores clínicos', () => {
    const texto = 'glucosa 115, presión 120/80, peso 72.5 kg';
    assert.equal(anonimizar(texto), texto);
  });

  test('no altera una fecha', () => {
    const texto = 'el 2026-10-27 me sentí mal';
    assert.equal(anonimizar(texto), texto);
  });

  test('no altera la presión escrita con "sobre"', () => {
    const texto = 'presión 120 sobre 80';
    assert.equal(anonimizar(texto), texto);
  });

  test('sin nombres conocidos no toca el texto', () => {
    const texto = 'Hola, soy Ana';
    assert.equal(anonimizar(texto), texto);
    assert.equal(anonimizar(texto, {}), texto);
  });

  test('texto nulo o vacío devuelve cadena vacía', () => {
    assert.equal(anonimizar(null), '');
    assert.equal(anonimizar(undefined), '');
    assert.equal(anonimizar(''), '');
  });
});
