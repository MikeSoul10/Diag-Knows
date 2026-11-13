/**
 * DK-302: alta de medicamentos por el paciente, recordatorios, respuesta
 * «Ya la tomé / No la tomé» y dosis OMITIDA. Todo con repos mock y reloj fijo.
 */
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  crearServicioMedicamentos,
  MAX_HORARIOS,
  parsearHoras,
  TTL_ALTA_MINUTOS,
} from '../src/services/medicamentos.js';
import {
  crearServicioRecordatorios,
  MARGEN_OMITIDA_MINUTOS,
  RE_DOSIS,
  VENTANA_ENVIO_MINUTOS,
} from '../src/services/recordatorios.js';
import { enviarRecordatorios, marcarOmitidas } from '../src/jobs/scheduler.js';
import {
  crearEnviadorRecordatorios,
  registrarMedicamentos,
} from '../src/channel/handlers/medicamentos.js';
import { BOTONES_MENU } from '../src/channel/format.js';
import {
  patients,
  consentimiento,
  medicamentos,
  horarios,
  dosisLogs,
  eliminarPaciente,
  reiniciarRepositorios,
} from '../src/repositories/index.js';

process.env.USE_MOCK_REPOS = 'true';

const CHAT = 930001;
const OTRO_CHAT = 930002;
const ZONA = 'America/Mexico_City'; // UTC-6 todo el año

/** Hora local de Ciudad de México del 12 nov 2026 → Date UTC. */
function local(hhmm, dia = 12) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, dia, h + 6, m));
}

async function pacienteConConsentimiento(chatId = CHAT) {
  const paciente = await patients.findOrCreate(chatId);
  await consentimiento.registrar({
    pacienteId: paciente.id,
    aceptado: true,
    versionPrivacidad: 'v1.0',
  });
  return paciente;
}

async function medicamentoConHorario(pacienteId, horas = ['08:00']) {
  const med = await medicamentos.crear({ pacienteId, nombre: 'Metformina', dosis: '850 mg' });
  for (const hora of horas) await horarios.crear({ medicamentoId: med.id, horaProgramada: hora });
  return med;
}

function crearRecordatorios(reloj) {
  return crearServicioRecordatorios({ ahora: () => reloj.ahora, zonaHorariaPorDefecto: ZONA });
}

beforeEach(() => reiniciarRepositorios());

// ---------------------------------------------------------------------------
// Horas
// ---------------------------------------------------------------------------

describe('parsearHoras', () => {
  const casos = [
    ['8', ['08:00']],
    ['08:00', ['08:00']],
    ['8 am', ['08:00']],
    ['8:30 pm', ['20:30']],
    ['8 de la noche', ['20:00']],
    ['a las 8 de la mañana', ['08:00']],
    ['mediodía', ['12:00']],
    ['12 am', ['00:00']],
    ['20 hrs', ['20:00']],
    ['7.30', ['07:30']],
    ['8 y 20', ['08:00', '20:00']],
    ['20:00, 8:00 y 14:00', ['08:00', '14:00', '20:00']],
    ['8 y 8:00', ['08:00']],
  ];
  for (const [texto, esperado] of casos) {
    test(`"${texto}" → ${esperado.join(', ')}`, () => {
      assert.deepEqual(parsearHoras(texto), esperado);
    });
  }

  for (const texto of ['', 'hola', '25', '8:75', '15 pm', 'en la mañana']) {
    test(`"${texto}" no se entiende`, () => {
      assert.equal(parsearHoras(texto), null);
    });
  }
});

// ---------------------------------------------------------------------------
// Alta de medicamento
// ---------------------------------------------------------------------------

describe('alta de medicamento por el paciente', () => {
  function crearHarness() {
    const reloj = { ahora: local('10:00') };
    const servicio = crearServicioMedicamentos({ ahora: () => reloj.ahora });
    return { servicio, reloj };
  }

  async function llegarAlResumen(servicio, horasTexto = '8 y 20') {
    await servicio.iniciarAlta({ chatId: CHAT });
    await servicio.procesarTexto({ chatId: CHAT, texto: 'Metformina' });
    await servicio.procesarTexto({ chatId: CHAT, texto: '850 mg' });
    return servicio.procesarTexto({ chatId: CHAT, texto: horasTexto });
  }

  test('sin medicamentos: lo dice y ofrece agregar uno', async () => {
    const { servicio } = crearHarness();
    await pacienteConConsentimiento();

    const respuesta = await servicio.listar({ chatId: CHAT });
    assert.match(respuesta.texto, /Todavía no tienes medicamentos/);
    assert.equal(respuesta.botones[0][0].callback, 'med:nuevo');
  });

  test('nombre → dosis → horas → resumen con botones, sin guardar todavía', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const inicio = await servicio.iniciarAlta({ chatId: CHAT });
    assert.match(inicio.texto, /¿Cómo se llama\?/);
    assert.equal(inicio.editarMensaje, false);
    assert.equal(servicio.tieneAltaEnCurso(CHAT), true);

    const dosis = await servicio.procesarTexto({ chatId: CHAT, texto: 'Metformina' });
    assert.match(dosis.texto, /¿Qué dosis tomas de <b>Metformina<\/b>\?/);

    const hora = await servicio.procesarTexto({ chatId: CHAT, texto: '850 mg' });
    assert.match(hora.texto, /¿A qué hora te toca\?/);

    const resumen = await servicio.procesarTexto({ chatId: CHAT, texto: '8 y 8 pm' });
    assert.match(resumen.texto, /Medicamento: <b>Metformina<\/b>/);
    assert.match(resumen.texto, /Dosis: 850 mg/);
    assert.match(resumen.texto, /todos los días a las 08:00 y 20:00/);
    assert.deepEqual(
      resumen.botones.flat().map(({ callback }) => callback),
      ['med:ok', 'med:no']
    );

    assert.equal((await medicamentos.listarPorPaciente(paciente.id)).length, 0);
  });

  test('«Sí, guardar» crea el medicamento con sus horarios y vuelve el menú', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();
    await llegarAlResumen(servicio);

    const guardado = await servicio.confirmar({ chatId: CHAT });
    assert.match(guardado.texto, /Listo, guardé <b>Metformina<\/b>/);
    assert.equal(guardado.mostrarMenu, true);
    assert.equal(servicio.tieneAltaEnCurso(CHAT), false);

    const [med] = await medicamentos.listarPorPaciente(paciente.id);
    assert.equal(med.nombre, 'Metformina');
    assert.equal(med.dosis, '850 mg');
    const horas = (await horarios.listarPorPaciente(paciente.id)).map((h) => h.horaProgramada);
    assert.deepEqual(horas, ['08:00', '20:00']);

    const lista = await servicio.listar({ chatId: CHAT });
    assert.match(lista.texto, /<b>Metformina<\/b> 850 mg — ⏰ 08:00 y 20:00/);
  });

  test('un segundo clic en «Sí, guardar» no duplica el medicamento', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();
    await llegarAlResumen(servicio);

    await servicio.confirmar({ chatId: CHAT });
    const otra = await servicio.confirmar({ chatId: CHAT });
    assert.match(otra.texto, /ya no está vigente/);
    assert.equal((await medicamentos.listarPorPaciente(paciente.id)).length, 1);
  });

  test('«Corregir» vuelve a empezar y no guarda nada', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();
    await llegarAlResumen(servicio);

    const respuesta = await servicio.corregir({ chatId: CHAT });
    assert.match(respuesta.texto, /no guardé nada/);
    const pregunta = await servicio.procesarTexto({ chatId: CHAT, texto: 'Losartán' });
    assert.match(pregunta.texto, /Losartán/);
    assert.equal((await medicamentos.listarPorPaciente(paciente.id)).length, 0);
  });

  test('hora que no se entiende o demasiadas horas: lo pide de nuevo', async () => {
    const { servicio } = crearHarness();
    await pacienteConConsentimiento();

    const malo = await llegarAlResumen(servicio, 'cuando me acuerde');
    assert.match(malo.texto, /No entendí la hora/);

    const muchas = await servicio.procesarTexto({ chatId: CHAT, texto: '6, 9, 12, 15 y 18' });
    assert.match(muchas.texto, new RegExp(`hasta ${MAX_HORARIOS} veces`));
  });

  test('«no sé» la dosis se guarda como sin dosis', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();
    await servicio.iniciarAlta({ chatId: CHAT });
    await servicio.procesarTexto({ chatId: CHAT, texto: 'Losartán' });
    await servicio.procesarTexto({ chatId: CHAT, texto: 'no sé' });
    const resumen = await servicio.procesarTexto({ chatId: CHAT, texto: '9' });
    assert.match(resumen.texto, /Dosis: sin especificar/);
    await servicio.confirmar({ chatId: CHAT });

    const lista = await servicio.listar({ chatId: CHAT });
    assert.match(lista.texto, /<b>Losartán<\/b> — ⏰ 09:00/);
    assert.equal((await medicamentos.listarPorPaciente(paciente.id))[0].dosis, 'sin dosis');
  });

  test(`un alta abandonada caduca a los ${TTL_ALTA_MINUTOS} minutos`, async () => {
    const { servicio, reloj } = crearHarness();
    await pacienteConConsentimiento();
    await servicio.iniciarAlta({ chatId: CHAT });

    reloj.ahora = new Date(reloj.ahora.getTime() + (TTL_ALTA_MINUTOS + 1) * 60 * 1000);
    assert.equal(servicio.tieneAltaEnCurso(CHAT), false);
  });

  test('cancelar descarta el alta', async () => {
    const { servicio } = crearHarness();
    await pacienteConConsentimiento();
    await servicio.iniciarAlta({ chatId: CHAT });
    assert.equal(servicio.cancelar({ chatId: CHAT }), true);
    assert.equal(servicio.tieneAltaEnCurso(CHAT), false);
  });

  test('sin consentimiento no hay lista ni alta', async () => {
    const { servicio } = crearHarness();
    await patients.findOrCreate(CHAT);
    assert.equal((await servicio.listar({ chatId: CHAT })).sinConsentimiento, true);
    assert.equal((await servicio.iniciarAlta({ chatId: CHAT })).sinConsentimiento, true);
  });

  test('el nombre del medicamento se escapa en el HTML', async () => {
    const { servicio } = crearHarness();
    await pacienteConConsentimiento();
    await servicio.iniciarAlta({ chatId: CHAT });
    const respuesta = await servicio.procesarTexto({ chatId: CHAT, texto: '<b>X</b> & Y' });
    assert.match(respuesta.texto, /&lt;b&gt;X&lt;\/b&gt; &amp; Y/);
  });
});

// ---------------------------------------------------------------------------
// Recordatorios
// ---------------------------------------------------------------------------

describe('recordatorios', () => {
  test('a la hora del paciente crea la dosis PENDIENTE y arma el aviso con botones', async () => {
    const reloj = { ahora: local('08:00') };
    const servicio = crearRecordatorios(reloj);
    const paciente = await pacienteConConsentimiento();
    await medicamentoConHorario(paciente.id);

    const [aviso, ...resto] = await servicio.pendientesDeEnviar();
    assert.equal(resto.length, 0);
    assert.equal(aviso.chatId, String(CHAT));
    assert.match(aviso.texto, /Es hora de tu <b>Metformina<\/b> \(850 mg\) de las 08:00/);
    assert.deepEqual(
      aviso.botones.flat().map(({ callback }) => callback),
      [`dosis:ok:${aviso.registroId}`, `dosis:no:${aviso.registroId}`]
    );
    for (const { callback } of aviso.botones.flat()) {
      assert.ok(Buffer.byteLength(callback) <= 64);
      assert.match(callback, RE_DOSIS);
    }

    const [dosis] = await dosisLogs.listarPorPaciente(paciente.id);
    assert.equal(dosis.estado, 'PENDIENTE');
    assert.equal(dosis.tomadaEn, local('08:00').toISOString());
  });

  test('no repite el recordatorio aunque el cron vuelva a correr', async () => {
    const reloj = { ahora: local('08:00') };
    const servicio = crearRecordatorios(reloj);
    const paciente = await pacienteConConsentimiento();
    await medicamentoConHorario(paciente.id);

    assert.equal((await servicio.pendientesDeEnviar()).length, 1);
    reloj.ahora = local('08:01');
    assert.equal((await servicio.pendientesDeEnviar()).length, 0);
    assert.equal((await dosisLogs.listarPorPaciente(paciente.id)).length, 1);
  });

  test(`antes de la hora no manda nada; con el bot caído hasta ${VENTANA_ENVIO_MINUTOS} min todavía manda`, async () => {
    const reloj = { ahora: local('07:59') };
    const servicio = crearRecordatorios(reloj);
    const paciente = await pacienteConConsentimiento();
    await medicamentoConHorario(paciente.id);

    assert.equal((await servicio.pendientesDeEnviar()).length, 0);
    reloj.ahora = local('08:09');
    assert.equal((await servicio.pendientesDeEnviar()).length, 1);
  });

  test('pasada la ventana ya no manda (no llegan recordatorios viejos)', async () => {
    const reloj = { ahora: local('08:30') };
    const servicio = crearRecordatorios(reloj);
    const paciente = await pacienteConConsentimiento();
    await medicamentoConHorario(paciente.id);

    assert.equal((await servicio.pendientesDeEnviar()).length, 0);
  });

  test('cerca de medianoche usa el día correcto', async () => {
    const reloj = { ahora: local('00:03', 13) };
    const servicio = crearRecordatorios(reloj);
    const paciente = await pacienteConConsentimiento();
    await medicamentoConHorario(paciente.id, ['23:58']);

    const [aviso] = await servicio.pendientesDeEnviar();
    assert.ok(aviso);
    const [dosis] = await dosisLogs.listarPorPaciente(paciente.id);
    assert.equal(dosis.tomadaEn, local('23:58', 12).toISOString());
  });

  test('respeta la zona horaria de cada paciente', async () => {
    const reloj = { ahora: local('08:00') }; // 14:00 UTC
    const servicio = crearRecordatorios(reloj);
    const paciente = await pacienteConConsentimiento();
    await medicamentoConHorario(paciente.id);

    // Si el paciente estuviera en Madrid (UTC+1), sus 08:00 ya pasaron hace horas.
    const original = horarios.listarParaRecordatorio;
    const conZona = async () =>
      (await original()).map((h) => ({ ...h, zonaHoraria: 'Europe/Madrid' }));
    const servicioMadrid = crearServicioRecordatorios({
      repos: { patients, dosisLogs, horarios: { listarParaRecordatorio: conZona } },
      ahora: () => reloj.ahora,
    });
    assert.equal((await servicioMadrid.pendientesDeEnviar()).length, 0);
    assert.equal((await servicio.pendientesDeEnviar()).length, 1);
  });

  test('sin consentimiento vigente no recibe recordatorios', async () => {
    const reloj = { ahora: local('08:00') };
    const servicio = crearRecordatorios(reloj);
    const paciente = await pacienteConConsentimiento();
    await medicamentoConHorario(paciente.id);
    await consentimiento.registrar({
      pacienteId: paciente.id,
      aceptado: false,
      versionPrivacidad: 'v1.0',
    });

    assert.equal((await servicio.pendientesDeEnviar()).length, 0);
  });

  test('«Ya la tomé» deja TOMADA; un segundo clic dice que ya estaba contestado', async () => {
    const reloj = { ahora: local('08:00') };
    const servicio = crearRecordatorios(reloj);
    const paciente = await pacienteConConsentimiento();
    await medicamentoConHorario(paciente.id);
    const [aviso] = await servicio.pendientesDeEnviar();

    reloj.ahora = local('08:05');
    const respuesta = await servicio.responder({
      chatId: CHAT,
      registroId: aviso.registroId,
      tomada: true,
    });
    assert.match(respuesta.texto, /ya tomaste/);
    assert.equal(respuesta.editarMensaje, true);

    const [dosis] = await dosisLogs.listarPorPaciente(paciente.id);
    assert.equal(dosis.estado, 'TOMADA');
    assert.equal(dosis.tomadaEn, local('08:05').toISOString());

    const otra = await servicio.responder({
      chatId: CHAT,
      registroId: aviso.registroId,
      tomada: false,
    });
    assert.match(otra.texto, /ya estaba contestado/);
    assert.equal((await dosisLogs.listarPorPaciente(paciente.id))[0].estado, 'TOMADA');
  });

  test('«No la tomé» deja SALTADA y remite al médico sin aconsejar', async () => {
    const reloj = { ahora: local('08:00') };
    const servicio = crearRecordatorios(reloj);
    const paciente = await pacienteConConsentimiento();
    await medicamentoConHorario(paciente.id);
    const [aviso] = await servicio.pendientesDeEnviar();

    const respuesta = await servicio.responder({
      chatId: CHAT,
      registroId: aviso.registroId,
      tomada: false,
    });
    assert.match(respuesta.texto, /consúltalo con tu médico/);
    assert.doesNotMatch(respuesta.texto, /dosis doble|tómala ahora/i);
    assert.equal((await dosisLogs.listarPorPaciente(paciente.id))[0].estado, 'SALTADA');
  });

  test('otro paciente no puede contestar un recordatorio ajeno', async () => {
    const reloj = { ahora: local('08:00') };
    const servicio = crearRecordatorios(reloj);
    const paciente = await pacienteConConsentimiento();
    await pacienteConConsentimiento(OTRO_CHAT);
    await medicamentoConHorario(paciente.id);
    const [aviso] = await servicio.pendientesDeEnviar();

    await servicio.responder({ chatId: OTRO_CHAT, registroId: aviso.registroId, tomada: true });
    assert.equal((await dosisLogs.listarPorPaciente(paciente.id))[0].estado, 'PENDIENTE');
  });

  test(`sin respuesta en ${MARGEN_OMITIDA_MINUTOS} min queda OMITIDA; contestar tarde la corrige`, async () => {
    const reloj = { ahora: local('08:00') };
    const servicio = crearRecordatorios(reloj);
    const paciente = await pacienteConConsentimiento();
    await medicamentoConHorario(paciente.id);
    const [aviso] = await servicio.pendientesDeEnviar();

    reloj.ahora = local('09:59');
    assert.equal(await servicio.marcarOmitidas(), 0);
    reloj.ahora = local('10:01');
    assert.equal(await servicio.marcarOmitidas(), 1);
    assert.equal((await dosisLogs.listarPorPaciente(paciente.id))[0].estado, 'OMITIDA');

    await servicio.responder({ chatId: CHAT, registroId: aviso.registroId, tomada: true });
    assert.equal((await dosisLogs.listarPorPaciente(paciente.id))[0].estado, 'TOMADA');
  });

  test('/borrar_datos se lleva medicamentos, horarios y dosis', async () => {
    const reloj = { ahora: local('08:00') };
    const servicio = crearRecordatorios(reloj);
    const paciente = await pacienteConConsentimiento();
    await medicamentoConHorario(paciente.id);
    await servicio.pendientesDeEnviar();

    await eliminarPaciente(paciente.id);
    assert.deepEqual(await horarios.listarParaRecordatorio(), []);
    assert.equal((await servicio.pendientesDeEnviar()).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Scheduler y canal
// ---------------------------------------------------------------------------

describe('scheduler', () => {
  test('un envío que falla no frena a los demás ni tumba el proceso', async () => {
    const enviados = [];
    const errores = [];
    const servicio = {
      pendientesDeEnviar: async () => [{ chatId: '1' }, { chatId: '2' }, { chatId: '3' }],
    };
    const enviar = async (aviso) => {
      if (aviso.chatId === '2') throw new Error('Forbidden: bot was blocked by the user');
      enviados.push(aviso.chatId);
    };

    const total = await enviarRecordatorios({
      servicio,
      enviar,
      registrarError: (contexto, error) => errores.push(`${contexto}: ${error.name}`),
    });

    assert.equal(total, 2);
    assert.deepEqual(enviados, ['1', '3']);
    assert.deepEqual(errores, ['el envío de un recordatorio: Error']);
  });

  test('si la BD falla, la vuelta termina en 0 sin lanzar', async () => {
    const errores = [];
    const registrarError = (contexto) => errores.push(contexto);
    const roto = {
      pendientesDeEnviar: async () => Promise.reject(new Error('sin BD')),
      marcarOmitidas: async () => Promise.reject(new Error('sin BD')),
    };
    assert.equal(
      await enviarRecordatorios({ servicio: roto, enviar: async () => {}, registrarError }),
      0
    );
    assert.equal(await marcarOmitidas({ servicio: roto, registrarError }), 0);
    assert.equal(errores.length, 2);
  });
});

describe('canal: medicamentos y recordatorios', () => {
  function crearBotFalso() {
    const handlers = new Map();
    const acciones = [];
    const enviados = [];
    return {
      bot: {
        command: (nombre, handler) => handlers.set(nombre, handler),
        hears: (texto, handler) => handlers.set(texto, handler),
        action: (patron, handler) => acciones.push({ patron, handler }),
        telegram: {
          sendMessage: async (chatId, texto, extra) => enviados.push({ chatId, texto, extra }),
        },
      },
      handlers,
      enviados,
      accionPara(datos) {
        return acciones.find(({ patron }) =>
          patron instanceof RegExp ? patron.test(datos) : patron === datos
        )?.handler;
      },
    };
  }

  function crearCtx({ data, chatId = CHAT } = {}) {
    const llamadas = { reply: [], editMessageText: [], answerCbQuery: [] };
    return {
      llamadas,
      ctx: {
        from: { id: chatId },
        callbackQuery: data ? { data } : undefined,
        match: data ? RE_DOSIS.exec(data) : undefined,
        reply: async (mensaje, extra) => llamadas.reply.push({ mensaje, extra }),
        editMessageText: async (mensaje, extra) =>
          llamadas.editMessageText.push({ mensaje, extra }),
        answerCbQuery: async (aviso) => llamadas.answerCbQuery.push(aviso),
      },
    };
  }

  test('el enviador manda HTML con los botones en línea', async () => {
    const falso = crearBotFalso();
    await crearEnviadorRecordatorios(falso.bot)({
      chatId: '930001',
      texto: '💊 Es hora',
      botones: [[{ texto: '✅ Ya la tomé', callback: 'dosis:ok:x' }]],
    });

    const [enviado] = falso.enviados;
    assert.equal(enviado.chatId, '930001');
    assert.equal(enviado.extra.parse_mode, 'HTML');
    assert.equal(enviado.extra.reply_markup.inline_keyboard[0][0].callback_data, 'dosis:ok:x');
  });

  test('/medicamentos y el botón del menú usan el mismo handler', () => {
    const falso = crearBotFalso();
    registrarMedicamentos(falso.bot);
    assert.ok(falso.handlers.get('medicamentos'));
    assert.equal(falso.handlers.get(BOTONES_MENU.medicamentos), falso.handlers.get('medicamentos'));
  });

  test('el botón «Ya la tomé» del recordatorio registra la toma y edita el mensaje', async () => {
    const reloj = { ahora: local('08:00') };
    const recordatorios = crearRecordatorios(reloj);
    const paciente = await pacienteConConsentimiento();
    await medicamentoConHorario(paciente.id);
    const [aviso] = await recordatorios.pendientesDeEnviar();

    const falso = crearBotFalso();
    registrarMedicamentos(falso.bot, { recordatorios });
    const datos = `dosis:ok:${aviso.registroId}`;
    const { ctx, llamadas } = crearCtx({ data: datos });
    await falso.accionPara(datos)(ctx);

    assert.deepEqual(llamadas.answerCbQuery, ['Registrado']);
    assert.match(llamadas.editMessageText[0].mensaje, /ya tomaste/);
    assert.equal((await dosisLogs.listarPorPaciente(paciente.id))[0].estado, 'TOMADA');
  });
});
