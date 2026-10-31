import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { extraer, extraerConClaude, extraerMock } from '../src/services/extractor.js';

// Las pruebas siempre usan el extractor por regex, aunque la máquina tenga llave.
process.env.USE_MOCK_AI = 'true';
process.env.ANTHROPIC_API_KEY = '';

function medicionDe(texto, tipo) {
  return extraerMock(texto).mediciones.find((medicion) => medicion.tipo === tipo);
}

describe('extractorMock: frases reales', () => {
  test('"Me tomé la pastilla y tengo glucosa en 115"', () => {
    const resultado = extraerMock('Me tomé la pastilla y tengo glucosa en 115');

    assert.equal(resultado.medicacion.length, 1);
    assert.equal(resultado.medicacion[0].tomada, true);
    assert.equal(resultado.medicacion[0].nombre, null);
    assert.deepEqual(medicionDe('Me tomé la pastilla y tengo glucosa en 115', 'glucosa'), {
      tipo: 'glucosa',
      valor: 115,
      unidad: 'mg/dL',
    });
  });

  test('"traigo 130/85 y un poco de mareo"', () => {
    const resultado = extraerMock('traigo 130/85 y un poco de mareo');

    assert.deepEqual(resultado.mediciones, [
      { tipo: 'presion', valor: 130, valor2: 85, unidad: 'mmHg' },
    ]);
    assert.deepEqual(resultado.sintomas, [{ descripcion: 'mareo', severidad: 1 }]);
    assert.deepEqual(resultado.medicacion, []);
  });

  test('"no me tomé la metformina"', () => {
    const resultado = extraerMock('no me tomé la metformina');

    assert.deepEqual(resultado.medicacion, [{ tomada: false, nombre: 'metformina' }]);
  });

  test('"se me olvidó tomarme el losartán"', () => {
    const resultado = extraerMock('se me olvidó tomarme el losartán');

    assert.deepEqual(resultado.medicacion, [{ tomada: false, nombre: 'losartan' }]);
  });

  test('"me tomé la metformina" recupera el nombre', () => {
    const resultado = extraerMock('me tomé la metformina');

    assert.deepEqual(resultado.medicacion, [{ tomada: true, nombre: 'metformina' }]);
  });

  test('"mi glucosa está en 210 mg/dL"', () => {
    assert.deepEqual(medicionDe('mi glucosa está en 210 mg/dL', 'glucosa'), {
      tipo: 'glucosa',
      valor: 210,
      unidad: 'mg/dL',
    });
  });

  test('"peso 72.5 kg"', () => {
    assert.deepEqual(medicionDe('peso 72.5 kg', 'peso'), {
      tipo: 'peso',
      valor: 72.5,
      unidad: 'kg',
    });
  });

  test('"presión 120 sobre 80"', () => {
    assert.deepEqual(medicionDe('presión 120 sobre 80', 'presion'), {
      tipo: 'presion',
      valor: 120,
      valor2: 80,
      unidad: 'mmHg',
    });
  });

  test('"tengo dolor de cabeza muy fuerte y náuseas" separa intensidad por síntoma', () => {
    const resultado = extraerMock('tengo dolor de cabeza muy fuerte y náuseas');

    assert.deepEqual(resultado.sintomas, [
      { descripcion: 'dolor de cabeza', severidad: 3 },
      { descripcion: 'nauseas', severidad: null },
    ]);
  });

  test('"hoy me falta el aire y tos"', () => {
    const resultado = extraerMock('hoy me falta el aire y tos');

    assert.deepEqual(
      resultado.sintomas.map((sintoma) => sintoma.descripcion),
      ['falta de aire', 'tos']
    );
  });

  test('"me duele la cabeza" no inventa intensidad', () => {
    assert.deepEqual(extraerMock('me duele la cabeza').sintomas, [
      { descripcion: 'dolor de cabeza', severidad: null },
    ]);
  });

  test('"estoy cansado"', () => {
    assert.deepEqual(extraerMock('estoy cansado').sintomas, [
      { descripcion: 'cansancio', severidad: null },
    ]);
  });

  test('tolera mayúsculas y acentos faltantes', () => {
    const resultado = extraerMock('SILBIDOS EN EL PECHO');

    assert.deepEqual(resultado.sintomas, [
      { descripcion: 'silbidos en el pecho', severidad: null },
    ]);
  });

  test('"ME TOME LA PASTILLA" sin acentos', () => {
    assert.deepEqual(extraerMock('ME TOME LA PASTILLA').medicacion, [
      { tomada: true, nombre: null },
    ]);
  });

  test('varias mediciones en un mensaje', () => {
    const resultado = extraerMock('glucosa 115 y presión 120/80 y peso 80 kg');

    assert.deepEqual(
      resultado.mediciones.map((medicion) => medicion.tipo),
      ['presion', 'glucosa', 'peso']
    );
  });

  test('no duplica la misma toma repetida', () => {
    const resultado = extraerMock('me tomé la pastilla y ya la tomé');

    assert.equal(resultado.medicacion.length, 1);
  });

  test('un mensaje sin datos clínicos devuelve todo vacío', () => {
    assert.deepEqual(extraerMock('no entendí nada de lo que dices'), {
      medicacion: [],
      mediciones: [],
      sintomas: [],
    });
  });

  test('mencionar el medicamento sin verbo de toma no registra nada', () => {
    assert.deepEqual(extraerMock('la metformina me cae mal').medicacion, []);
  });

  test('una fecha no se confunde con una presión', () => {
    assert.deepEqual(extraerMock('el 12/03/2026 me sentí mal').mediciones, []);
  });

  test('texto vacío o nulo no rompe', () => {
    assert.deepEqual(extraerMock(''), { medicacion: [], mediciones: [], sintomas: [] });
    assert.deepEqual(extraerMock(null), { medicacion: [], mediciones: [], sintomas: [] });
  });
});

describe('selección de implementación', () => {
  test('extraer usa el mock cuando USE_MOCK_AI=true', async () => {
    assert.deepEqual(await extraer('glucosa en 115'), extraerMock('glucosa en 115'));
  });

  test('extraerConClaude avisa que no está implementado', async () => {
    await assert.rejects(() => extraerConClaude('glucosa en 115'), /No implementado/);
  });

  test('con USE_MOCK_AI=false intenta Claude y falla de forma controlada', async () => {
    process.env.USE_MOCK_AI = 'false';
    try {
      await assert.rejects(() => extraer('glucosa en 115'), /No implementado/);
    } finally {
      process.env.USE_MOCK_AI = 'true';
    }
  });
});
