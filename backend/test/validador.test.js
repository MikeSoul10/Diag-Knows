import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { validarExtraccion } from '../src/services/validador.js';

function extraer(mediciones = [], sintomas = [], medicacion = []) {
  return validarExtraccion({ mediciones, sintomas, medicacion });
}

describe('validador: mediciones', () => {
  test('acepta una glucosa normal', () => {
    const { validos, rechazados } = extraer([{ tipo: 'glucosa', valor: 115, unidad: 'mg/dL' }]);

    assert.deepEqual(validos.mediciones, [{ tipo: 'glucosa', valor: 115, unidad: 'mg/dL' }]);
    assert.deepEqual(rechazados, []);
  });

  test('rechaza glucosa fuera de rango y explica el rango', () => {
    const { validos, rechazados } = extraer([{ tipo: 'glucosa', valor: 900 }]);

    assert.deepEqual(validos.mediciones, []);
    assert.equal(rechazados.length, 1);
    assert.match(rechazados[0].motivo, /20 a 600/);
  });

  test('rechaza glucosa demasiado baja', () => {
    const { rechazados } = extraer([{ tipo: 'glucosa', valor: 10 }]);
    assert.equal(rechazados.length, 1);
  });

  test('acepta una presión completa', () => {
    const { validos, rechazados } = extraer([{ tipo: 'presion', valor: 120, valor2: 80 }]);

    assert.deepEqual(validos.mediciones, [
      { tipo: 'presion', valor: 120, valor2: 80, unidad: 'mmHg' },
    ]);
    assert.deepEqual(rechazados, []);
  });

  test('rechaza una diastólica fuera de rango', () => {
    const { rechazados } = extraer([{ tipo: 'presion', valor: 120, valor2: 200 }]);
    assert.match(rechazados[0].motivo, /30 a 160/);
  });

  test('rechaza una sistólica menor o igual que la diastólica', () => {
    const { rechazados } = extraer([{ tipo: 'presion', valor: 80, valor2: 120 }]);
    assert.match(rechazados[0].motivo, /mayor que la de abajo/);
  });

  test('rechaza una presión incompleta', () => {
    const { rechazados } = extraer([{ tipo: 'presion', valor: 120 }]);
    assert.match(rechazados[0].motivo, /abajo/);
  });

  test('acepta peso con decimal', () => {
    const { validos } = extraer([{ tipo: 'peso', valor: 72.5 }]);
    assert.deepEqual(validos.mediciones, [{ tipo: 'peso', valor: 72.5, unidad: 'kg' }]);
  });

  test('rechaza un peso imposible', () => {
    const { rechazados } = extraer([{ tipo: 'peso', valor: 500 }]);
    assert.match(rechazados[0].motivo, /20 a 400/);
  });

  test('acepta números enviados como texto', () => {
    const { validos } = extraer([{ tipo: 'glucosa', valor: '115' }]);
    assert.equal(validos.mediciones[0].valor, 115);
  });

  test('rechaza un tipo de medición desconocido', () => {
    const { rechazados } = extraer([{ tipo: 'temperatura', valor: 37 }]);
    assert.match(rechazados[0].motivo, /No reconocí/);
  });

  test('rechaza un valor que no es número', () => {
    const { rechazados } = extraer([{ tipo: 'glucosa', valor: 'mucho' }]);
    assert.equal(rechazados.length, 1);
  });
});

describe('validador: síntomas', () => {
  test('acepta un síntoma sin intensidad (la conversación la pregunta)', () => {
    const { validos, rechazados } = extraer([], [{ descripcion: 'mareo', severidad: null }]);

    assert.deepEqual(validos.sintomas, [{ descripcion: 'mareo', severidad: null }]);
    assert.deepEqual(rechazados, []);
  });

  test('acepta intensidades 1, 2 y 3', () => {
    const { validos } = extraer(
      [],
      [
        { descripcion: 'tos', severidad: 1 },
        { descripcion: 'mareo', severidad: 2 },
        { descripcion: 'dolor de cabeza', severidad: 3 },
      ]
    );

    assert.equal(validos.sintomas.length, 3);
  });

  test('rechaza una intensidad fuera de la escala', () => {
    const { rechazados } = extraer([], [{ descripcion: 'tos', severidad: 4 }]);
    assert.match(rechazados[0].motivo, /1, 2 o 3/);
  });

  test('rechaza un síntoma sin descripción', () => {
    const { rechazados } = extraer([], [{ descripcion: '   ', severidad: 1 }]);
    assert.equal(rechazados.length, 1);
  });
});

describe('validador: medicación y forma general', () => {
  test('acepta una toma confirmada', () => {
    const { validos } = validarExtraccion({
      medicacion: [{ tomada: true, nombre: 'metformina' }],
    });

    assert.deepEqual(validos.medicacion, [{ tomada: true, nombre: 'metformina' }]);
  });

  test('rechaza una toma sin booleano', () => {
    const { rechazados } = validarExtraccion({ medicacion: [{ tomada: 'si' }] });
    assert.equal(rechazados.length, 1);
  });

  test('una extracción vacía o nula no rompe', () => {
    const vacio = { medicacion: [], mediciones: [], sintomas: [] };

    assert.deepEqual(validarExtraccion(vacio).validos, vacio);
    assert.deepEqual(validarExtraccion(null).validos, vacio);
    assert.deepEqual(validarExtraccion({}).rechazados, []);
  });

  test('separa lo válido de lo rechazado en el mismo mensaje', () => {
    const { validos, rechazados } = extraer([
      { tipo: 'glucosa', valor: 115 },
      { tipo: 'glucosa', valor: 9000 },
    ]);

    assert.equal(validos.mediciones.length, 1);
    assert.equal(rechazados.length, 1);
  });
});
