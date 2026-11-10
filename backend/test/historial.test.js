import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.USE_MOCK_AI = 'true';
process.env.USE_MOCK_REPOS = 'true';

import {
  patients,
  consentimiento,
  mediciones,
  sintomas,
  dosisLogs,
  reiniciarRepositorios,
} from '../src/repositories/index.js';
import {
  resumenHistorial,
  detectarConsultaHistorial,
  tipoDeArgumento,
  MAX_SINTOMAS_LISTADOS,
} from '../src/services/historial.js';
import { registrarComandoHistorial } from '../src/channel/handlers/historial.js';
import { registrarMensajes } from '../src/channel/handlers/message.js';
import { COMANDOS } from '../src/channel/bot.js';
import { AYUDA } from '../src/channel/format.js';

const CHAT = 910001;
const AHORA = () => new Date('2026-11-04T18:00:00.000Z');
const hace = (dias) => new Date(AHORA().getTime() - dias * 24 * 60 * 60 * 1000).toISOString();

async function pacienteActivo(chatId = CHAT) {
  const paciente = await patients.findOrCreate(chatId);
  await consentimiento.registrar({
    pacienteId: paciente.id,
    aceptado: true,
    versionPrivacidad: 'v1.0',
  });
  return paciente;
}

beforeEach(() => reiniciarRepositorios());

describe('servicio /historial', () => {
  test('sin consentimiento no devuelve nada', async () => {
    const respuesta = await resumenHistorial({ chatId: CHAT, ahora: AHORA });
    assert.equal(respuesta.sinConsentimiento, true);
  });

  test('sin registros invita a reportar', async () => {
    await pacienteActivo();
    const { texto } = await resumenHistorial({ chatId: CHAT, ahora: AHORA });
    assert.match(texto, /Todavía no tienes registros/);
    assert.match(texto, /\/reportar/);
    assert.match(texto, /\/tome/);
  });

  test('resume mediciones, síntomas y tomas de los últimos 7 días', async () => {
    const { id } = await pacienteActivo();
    for (const [valor, dias] of [
      [100, 1],
      [120, 2],
      [110, 3],
    ]) {
      await mediciones.guardarMedicion({
        pacienteId: id,
        tipo: 'glucosa',
        valor,
        medidaEn: hace(dias),
      });
    }
    await mediciones.guardarMedicion({
      pacienteId: id,
      tipo: 'presion',
      valor: 120,
      valor2: 80,
      medidaEn: hace(1),
    });
    await sintomas.guardarSintoma({
      pacienteId: id,
      descripcion: 'dolor de cabeza',
      nivelGravedad: 'LEVE',
      reportadoEn: hace(1),
    });
    await dosisLogs.guardarTomaMedicamento({ pacienteId: id, tomada: true, tomadaEn: hace(1) });
    await dosisLogs.guardarTomaMedicamento({ pacienteId: id, tomada: true, tomadaEn: hace(2) });
    await dosisLogs.guardarTomaMedicamento({ pacienteId: id, tomada: false, tomadaEn: hace(3) });

    const { texto } = await resumenHistorial({ chatId: CHAT, ahora: AHORA });

    assert.match(texto, /últimos 7 días/);
    assert.match(
      texto,
      /Glucosa: 3 registros · promedio 110 mg\/dL · de 100 a 120 · última 100 mg\/dL/
    );
    assert.match(texto, /Presión: 1 registro · promedio 120\/80 mmHg · última 120\/80/);
    assert.match(texto, /Síntomas \(1\)/);
    assert.match(texto, /Leve · dolor de cabeza/);
    assert.match(texto, /Tomas registradas: 2 · no tomadas: 1/);
    assert.match(texto, /no es un diagnóstico/);
  });

  test('deja fuera lo anterior a 7 días', async () => {
    const { id } = await pacienteActivo();
    await mediciones.guardarMedicion({
      pacienteId: id,
      tipo: 'glucosa',
      valor: 300,
      medidaEn: hace(10),
    });
    await mediciones.guardarMedicion({
      pacienteId: id,
      tipo: 'glucosa',
      valor: 100,
      medidaEn: hace(1),
    });

    const { texto } = await resumenHistorial({ chatId: CHAT, ahora: AHORA });
    assert.match(texto, /Glucosa: 1 registro/);
    assert.doesNotMatch(texto, /300/);
  });

  test('con tipo solo muestra esa medición', async () => {
    const { id } = await pacienteActivo();
    await mediciones.guardarMedicion({
      pacienteId: id,
      tipo: 'peso',
      valor: 72.5,
      medidaEn: hace(1),
    });
    await sintomas.guardarSintoma({
      pacienteId: id,
      descripcion: 'mareo',
      nivelGravedad: 'LEVE',
      reportadoEn: hace(1),
    });

    const { texto } = await resumenHistorial({ chatId: CHAT, tipo: 'peso', ahora: AHORA });
    assert.match(texto, /Peso: 1 registro · promedio 72\.5 kg/);
    assert.doesNotMatch(texto, /Síntomas/);
    assert.doesNotMatch(texto, /mareo/);

    const vacio = await resumenHistorial({ chatId: CHAT, tipo: 'glucosa', ahora: AHORA });
    assert.match(vacio.texto, /No tienes registros de glucosa/);
  });

  test('escapa el HTML de los síntomas y limita la lista', async () => {
    const { id } = await pacienteActivo();
    await sintomas.guardarSintoma({
      pacienteId: id,
      descripcion: '<b>dolor</b> & más',
      nivelGravedad: 'GRAVE',
      reportadoEn: hace(1),
    });
    for (let i = 0; i < MAX_SINTOMAS_LISTADOS + 2; i += 1) {
      await sintomas.guardarSintoma({
        pacienteId: id,
        descripcion: `síntoma ${i}`,
        nivelGravedad: 'LEVE',
        reportadoEn: hace(2),
      });
    }

    const { texto } = await resumenHistorial({ chatId: CHAT, ahora: AHORA });
    assert.doesNotMatch(texto, /<b>dolor<\/b>/);
    assert.match(texto, /…y 3 más\./);
  });

  test('no mezcla datos de otro paciente', async () => {
    const otro = await pacienteActivo(CHAT + 1);
    await mediciones.guardarMedicion({
      pacienteId: otro.id,
      tipo: 'glucosa',
      valor: 250,
      medidaEn: hace(1),
    });
    await pacienteActivo();

    const { texto } = await resumenHistorial({ chatId: CHAT, ahora: AHORA });
    assert.doesNotMatch(texto, /250/);
  });
});

describe('detección de la pregunta natural', () => {
  test('reconoce consultas del historial', () => {
    assert.deepEqual(detectarConsultaHistorial('¿Cómo ha estado mi glucosa esta semana?'), {
      tipo: 'glucosa',
    });
    assert.deepEqual(detectarConsultaHistorial('como ha estado mi presión'), { tipo: 'presion' });
    assert.deepEqual(detectarConsultaHistorial('¿Cómo van mis síntomas?'), { tipo: null });
    assert.deepEqual(detectarConsultaHistorial('quiero ver mi historial'), { tipo: null });
    assert.deepEqual(detectarConsultaHistorial('dame mi resumen de la semana'), { tipo: null });
  });

  test('un reporte con números no es una consulta', () => {
    assert.equal(detectarConsultaHistorial('mi glucosa está en 115'), null);
    assert.equal(detectarConsultaHistorial('cómo ha estado mi peso, 72 kg hoy'), null);
  });

  test('un mensaje cualquiera no es una consulta', () => {
    assert.equal(detectarConsultaHistorial('me duele la cabeza'), null);
    assert.equal(detectarConsultaHistorial('hola'), null);
    assert.equal(detectarConsultaHistorial(''), null);
  });

  test('tipoDeArgumento entiende el argumento del comando', () => {
    assert.equal(tipoDeArgumento('Glucosa'), 'glucosa');
    assert.equal(tipoDeArgumento('presión'), 'presion');
    assert.equal(tipoDeArgumento('peso'), 'peso');
    assert.equal(tipoDeArgumento('otra cosa'), null);
    assert.equal(tipoDeArgumento(''), null);
  });
});

describe('adaptador /historial', () => {
  function crearCtx(texto) {
    const respuestas = [];
    return {
      respuestas,
      ctx: {
        from: { id: CHAT },
        message: { text: texto },
        reply: async (mensaje, extra) => respuestas.push({ mensaje, extra }),
      },
    };
  }

  test('está en el menú y en la ayuda', () => {
    assert.ok(COMANDOS.some(({ command }) => command === 'historial'));
    assert.match(AYUDA, /\/historial/);
  });

  test('el comando sin consentimiento muestra el aviso de privacidad', async () => {
    const comandos = new Map();
    registrarComandoHistorial({ command: (nombre, handler) => comandos.set(nombre, handler) });

    const { ctx, respuestas } = crearCtx('/historial');
    await comandos.get('historial')(ctx);
    assert.match(respuestas[0].mensaje, /privacidad/i);
  });

  test('el comando con consentimiento responde el resumen', async () => {
    await pacienteActivo();
    const comandos = new Map();
    registrarComandoHistorial({ command: (nombre, handler) => comandos.set(nombre, handler) });

    const { ctx, respuestas } = crearCtx('/historial glucosa');
    await comandos.get('historial')(ctx);
    assert.match(respuestas[0].mensaje, /resumen de los últimos 7 días/);
    assert.equal(respuestas[0].extra.parse_mode, 'HTML');
  });

  test('la pregunta natural responde el historial sin llamar a la conversación', async () => {
    await pacienteActivo();
    let handlerTexto = null;
    const servicio = {
      procesarMensaje: async () => {
        throw new Error('no debería llamarse');
      },
    };
    registrarMensajes(
      { on: (tipos, handler) => (typeof tipos === 'function' ? (handlerTexto = handler) : null) },
      servicio
    );

    const { ctx, respuestas } = crearCtx('¿Cómo ha estado mi glucosa esta semana?');
    await handlerTexto(ctx);
    assert.match(respuestas[0].mensaje, /resumen de los últimos 7 días/);
  });
});
