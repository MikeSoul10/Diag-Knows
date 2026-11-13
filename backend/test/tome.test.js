import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.USE_MOCK_AI = 'true';
process.env.USE_MOCK_REPOS = 'true';

import {
  patients,
  consentimiento,
  medicamentos,
  dosisLogs,
  reiniciarRepositorios,
} from '../src/repositories/index.js';
import { iniciarTome, registrarTome, TOME_SIN_NOMBRE } from '../src/services/tome.js';
import { registrarComandoTome, RE_TOME } from '../src/channel/handlers/tome.js';
import { COMANDOS } from '../src/channel/bot.js';
import { AYUDA } from '../src/channel/format.js';

const CHAT = 900001;
const OTRO_CHAT = 900002;
const AHORA = () => new Date('2026-11-02T14:35:00.000Z');

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

describe('servicio /tome', () => {
  test('sin consentimiento no guarda nada', async () => {
    const respuesta = await iniciarTome({ chatId: CHAT, ahora: AHORA });
    assert.equal(respuesta.sinConsentimiento, true);

    const paciente = await patients.findOrCreate(CHAT);
    assert.deepEqual(await dosisLogs.listarPorPaciente(paciente.id), []);
  });

  test('sin medicamentos guarda la toma sin nombre', async () => {
    const paciente = await pacienteActivo();
    const respuesta = await iniciarTome({ chatId: CHAT, ahora: AHORA });

    assert.match(respuesta.texto, /Listo, registré tu toma de medicamento/);
    const tomas = await dosisLogs.listarPorPaciente(paciente.id);
    assert.equal(tomas.length, 1);
    assert.equal(tomas[0].estado, 'TOMADA');
    assert.equal(tomas[0].medicamentoId, null);
    assert.equal(tomas[0].tomadaEn, '2026-11-02T14:35:00.000Z');
  });

  test('con un solo medicamento lo guarda directo', async () => {
    const paciente = await pacienteActivo();
    const unico = await medicamentos.crear({ pacienteId: paciente.id, nombre: 'Metformina' });

    const respuesta = await iniciarTome({ chatId: CHAT, ahora: AHORA });
    assert.match(respuesta.texto, /Metformina/);
    assert.equal(respuesta.botones, undefined);

    const [toma] = await dosisLogs.listarPorPaciente(paciente.id);
    assert.equal(toma.medicamentoId, unico.id);
    assert.equal(toma.nombreReportado, 'Metformina');
  });

  test('con varios medicamentos pregunta con botones y no guarda todavía', async () => {
    const paciente = await pacienteActivo();
    await medicamentos.sembrarDatosDesarrollo(paciente.id);

    const respuesta = await iniciarTome({ chatId: CHAT, ahora: AHORA });
    assert.match(respuesta.texto, /Cuál medicamento/);
    assert.equal(respuesta.botones.length, 3); // 2 medicamentos + "otro"
    for (const fila of respuesta.botones) {
      for (const boton of fila) {
        assert.match(boton.callback, RE_TOME);
        assert.ok(Buffer.byteLength(boton.callback) <= 64);
      }
    }
    assert.deepEqual(await dosisLogs.listarPorPaciente(paciente.id), []);
  });

  test('registrarTome guarda el medicamento elegido', async () => {
    const paciente = await pacienteActivo();
    const [, losartan] = await medicamentos.sembrarDatosDesarrollo(paciente.id);

    const respuesta = await registrarTome({
      chatId: CHAT,
      medicamentoId: losartan.id,
      ahora: AHORA,
    });
    assert.match(respuesta.texto, /Losartán/);

    const [toma] = await dosisLogs.listarPorPaciente(paciente.id);
    assert.equal(toma.medicamentoId, losartan.id);
    assert.equal(toma.estado, 'TOMADA');
  });

  test('la opción "otro" guarda sin nombre', async () => {
    const paciente = await pacienteActivo();
    await medicamentos.sembrarDatosDesarrollo(paciente.id);

    await registrarTome({ chatId: CHAT, medicamentoId: TOME_SIN_NOMBRE, ahora: AHORA });
    const [toma] = await dosisLogs.listarPorPaciente(paciente.id);
    assert.equal(toma.medicamentoId, null);
  });

  test('un medicamento ajeno o inexistente no se guarda', async () => {
    const paciente = await pacienteActivo();
    const otro = await pacienteActivo(OTRO_CHAT);
    const [ajeno] = await medicamentos.sembrarDatosDesarrollo(otro.id);

    const respuesta = await registrarTome({
      chatId: CHAT,
      medicamentoId: ajeno.id,
      ahora: AHORA,
    });
    assert.equal(respuesta.aviso, 'Ya no está vigente');
    assert.deepEqual(await dosisLogs.listarPorPaciente(paciente.id), []);
  });

  test('el nombre del medicamento se escapa en HTML', async () => {
    const paciente = await pacienteActivo();
    await medicamentos.crear({ pacienteId: paciente.id, nombre: '<b>X</b> & Y' });

    const respuesta = await iniciarTome({ chatId: CHAT, ahora: AHORA });
    assert.match(respuesta.texto, /&lt;b&gt;X&lt;\/b&gt; &amp; Y/);
  });
});

describe('adaptador /tome', () => {
  function crearBotFalso() {
    const comandos = new Map();
    const acciones = [];
    registrarComandoTome({
      command: (nombre, handler) => comandos.set(nombre, handler),
      hears: (texto, handler) => comandos.set(texto, handler),
      action: (patron, handler) => acciones.push({ patron, handler }),
    });
    return { comandos, acciones };
  }

  function crearCtx({ data } = {}) {
    const llamadas = { reply: [], editMessageText: [], answerCbQuery: [] };
    return {
      llamadas,
      ctx: {
        from: { id: CHAT },
        callbackQuery: data === undefined ? undefined : { data },
        match: data === undefined ? undefined : RE_TOME.exec(data),
        reply: async (m, e) => llamadas.reply.push({ m, e }),
        editMessageText: async (m, e) => llamadas.editMessageText.push({ m, e }),
        answerCbQuery: async (a) => llamadas.answerCbQuery.push(a),
      },
    };
  }

  test('el comando está en el menú y en la ayuda', () => {
    assert.ok(COMANDOS.some(({ command }) => command === 'tome'));
    assert.match(AYUDA, /\/tome/);
  });

  test('/tome sin consentimiento muestra el aviso de privacidad', async () => {
    const { comandos } = crearBotFalso();
    const { ctx, llamadas } = crearCtx();

    await comandos.get('tome')(ctx);
    assert.equal(llamadas.reply.length, 1);
    assert.match(llamadas.reply[0].m, /privacidad/i);
  });

  test('/tome con varios medicamentos manda botones y el botón guarda y edita el mensaje', async () => {
    const paciente = await pacienteActivo();
    const [metformina] = await medicamentos.sembrarDatosDesarrollo(paciente.id);
    const { comandos, acciones } = crearBotFalso();

    const primero = crearCtx();
    await comandos.get('tome')(primero.ctx);
    assert.ok(primero.llamadas.reply[0].e.reply_markup.inline_keyboard.length >= 2);

    const dato = `tome:${metformina.id}`;
    const accion = acciones.find(({ patron }) => patron.test(dato));
    assert.ok(accion);

    const segundo = crearCtx({ data: dato });
    await accion.handler(segundo.ctx);

    assert.equal(segundo.llamadas.answerCbQuery.length, 1);
    assert.match(segundo.llamadas.editMessageText[0].m, /Metformina/);
    assert.deepEqual(segundo.llamadas.editMessageText[0].e.reply_markup, { inline_keyboard: [] });
    assert.equal((await dosisLogs.listarPorPaciente(paciente.id)).length, 1);
  });

  test('un botón con formato raro no coincide con el patrón', () => {
    assert.equal(RE_TOME.test('tome:123'), false);
    assert.equal(RE_TOME.test('tome:ninguno'), true);
  });
});
