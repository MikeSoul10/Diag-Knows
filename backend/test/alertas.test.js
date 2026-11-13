/**
 * DK-302: alertas por umbral crítico.
 *
 * Los umbrales de producción siguen en `null`, así que aquí se inyectan para
 * probar la lógica. El hook de conversación se prueba con `evaluarCritica`
 * inyectado, sin tocar los umbrales globales.
 */
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { UMBRALES } from '../src/config/thresholds.js';
import { evaluarMedicion, registrarSiCorresponde } from '../src/services/alertas.js';
import { crearAlmacenMemoria, crearServicioConversacion } from '../src/services/conversacion.js';
import { extraerMock } from '../src/services/extractor.js';
import { anonimizar } from '../src/services/anonimizador.js';
import { validarExtraccion } from '../src/services/validador.js';
import {
  alertas,
  patients,
  consentimiento,
  mediciones,
  sintomas,
  medicamentos,
  dosisLogs,
  reiniciarRepositorios,
} from '../src/repositories/index.js';

process.env.USE_MOCK_REPOS = 'true';

const CHAT = 960001;

const UMBRALES_GLUCOSA = Object.freeze({
  ...UMBRALES,
  glucosa: Object.freeze({ minimo: 70, maximo: 180 }),
});

const UMBRALES_PRESION = Object.freeze({
  ...UMBRALES,
  presion: Object.freeze({
    sistolica: Object.freeze({ minimo: 90, maximo: 140 }),
    diastolica: Object.freeze({ minimo: 60, maximo: 90 }),
  }),
});

beforeEach(() => reiniciarRepositorios());

// ---------------------------------------------------------------------------
// Evaluador
// ---------------------------------------------------------------------------

describe('evaluarMedicion', () => {
  test('con los umbrales de producción en null nunca devuelve alerta', () => {
    assert.equal(evaluarMedicion({ tipo: 'glucosa', valor: 250 }), null);
    assert.equal(evaluarMedicion({ tipo: 'glucosa', valor: 20 }), null);
    assert.equal(evaluarMedicion({ tipo: 'presion', valor: 200, valor2: 120 }), null);
  });

  test('glucosa 250 con umbral inyectado dispara UMBRAL_CRITICO/ALTA', () => {
    assert.deepEqual(evaluarMedicion({ tipo: 'glucosa', valor: 250 }, UMBRALES_GLUCOSA), {
      tipo: 'UMBRAL_CRITICO',
      severidad: 'ALTA',
    });
  });

  test('glucosa 100 con el mismo umbral no dispara', () => {
    assert.equal(evaluarMedicion({ tipo: 'glucosa', valor: 100 }, UMBRALES_GLUCOSA), null);
  });

  test('presión: sistólica alta, diastólica alta o ambas normales', () => {
    assert.ok(evaluarMedicion({ tipo: 'presion', valor: 150, valor2: 80 }, UMBRALES_PRESION));
    assert.ok(evaluarMedicion({ tipo: 'presion', valor: 120, valor2: 100 }, UMBRALES_PRESION));
    assert.equal(
      evaluarMedicion({ tipo: 'presion', valor: 120, valor2: 80 }, UMBRALES_PRESION),
      null
    );
  });
});

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

describe('registrarSiCorresponde', () => {
  test('llama al repo una sola vez y devuelve el DTO de la alerta', async () => {
    const llamadas = [];
    const repo = {
      crear: async (datos) => {
        llamadas.push(datos);
        return { id: 'alerta-1', ...datos, atendida: false };
      },
    };

    const alerta = await registrarSiCorresponde({
      repo,
      pacienteId: 'paciente-1',
      medicionId: 'medicion-1',
      medicion: { tipo: 'glucosa', valor: 250 },
      umbrales: UMBRALES_GLUCOSA,
    });

    assert.equal(llamadas.length, 1);
    assert.deepEqual(llamadas[0], {
      pacienteId: 'paciente-1',
      medicionId: 'medicion-1',
      tipo: 'UMBRAL_CRITICO',
      severidad: 'ALTA',
    });
    assert.equal(alerta.id, 'alerta-1');
  });

  test('si la medición no es crítica no toca el repositorio', async () => {
    const repo = { crear: async () => assert.fail('no debió crear la alerta') };

    const alerta = await registrarSiCorresponde({
      repo,
      pacienteId: 'paciente-1',
      medicionId: 'medicion-1',
      medicion: { tipo: 'glucosa', valor: 100 },
      umbrales: UMBRALES_GLUCOSA,
    });

    assert.equal(alerta, null);
  });
});

// ---------------------------------------------------------------------------
// Hook de conversación
// ---------------------------------------------------------------------------

function crearHarnessConversacion({ evaluarCritica } = {}) {
  return crearServicioConversacion({
    repos: { patients, mediciones, sintomas, medicamentos, dosisLogs, alertas },
    extractor: { extraer: extraerMock },
    anonimizar,
    validar: validarExtraccion,
    almacenEstado: crearAlmacenMemoria(),
    ahora: () => new Date('2026-11-12T16:00:00.000Z'),
    generarToken: () => 'tok',
    registrarError: () => {},
    ...(evaluarCritica ? { evaluarCritica } : {}),
  });
}

async function pacienteConConsentimiento() {
  const paciente = await patients.findOrCreate(CHAT);
  await consentimiento.registrar({
    pacienteId: paciente.id,
    aceptado: true,
    versionPrivacidad: 'v1.0',
  });
  return paciente;
}

async function registrarGlucosa(servicio) {
  const resumen = await servicio.procesarMensaje({
    chatId: CHAT,
    texto: 'mi glucosa está en 115',
  });
  const token = resumen.botones
    .flat()
    .find(({ callback }) => callback.startsWith('conv:ok:'))
    .callback.split(':')[2];

  return servicio.procesarCallback({ chatId: CHAT, accion: 'ok', token });
}

describe('hook de conversación', () => {
  test('con evaluarCritica inyectado a true crea la alerta junto con la medición', async () => {
    const paciente = await pacienteConConsentimiento();
    const servicio = crearHarnessConversacion({ evaluarCritica: () => true });

    const respuesta = await registrarGlucosa(servicio);
    assert.match(respuesta.texto, /quedó guardado/);

    const [medicion] = await mediciones.listarPorPaciente(paciente.id);
    const alertasPaciente = await alertas.listarPorPaciente(paciente.id);

    assert.equal(alertasPaciente.length, 1);
    assert.equal(alertasPaciente[0].tipo, 'UMBRAL_CRITICO');
    assert.equal(alertasPaciente[0].severidad, 'ALTA');
    assert.equal(alertasPaciente[0].medicionId, medicion.id);
  });

  test('con los umbrales por defecto la medición no genera alerta', async () => {
    const paciente = await pacienteConConsentimiento();
    const servicio = crearHarnessConversacion();

    await registrarGlucosa(servicio);

    assert.equal((await mediciones.listarPorPaciente(paciente.id)).length, 1);
    assert.deepEqual(await alertas.listarPorPaciente(paciente.id), []);
  });
});
