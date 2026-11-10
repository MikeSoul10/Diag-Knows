import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  describirMomento,
  formatoLocal,
  localAUtc,
  localTextoAIsoUtc,
  zonaValida,
} from '../src/services/fechas.js';
import { extraerMock } from '../src/services/extractor.js';
import { DIAS_MAXIMOS_ATRAS, validarExtraccion } from '../src/services/validador.js';
import { esCritica, UMBRALES } from '../src/config/thresholds.js';

const ZONA = 'America/Mexico_City';
// Martes 10 nov 2026, 12:30 en Ciudad de México (18:30 UTC).
const AHORA = new Date('2026-11-10T18:30:00Z');

describe('fechas.js', () => {
  test('convierte hora local a UTC y de regreso', () => {
    const utc = localAUtc({ anio: 2026, mes: 11, dia: 9, hora: 21, minuto: 0 }, ZONA);
    assert.equal(utc.toISOString(), '2026-11-10T03:00:00.000Z');
    assert.equal(formatoLocal(utc, ZONA), '2026-11-09T21:00');
  });

  test('día 0 = último día del mes anterior', () => {
    const utc = localAUtc({ anio: 2026, mes: 11, dia: 0, hora: 12, minuto: 0 }, ZONA);
    assert.equal(formatoLocal(utc, ZONA), '2026-10-31T12:00');
  });

  test('localTextoAIsoUtc rechaza formatos y fechas imposibles', () => {
    assert.equal(localTextoAIsoUtc('2026-11-09T21:00', ZONA), '2026-11-10T03:00:00.000Z');
    assert.equal(localTextoAIsoUtc('2026-02-31T10:00', ZONA), null);
    assert.equal(localTextoAIsoUtc('ayer', ZONA), null);
    assert.equal(localTextoAIsoUtc(null, ZONA), null);
  });

  test('describirMomento: hoy, ayer y otra fecha', () => {
    assert.equal(describirMomento('2026-11-10T15:00:00Z', AHORA, ZONA), 'hoy 9:00');
    assert.equal(describirMomento('2026-11-10T03:00:00Z', AHORA, ZONA), 'ayer 21:00');
    assert.equal(describirMomento('2026-11-02T15:00:00Z', AHORA, ZONA), 'lun 2 nov, 9:00');
  });

  test('zonaValida', () => {
    assert.equal(zonaValida(ZONA), true);
    assert.equal(zonaValida('Marte/Base'), false);
    assert.equal(zonaValida(''), false);
  });
});

describe('extractor mock: cuándo pasó (DK-202)', () => {
  const opciones = { ahora: AHORA, zonaHoraria: ZONA };
  const momento = (texto) => extraerMock(texto, opciones).sintomas[0]?.ocurridoEn ?? null;

  test('"anoche" → ayer 21:00', () => {
    assert.equal(momento('anoche me dolió la cabeza'), '2026-11-10T03:00:00.000Z');
  });

  test('"ayer en la tarde" → ayer 16:00', () => {
    assert.equal(momento('ayer en la tarde tuve mareo'), '2026-11-09T22:00:00.000Z');
  });

  test('"hoy en la mañana" → hoy 9:00', () => {
    assert.equal(momento('hoy en la mañana tuve tos'), '2026-11-10T15:00:00.000Z');
  });

  test('"a las 8 de la mañana" → hoy 8:00', () => {
    assert.equal(
      extraerMock('me tomé la metformina a las 8 de la mañana', opciones).medicacion[0].ocurridoEn,
      '2026-11-10T14:00:00.000Z'
    );
  });

  test('"ayer" sin hora → ayer 12:00', () => {
    assert.equal(momento('ayer tuve mareo'), '2026-11-09T18:00:00.000Z');
  });

  test('sin referencia de tiempo no agrega ocurridoEn', () => {
    assert.deepEqual(extraerMock('me duele la cabeza', opciones).sintomas, [
      { descripcion: 'dolor de cabeza', severidad: null },
    ]);
  });

  test('sin reloj ni zona se comporta como antes', () => {
    assert.equal(extraerMock('anoche me dolió la cabeza').sintomas[0].ocurridoEn, undefined);
  });
});

describe('validador: momento', () => {
  const sintoma = (ocurridoEn) => ({
    medicacion: [],
    mediciones: [],
    sintomas: [{ descripcion: 'tos', severidad: 1, ocurridoEn }],
  });

  test('acepta un momento pasado y lo conserva', () => {
    const { validos } = validarExtraccion(sintoma('2026-11-10T03:00:00Z'), { ahora: AHORA });
    assert.equal(validos.sintomas[0].ocurridoEn, '2026-11-10T03:00:00.000Z');
  });

  test('rechaza el futuro', () => {
    const { validos, rechazados } = validarExtraccion(sintoma('2026-11-11T03:00:00Z'), {
      ahora: AHORA,
    });
    assert.equal(validos.sintomas.length, 0);
    assert.match(rechazados[0].motivo, /todavía no pasa/);
  });

  test(`rechaza más de ${DIAS_MAXIMOS_ATRAS} días atrás`, () => {
    const { rechazados } = validarExtraccion(sintoma('2026-10-01T03:00:00Z'), { ahora: AHORA });
    assert.match(rechazados[0].motivo, /últimos/);
  });

  test('rechaza una fecha ilegible', () => {
    const { rechazados } = validarExtraccion(sintoma('no-es-fecha'), { ahora: AHORA });
    assert.match(rechazados[0].motivo, /cuándo pasó/);
  });
});

describe('thresholds.js (DK-203)', () => {
  test('todos los umbrales siguen en null hasta la validación clínica', () => {
    assert.deepEqual(UMBRALES, {
      glucosa: { minimo: null, maximo: null },
      presion: {
        sistolica: { minimo: null, maximo: null },
        diastolica: { minimo: null, maximo: null },
      },
      peso: { minimo: null, maximo: null },
    });
  });

  test('con umbrales en null nada es crítico', () => {
    assert.equal(esCritica({ tipo: 'glucosa', valor: 590 }), false);
    assert.equal(esCritica({ tipo: 'presion', valor: 250, valor2: 150 }), false);
  });

  test('cuando un umbral exista, se respeta (umbrales de ejemplo, no clínicos)', () => {
    const ejemplo = {
      glucosa: { minimo: 1, maximo: 2 },
      presion: {
        sistolica: { minimo: null, maximo: 3 },
        diastolica: { minimo: null, maximo: null },
      },
      peso: { minimo: null, maximo: null },
    };
    assert.equal(esCritica({ tipo: 'glucosa', valor: 5 }, ejemplo), true);
    assert.equal(esCritica({ tipo: 'presion', valor: 4, valor2: 1 }, ejemplo), true);
    assert.equal(esCritica({ tipo: 'peso', valor: 4 }, ejemplo), false);
  });
});
