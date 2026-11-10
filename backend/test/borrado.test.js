import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.USE_MOCK_AI = 'true';
process.env.USE_MOCK_REPOS = 'true';

import {
  patients,
  consentimiento,
  enfermedades,
  mediciones,
  sintomas,
  medicamentos,
  dosisLogs,
  eliminarPaciente,
  reiniciarRepositorios,
} from '../src/repositories/index.js';
import {
  crearServicioBorrado,
  TTL_CONFIRMACION_MS,
  TEXTO_BORRADO,
  TEXTO_CANCELADO,
  TEXTO_SIN_DATOS,
  TEXTO_ERROR,
} from '../src/services/borrado.js';
import { registrarComandoBorrado, RE_BORRADO } from '../src/channel/handlers/borrado.js';
import { COMANDOS } from '../src/channel/bot.js';
import { AYUDA } from '../src/channel/format.js';

const CHAT = 920001;
const OTRO_CHAT = 920002;

async function pacienteConDatos(chatId) {
  const paciente = await patients.findOrCreate(chatId);
  await consentimiento.registrar({
    pacienteId: paciente.id,
    aceptado: true,
    versionPrivacidad: 'v1.0',
  });
  const [enfermedad] = await enfermedades.listar();
  await enfermedades.asignar({ pacienteId: paciente.id, enfermedadId: enfermedad.id });
  await mediciones.guardarMedicion({ pacienteId: paciente.id, tipo: 'glucosa', valor: 110 });
  await sintomas.guardarSintoma({
    pacienteId: paciente.id,
    descripcion: 'dolor de cabeza',
    nivelGravedad: 'LEVE',
  });
  await medicamentos.crear({ pacienteId: paciente.id, nombre: 'Metformina' });
  await dosisLogs.guardarTomaMedicamento({ pacienteId: paciente.id, tomada: true });
  return paciente;
}

async function contarTodo(pacienteId) {
  return {
    consentimientos: (await consentimiento.listarPorPaciente(pacienteId)).length,
    enfermedades: (await enfermedades.listarPorPaciente(pacienteId)).length,
    mediciones: (await mediciones.listarPorPaciente(pacienteId)).length,
    sintomas: (await sintomas.listarPorPaciente(pacienteId)).length,
    medicamentos: (await medicamentos.listarPorPaciente(pacienteId)).length,
    tomas: (await dosisLogs.listarPorPaciente(pacienteId)).length,
  };
}

function crearServicio(extra = {}) {
  let ms = Date.parse('2026-11-08T20:00:00.000Z');
  let n = 0;
  const llamadas = { limpiar: [] };
  const servicio = crearServicioBorrado({
    obtenerPaciente: (chatId) => patients.findByTelegramChatId(chatId),
    eliminarPaciente,
    limpiarEstado: async (chatId) => llamadas.limpiar.push(String(chatId)),
    ahora: () => new Date(ms),
    generarToken: () => (n += 1).toString(16).padStart(32, '0'),
    registrarError: () => {},
    ...extra,
  });
  return { servicio, llamadas, avanzar: (mas) => (ms += mas) };
}

const tokenDe = (respuesta, accion) =>
  respuesta.botones
    .flat()
    .find((boton) => boton.callback.startsWith(`del:${accion}:`))
    .callback.split(':')[2];

beforeEach(() => reiniciarRepositorios());

describe('repositorios: eliminarPaciente', () => {
  test('borra al paciente y todo lo suyo, y solo lo suyo', async () => {
    const mio = await pacienteConDatos(CHAT);
    const ajeno = await pacienteConDatos(OTRO_CHAT);

    assert.equal(await eliminarPaciente(mio.id), true);

    assert.equal(await patients.findById(mio.id), null);
    assert.equal(await patients.findByTelegramChatId(CHAT), null);
    for (const cantidad of Object.values(await contarTodo(mio.id))) assert.equal(cantidad, 0);

    assert.notEqual(await patients.findById(ajeno.id), null);
    for (const cantidad of Object.values(await contarTodo(ajeno.id))) assert.equal(cantidad, 1);
  });

  test('un paciente que no existe devuelve false', async () => {
    assert.equal(await eliminarPaciente('no-existe'), false);
  });

  test('tras borrar, el mismo chat puede registrarse de nuevo desde cero', async () => {
    const viejo = await pacienteConDatos(CHAT);
    await eliminarPaciente(viejo.id);

    const nuevo = await patients.findOrCreate(CHAT);
    assert.notEqual(nuevo.id, viejo.id);
    assert.equal(nuevo.consentimientoVigente, false);
    assert.equal(nuevo.alias ?? null, null);
  });
});

describe('servicio /borrar_datos', () => {
  test('sin datos no ofrece borrar', async () => {
    const { servicio } = crearServicio();
    const respuesta = await servicio.solicitar({ chatId: CHAT });
    assert.equal(respuesta.texto, TEXTO_SIN_DATOS);
    assert.equal(respuesta.botones, undefined);
  });

  test('pedirlo solo pregunta: no borra nada todavía', async () => {
    const paciente = await pacienteConDatos(CHAT);
    const { servicio } = crearServicio();

    const respuesta = await servicio.solicitar({ chatId: CHAT });
    assert.match(respuesta.texto, /permanente/);
    assert.match(respuesta.texto, /No se puede deshacer/);
    assert.equal(respuesta.botones.flat().length, 2);
    for (const boton of respuesta.botones.flat()) {
      assert.match(boton.callback, RE_BORRADO);
      assert.ok(Buffer.byteLength(boton.callback) <= 64);
    }
    assert.notEqual(await patients.findById(paciente.id), null);
  });

  test('confirmar borra todo y descarta lo que estuviera a medias', async () => {
    const paciente = await pacienteConDatos(CHAT);
    const { servicio, llamadas } = crearServicio();

    const pregunta = await servicio.solicitar({ chatId: CHAT });
    const respuesta = await servicio.confirmar({ chatId: CHAT, token: tokenDe(pregunta, 'ok') });

    assert.equal(respuesta.texto, TEXTO_BORRADO);
    assert.equal(await patients.findById(paciente.id), null);
    for (const cantidad of Object.values(await contarTodo(paciente.id))) assert.equal(cantidad, 0);
    assert.deepEqual(llamadas.limpiar, [String(CHAT)]);
  });

  test('cancelar no borra nada', async () => {
    const paciente = await pacienteConDatos(CHAT);
    const { servicio } = crearServicio();

    const pregunta = await servicio.solicitar({ chatId: CHAT });
    const respuesta = await servicio.cancelar({ chatId: CHAT, token: tokenDe(pregunta, 'no') });

    assert.equal(respuesta.texto, TEXTO_CANCELADO);
    assert.notEqual(await patients.findById(paciente.id), null);
    assert.equal((await contarTodo(paciente.id)).mediciones, 1);
  });

  test('el token es de un solo uso: un segundo clic no borra otra vez', async () => {
    await pacienteConDatos(CHAT);
    const { servicio } = crearServicio();

    const pregunta = await servicio.solicitar({ chatId: CHAT });
    const token = tokenDe(pregunta, 'ok');
    await servicio.confirmar({ chatId: CHAT, token });

    // Si el paciente se vuelve a registrar, el botón viejo no le borra lo nuevo.
    const nuevo = await pacienteConDatos(CHAT);
    const segundo = await servicio.confirmar({ chatId: CHAT, token });
    assert.equal(segundo.aviso, 'Ya no está vigente');
    assert.notEqual(await patients.findById(nuevo.id), null);
  });

  test('un token equivocado o de otro chat no borra', async () => {
    const paciente = await pacienteConDatos(CHAT);
    await pacienteConDatos(OTRO_CHAT);
    const { servicio } = crearServicio();

    const pregunta = await servicio.solicitar({ chatId: CHAT });
    const token = tokenDe(pregunta, 'ok');

    assert.equal(
      (await servicio.confirmar({ chatId: CHAT, token: 'f'.repeat(32) })).aviso,
      'Ya no está vigente'
    );
    assert.equal(
      (await servicio.confirmar({ chatId: OTRO_CHAT, token })).aviso,
      'Ya no está vigente'
    );
    assert.notEqual(await patients.findById(paciente.id), null);
    assert.notEqual(await patients.findByTelegramChatId(OTRO_CHAT), null);
  });

  test('la confirmación caduca a los 5 minutos', async () => {
    const paciente = await pacienteConDatos(CHAT);
    const { servicio, avanzar } = crearServicio();

    const pregunta = await servicio.solicitar({ chatId: CHAT });
    avanzar(TTL_CONFIRMACION_MS + 1000);

    const respuesta = await servicio.confirmar({ chatId: CHAT, token: tokenDe(pregunta, 'ok') });
    assert.equal(respuesta.aviso, 'Ya no está vigente');
    assert.notEqual(await patients.findById(paciente.id), null);
  });

  test('pedirlo otra vez invalida los botones anteriores', async () => {
    const paciente = await pacienteConDatos(CHAT);
    const { servicio } = crearServicio();

    const primera = await servicio.solicitar({ chatId: CHAT });
    await servicio.solicitar({ chatId: CHAT });

    const respuesta = await servicio.confirmar({ chatId: CHAT, token: tokenDe(primera, 'ok') });
    assert.equal(respuesta.aviso, 'Ya no está vigente');
    assert.notEqual(await patients.findById(paciente.id), null);
  });

  test('si el borrado falla, avisa y no registra datos del paciente', async () => {
    await pacienteConDatos(CHAT);
    const errores = [];
    const { servicio } = crearServicio({
      eliminarPaciente: async () => {
        throw new Error('dolor de cabeza 110');
      },
      registrarError: (contexto, error) => errores.push(`${contexto}:${error.name}`),
    });

    const pregunta = await servicio.solicitar({ chatId: CHAT });
    const respuesta = await servicio.confirmar({ chatId: CHAT, token: tokenDe(pregunta, 'ok') });

    assert.equal(respuesta.texto, TEXTO_ERROR);
    assert.equal(respuesta.error, true);
    assert.deepEqual(errores, ['el borrado de datos:Error']);
  });
});

describe('adaptador /borrar_datos', () => {
  function crearBotFalso(servicio) {
    const comandos = new Map();
    const acciones = [];
    registrarComandoBorrado(
      {
        command: (nombre, handler) => comandos.set(nombre, handler),
        action: (patron, handler) => acciones.push({ patron, handler }),
      },
      servicio
    );
    return { comandos, acciones };
  }

  function crearCtx({ data } = {}) {
    const llamadas = { reply: [], editMessageText: [], answerCbQuery: [] };
    return {
      llamadas,
      ctx: {
        from: { id: CHAT },
        callbackQuery: data === undefined ? undefined : { data },
        match: data === undefined ? undefined : RE_BORRADO.exec(data),
        reply: async (m, e) => llamadas.reply.push({ m, e }),
        editMessageText: async (m, e) => llamadas.editMessageText.push({ m, e }),
        answerCbQuery: async (a) => llamadas.answerCbQuery.push(a),
      },
    };
  }

  test('está en el menú y en la ayuda', () => {
    assert.ok(COMANDOS.some(({ command }) => command === 'borrar_datos'));
    assert.match(AYUDA, /\/borrar_datos/);
  });

  test('el comando pregunta con botones y el botón "Sí" borra y edita el mensaje', async () => {
    const paciente = await pacienteConDatos(CHAT);
    const { servicio } = crearServicio();
    const { comandos, acciones } = crearBotFalso(servicio);

    const primero = crearCtx();
    await comandos.get('borrar_datos')(primero.ctx);
    const teclado = primero.llamadas.reply[0].e.reply_markup.inline_keyboard;
    assert.equal(teclado.length, 2);
    assert.equal((await patients.findById(paciente.id)) !== null, true);

    const dato = teclado[0][0].callback_data;
    assert.match(dato, RE_BORRADO);
    const accion = acciones.find(({ patron }) => patron.test(dato));
    const segundo = crearCtx({ data: dato });
    await accion.handler(segundo.ctx);

    assert.match(segundo.llamadas.editMessageText[0].m, /borré todos tus datos/);
    assert.deepEqual(segundo.llamadas.editMessageText[0].e.reply_markup, { inline_keyboard: [] });
    assert.equal(await patients.findById(paciente.id), null);
  });

  test('el botón "No" conserva todo', async () => {
    const paciente = await pacienteConDatos(CHAT);
    const { servicio } = crearServicio();
    const { comandos, acciones } = crearBotFalso(servicio);

    const primero = crearCtx();
    await comandos.get('borrar_datos')(primero.ctx);
    const dato = primero.llamadas.reply[0].e.reply_markup.inline_keyboard[1][0].callback_data;

    const segundo = crearCtx({ data: dato });
    await acciones.find(({ patron }) => patron.test(dato)).handler(segundo.ctx);

    assert.match(segundo.llamadas.editMessageText[0].m, /no borré nada/);
    assert.notEqual(await patients.findById(paciente.id), null);
  });

  test('un callback con formato raro no coincide con el patrón', () => {
    assert.equal(RE_BORRADO.test('del:ok:123'), false);
    assert.equal(RE_BORRADO.test(`del:todo:${'a'.repeat(32)}`), false);
    assert.equal(RE_BORRADO.test(`del:ok:${'a'.repeat(32)}`), true);
  });
});
