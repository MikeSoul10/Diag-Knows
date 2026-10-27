import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { crearAlmacenMemoria } from '../src/services/conversacion.js';
import {
  crearConversacion,
  generarTokenConversacion,
  conversacion as conversacionCanal,
  almacenConversacion,
  hayConversacionPendiente,
} from '../src/channel/conversacion.instancia.js';
import { registrarMensajes } from '../src/channel/handlers/message.js';
import { registrarMenu } from '../src/channel/handlers/menu.js';
import {
  parsearCallbackConversacion,
  registrarCallbacks,
} from '../src/channel/handlers/callbacks.js';
import { publicarComandos, COMANDOS } from '../src/channel/bot.js';
import {
  AVISO_PRIVACIDAD,
  MENSAJE_SOLO_TEXTO,
  tecladoConversacion,
} from '../src/channel/format.js';
import {
  TEXTO_ERROR_CONVERSACION,
  responderConversacion,
} from '../src/channel/handlers/render.js';
import {
  patients,
  consentimiento,
  mediciones,
  reiniciarRepositorios,
} from '../src/repositories/index.js';
import * as registration from '../src/services/registration.service.js';
import { __reset as reiniciarSesiones, existe as haySesion } from '../src/services/session.store.js';

// Determinista: sin Claude y sin PostgreSQL aunque la máquina tenga las llaves.
process.env.USE_MOCK_AI = 'true';
process.env.USE_MOCK_REPOS = 'true';

const CHAT = 800001;
const OTRO_CHAT = 800002;

// ---------------------------------------------------------------------------
// Dobles de prueba
// ---------------------------------------------------------------------------

/** Bot mínimo que solo guarda los handlers registrados. */
function crearBotFalso() {
  const comandos = new Map();
  const acciones = [];
  const eventos = {};
  const telegram = { comandosPublicados: null };

  telegram.setMyCommands = async (comandosPublicados) => {
    telegram.comandosPublicados = comandosPublicados;
  };

  return {
    bot: {
      command(nombre, handler) {
        comandos.set(nombre, handler);
      },
      action(patron, handler) {
        acciones.push({ patron, handler });
      },
      on(tipos, handler) {
        if (typeof tipos === 'function') eventos.texto = handler;
        else eventos.noTexto = { tipos, handler };
      },
      telegram,
    },
    comandos,
    acciones,
    eventos,
    telegram,
    accionPara(datos) {
      const encontrada = acciones.find(({ patron }) =>
        patron instanceof RegExp ? patron.test(datos) : patron === datos
      );
      return encontrada?.handler ?? null;
    },
  };
}

/** Contexto de Telegraf mínimo, con todas las llamadas registradas. */
function crearCtx({ chatId = CHAT, texto, data, editarLanza } = {}) {
  const llamadas = { reply: [], editMessageText: [], answerCbQuery: [] };

  return {
    llamadas,
    ctx: {
      from: { id: chatId },
      chat: { id: chatId },
      message: texto === undefined ? undefined : { text: texto },
      callbackQuery: data === undefined ? undefined : { data },
      async reply(mensaje, extra) {
        llamadas.reply.push({ mensaje, extra });
      },
      async editMessageText(mensaje, extra) {
        if (editarLanza) throw editarLanza;
        llamadas.editMessageText.push({ mensaje, extra });
      },
      async answerCbQuery(aviso) {
        llamadas.answerCbQuery.push(aviso);
      },
    },
  };
}

/** Servicio de conversación falso que cuenta sus llamadas. */
function crearServicioFalso({ respuesta = { texto: 'respuesta falsa' }, fallar = null } = {}) {
  const llamadas = [];

  const anotar = (nombre, datos) => {
    llamadas.push({ nombre, datos });
    if (fallar === nombre) throw new Error('fallo simulado del servicio');
    return respuesta;
  };

  return {
    llamadas,
    procesarMensaje: async (datos) => anotar('procesarMensaje', datos),
    iniciar: async (datos) => anotar('iniciar', datos),
    procesarCallback: async (datos) => anotar('procesarCallback', datos),
    cancelar: async (datos) => anotar('cancelar', datos),
  };
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

function botonesDe(respuesta) {
  return (respuesta.botones ?? []).flat();
}

function tokenDe(respuesta, prefijo = 'conv:ok:') {
  const boton = botonesDe(respuesta).find(({ callback }) => callback.startsWith(prefijo));
  return boton ? boton.callback.split(':')[2] : null;
}

beforeEach(() => {
  reiniciarRepositorios();
  reiniciarSesiones();
  almacenConversacion.__reset();
  process.env.USE_MOCK_AI = 'true';
  process.env.USE_MOCK_REPOS = 'true';
});

// ---------------------------------------------------------------------------
// 1. Instancia del servicio
// ---------------------------------------------------------------------------

describe('instancia de la conversación', () => {
  test('el token de los botones son 16 bytes en hex', () => {
    const token = generarTokenConversacion();
    assert.match(token, /^[0-9a-f]{32}$/);
    assert.notEqual(token, generarTokenConversacion());
  });

  test('ningún callback_data supera los 64 bytes de Telegram', async () => {
    const servicio = crearConversacion({ almacen: crearAlmacenMemoria() });
    await pacienteConConsentimiento();

    const preguntas = [
      await servicio.iniciar({ chatId: CHAT }),
      await servicio.procesarMensaje({ chatId: CHAT, texto: 'tengo mareo' }),
    ];

    const conIntensidad = await servicio.procesarCallback({
      chatId: CHAT,
      accion: 'sev',
      token: botonesDe(preguntas[1])[0].callback.split(':')[1],
      indice: 0,
      valor: 1,
    });
    preguntas.push(conIntensidad);

    const callbacks = preguntas
      .flatMap((respuesta) => botonesDe(respuesta))
      .map(({ callback }) => callback);

    assert.ok(callbacks.length >= 5);
    for (const callback of callbacks) {
      assert.ok(
        Buffer.byteLength(callback, 'utf8') <= 64,
        `callback_data demasiado largo: ${callback}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Formato: teclados y render
// ---------------------------------------------------------------------------

describe('formato de las respuestas', () => {
  test('los botones del servicio se convierten en un inline_keyboard', () => {
    const teclado = tecladoConversacion([
      [{ texto: 'Sí', callback: 'conv:ok:abc' }],
      [{ texto: 'No', callback: 'conv:no:abc' }],
    ]);

    // Telegraf agrega `hide: false`; lo que importa es texto y callback_data.
    const filas = teclado.reply_markup.inline_keyboard.map((fila) =>
      fila.map(({ text, callback_data }) => ({ text, callback_data }))
    );

    assert.deepEqual(filas, [
      [{ text: 'Sí', callback_data: 'conv:ok:abc' }],
      [{ text: 'No', callback_data: 'conv:no:abc' }],
    ]);
  });

  test('sin botones no hay teclado', () => {
    assert.equal(tecladoConversacion([]), null);
    assert.equal(tecladoConversacion(undefined), null);
  });

  test('un mensaje nuevo va con parse_mode HTML y su teclado', async () => {
    const { ctx, llamadas } = crearCtx();

    await responderConversacion(ctx, {
      texto: '<b>Hola</b>',
      botones: [[{ texto: 'Sí', callback: 'conv:ok:x' }]],
    });

    assert.equal(llamadas.reply.length, 1);
    assert.equal(llamadas.editMessageText.length, 0);
    const { mensaje, extra } = llamadas.reply[0];
    assert.equal(mensaje, '<b>Hola</b>');
    assert.equal(extra.parse_mode, 'HTML');
    assert.deepEqual(
      extra.reply_markup.inline_keyboard.map((fila) =>
        fila.map(({ text, callback_data }) => ({ text, callback_data }))
      ),
      [[{ text: 'Sí', callback_data: 'conv:ok:x' }]]
    );
  });

  test('editar cambia el mensaje original y quita los botones viejos', async () => {
    const { ctx, llamadas } = crearCtx();

    await responderConversacion(ctx, { texto: 'Listo', editarMensaje: true }, { editar: true });

    assert.equal(llamadas.reply.length, 0);
    assert.equal(llamadas.editMessageText.length, 1);
    const { extra } = llamadas.editMessageText[0];
    assert.equal(extra.parse_mode, 'HTML');
    assert.deepEqual(extra.reply_markup, { inline_keyboard: [] });
  });

  test('editar respeta el teclado nuevo cuando la respuesta lo trae', async () => {
    const { ctx, llamadas } = crearCtx();

    await responderConversacion(
      ctx,
      { texto: 'Resumen', editarMensaje: true, botones: [[{ texto: 'Ok', callback: 'conv:ok:x' }]] },
      { editar: true }
    );

    assert.deepEqual(
      llamadas.editMessageText[0].extra.reply_markup.inline_keyboard.map((fila) =>
        fila.map(({ text, callback_data }) => ({ text, callback_data }))
      ),
      [[{ text: 'Ok', callback_data: 'conv:ok:x' }]]
    );
  });

  test('si Telegram dice "message is not modified" no se rompe ni duplica', async () => {
    const error = Object.assign(new Error('Bad Request'), {
      description: 'Bad Request: message is not modified',
    });
    const { ctx, llamadas } = crearCtx({ editarLanza: error });

    await assert.doesNotReject(() =>
      responderConversacion(ctx, { texto: 'Igual', editarMensaje: true }, { editar: true })
    );
    assert.equal(llamadas.reply.length, 0);
  });

  test('si no se puede editar, el texto se manda como mensaje nuevo', async () => {
    const { ctx, llamadas } = crearCtx({ editarLanza: new Error('message to edit not found') });

    await responderConversacion(ctx, { texto: 'Resumen', editarMensaje: true }, { editar: true });

    assert.equal(llamadas.reply.length, 1);
    assert.equal(llamadas.reply[0].mensaje, 'Resumen');
  });
});

// ---------------------------------------------------------------------------
// 3. Parseo de callbacks
// ---------------------------------------------------------------------------

describe('parseo de callbacks de la conversación', () => {
  test('reconoce confirmar, corregir y omitir', () => {
    assert.deepEqual(parsearCallbackConversacion('conv:ok:0123456789abcdef'), {
      accion: 'ok',
      token: '0123456789abcdef',
    });
    assert.deepEqual(parsearCallbackConversacion('conv:no:abc123'), {
      accion: 'no',
      token: 'abc123',
    });
    assert.deepEqual(parsearCallbackConversacion('conv:skip:abc123'), {
      accion: 'skip',
      token: 'abc123',
    });
  });

  test('reconoce la intensidad con índice y valor numéricos', () => {
    assert.deepEqual(parsearCallbackConversacion('sev:abc123:2:3'), {
      accion: 'sev',
      token: 'abc123',
      indice: 2,
      valor: 3,
    });
  });

  test('ignora lo que no es de la conversación o viene malformado', () => {
    assert.equal(parsearCallbackConversacion('consent:yes'), null);
    assert.equal(parsearCallbackConversacion('reg:ok'), null);
    assert.equal(parsearCallbackConversacion('conv:ok:'), null);
    assert.equal(parsearCallbackConversacion('conv:ok:' + 'a'.repeat(33)), null);
    assert.equal(parsearCallbackConversacion('sev:abc:0:4'), null);
    assert.equal(parsearCallbackConversacion('sev:abc'), null);
    assert.equal(parsearCallbackConversacion(undefined), null);
  });
});

// ---------------------------------------------------------------------------
// 4. Handler de mensajes: orden de comprobaciones
// ---------------------------------------------------------------------------

describe('handler de mensajes', () => {
  test('sin consentimiento avisa de privacidad y no procesa nada', async () => {
    const bot = crearBotFalso();
    const servicio = crearServicioFalso();
    registrarMensajes(bot.bot, servicio);

    const { ctx, llamadas } = crearCtx({ texto: 'glucosa en 115' });
    await bot.eventos.texto(ctx);

    assert.equal(llamadas.reply.length, 1);
    assert.equal(llamadas.reply[0].mensaje, AVISO_PRIVACIDAD);
    assert.equal(servicio.llamadas.length, 0);
  });

  test('un registro a medias sigue alimentando el alta guiada', async () => {
    const bot = crearBotFalso();
    const servicio = crearServicioFalso();
    registrarMensajes(bot.bot, servicio);
    await pacienteConConsentimiento();
    await registration.iniciarRegistro(CHAT); // queda una sesión abierta

    const { ctx, llamadas } = crearCtx({ texto: 'Ana' });
    await bot.eventos.texto(ctx);

    assert.equal(servicio.llamadas.length, 0);
    assert.equal(llamadas.reply.length, 1);
    assert.match(llamadas.reply[0].mensaje, /año/i);
  });

  test('con el registro completo el texto va a la conversación', async () => {
    const bot = crearBotFalso();
    const servicio = crearServicioFalso({
      respuesta: { texto: '<b>Esto es lo que voy a registrar:</b>' },
    });
    registrarMensajes(bot.bot, servicio);
    await pacienteConConsentimiento();

    const { ctx, llamadas } = crearCtx({ texto: 'glucosa en 115' });
    await bot.eventos.texto(ctx);

    assert.deepEqual(servicio.llamadas, [
      { nombre: 'procesarMensaje', datos: { chatId: CHAT, texto: 'glucosa en 115' } },
    ]);
    assert.equal(llamadas.reply[0].extra.parse_mode, 'HTML');
  });

  test('los comandos no pasan por la conversación', async () => {
    const bot = crearBotFalso();
    const servicio = crearServicioFalso();
    registrarMensajes(bot.bot, servicio);
    await pacienteConConsentimiento();

    const { ctx, llamadas } = crearCtx({ texto: '/reportar' });
    await bot.eventos.texto(ctx);

    assert.equal(servicio.llamadas.length, 0);
    assert.equal(llamadas.reply.length, 0);
  });

  test('voz, fotos y archivos reciben una línea: solo se entiende texto', async () => {
    const bot = crearBotFalso();
    registrarMensajes(bot.bot, crearServicioFalso());

    assert.ok(bot.eventos.noTexto);
    assert.ok(bot.eventos.noTexto.tipos.includes('voice'));
    assert.ok(bot.eventos.noTexto.tipos.includes('photo'));

    const { ctx, llamadas } = crearCtx();
    await bot.eventos.noTexto.handler(ctx);

    assert.equal(llamadas.reply[0].mensaje, MENSAJE_SOLO_TEXTO);
  });

  test('un error del servicio no tumba el bot y avisa en genérico', async () => {
    const bot = crearBotFalso();
    const servicio = crearServicioFalso({ fallar: 'procesarMensaje' });
    registrarMensajes(bot.bot, servicio);
    await pacienteConConsentimiento();

    const errores = [];
    const original = console.error;
    console.error = (...args) => errores.push(args.join(' '));
    try {
      const { ctx, llamadas } = crearCtx({ texto: 'glucosa en 115' });
      await assert.doesNotReject(() => bot.eventos.texto(ctx));

      assert.equal(llamadas.reply[0].mensaje, TEXTO_ERROR_CONVERSACION);
      assert.equal(errores.length, 1);
      assert.match(errores[0], /Error/);
      assert.doesNotMatch(errores[0], /glucosa|115/);
    } finally {
      console.error = original;
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Botones de la conversación
// ---------------------------------------------------------------------------

describe('handler de callbacks', () => {
  test('confirmar responde el aviso y edita el mensaje del resumen', async () => {
    const bot = crearBotFalso();
    registrarCallbacks(bot.bot);
    const paciente = await pacienteConConsentimiento();

    const resumen = await conversacionCanal.procesarMensaje({
      chatId: CHAT,
      texto: 'glucosa en 115',
    });
    const token = tokenDe(resumen);
    const handler = bot.accionPara(`conv:ok:${token}`);

    assert.ok(handler, 'el callback de confirmar debe estar registrado');

    const { ctx, llamadas } = crearCtx({ data: `conv:ok:${token}` });
    await handler(ctx);

    assert.deepEqual(llamadas.answerCbQuery, ['Guardado']);
    assert.equal(llamadas.reply.length, 0);
    assert.equal(llamadas.editMessageText.length, 1);
    assert.match(llamadas.editMessageText[0].mensaje, /quedó guardado/);
    assert.equal((await mediciones.listarPorPaciente(paciente.id)).length, 1);
  });

  test('un token viejo avisa por el botón y contesta con un mensaje nuevo', async () => {
    const bot = crearBotFalso();
    registrarCallbacks(bot.bot);
    await pacienteConConsentimiento();

    const tokenViejo = '0123456789abcdef0123456789abcdef';
    const handler = bot.accionPara(`conv:ok:${tokenViejo}`);
    assert.ok(handler);

    const { ctx, llamadas } = crearCtx({ data: `conv:ok:${tokenViejo}` });
    await handler(ctx);

    assert.deepEqual(llamadas.answerCbQuery, ['Ya no está vigente']);
    assert.equal(llamadas.editMessageText.length, 0);
    assert.match(llamadas.reply[0].mensaje, /ya no está vigente/);
  });

  test('la intensidad de un síntoma se registra desde el botón', async () => {
    const bot = crearBotFalso();
    registrarCallbacks(bot.bot);
    await pacienteConConsentimiento();

    const pregunta = await conversacionCanal.procesarMensaje({ chatId: CHAT, texto: 'mareo' });
    const callback = botonesDe(pregunta)[2].callback; // Fuerte
    const handler = bot.accionPara(callback);
    assert.ok(handler);

    const { ctx, llamadas } = crearCtx({ data: callback });
    await handler(ctx);

    assert.equal(llamadas.answerCbQuery.length, 1);
    assert.equal(llamadas.editMessageText.length, 1);
    assert.match(llamadas.editMessageText[0].mensaje, /Mareo \(fuerte\)/);
  });

  test('si el servicio falla, igual se responde el callback y se avisa en genérico', async () => {
    const bot = crearBotFalso();
    const servicio = crearServicioFalso({ fallar: 'procesarCallback' });
    registrarCallbacks(bot.bot, servicio);

    const handler = bot.accionPara('conv:skip:abc');
    const { ctx, llamadas } = crearCtx({ data: 'conv:skip:abc' });

    const errores = [];
    const original = console.error;
    console.error = (...args) => errores.push(args.join(' '));
    try {
      await assert.doesNotReject(() => handler(ctx));
    } finally {
      console.error = original;
    }

    assert.equal(llamadas.answerCbQuery.length, 1);
    assert.match(llamadas.answerCbQuery[0], /No pude/);
    assert.equal(llamadas.reply[0].mensaje, TEXTO_ERROR_CONVERSACION);
    assert.equal(errores.length, 1);
  });
});

// ---------------------------------------------------------------------------
// 6. Comandos
// ---------------------------------------------------------------------------

describe('comandos del menú', () => {
  test('/reportar arranca el flujo guiado con HTML y su botón de omitir', async () => {
    const bot = crearBotFalso();
    registrarMenu(bot.bot);
    await pacienteConConsentimiento();

    const { ctx, llamadas } = crearCtx();
    await bot.comandos.get('reportar')(ctx);

    assert.equal(llamadas.reply.length, 1);
    assert.equal(llamadas.reply[0].extra.parse_mode, 'HTML');
    assert.match(llamadas.reply[0].mensaje, /Cómo te sentiste/);
    assert.equal(llamadas.reply[0].extra.reply_markup.inline_keyboard[0][0].callback_data.startsWith('conv:skip:'), true);
  });

  test('/cancelar limpia el registro a medias y la conversación', async () => {
    const bot = crearBotFalso();
    registrarMenu(bot.bot);
    await pacienteConConsentimiento();

    await registration.iniciarRegistro(CHAT);
    await conversacionCanal.iniciar({ chatId: CHAT });

    assert.equal(haySesion(CHAT), true);
    assert.equal(hayConversacionPendiente(CHAT), true);

    const { ctx, llamadas } = crearCtx();
    await bot.comandos.get('cancelar')(ctx);

    assert.equal(haySesion(CHAT), false);
    assert.equal(almacenConversacion.obtener(CHAT), null);
    assert.equal(hayConversacionPendiente(CHAT), false);
    assert.match(llamadas.reply[0].mensaje, /no guardé nada/);
  });

  test('/cancelar sin nada pendiente lo dice', async () => {
    const bot = crearBotFalso();
    registrarMenu(bot.bot);
    await pacienteConConsentimiento();

    const { ctx, llamadas } = crearCtx();
    await bot.comandos.get('cancelar')(ctx);

    assert.match(llamadas.reply[0].mensaje, /No había nada pendiente/);
  });

  test('/reportar sin consentimiento no inventa un flujo', async () => {
    const bot = crearBotFalso();
    registrarMenu(bot.bot);

    const { ctx, llamadas } = crearCtx();
    await bot.comandos.get('reportar')(ctx);

    assert.match(llamadas.reply[0].mensaje, /\/start/);
    assert.equal(almacenConversacion.obtener(CHAT), null);
  });

  test('/reportar con el servicio caído avisa en genérico', async () => {
    const bot = crearBotFalso();
    const servicio = crearServicioFalso({ fallar: 'iniciar' });
    registrarMenu(bot.bot, servicio);
    await pacienteConConsentimiento();

    const errores = [];
    const original = console.error;
    console.error = (...args) => errores.push(args.join(' '));
    try {
      const { ctx, llamadas } = crearCtx();
      await assert.doesNotReject(() => bot.comandos.get('reportar')(ctx));
      assert.equal(llamadas.reply[0].mensaje, TEXTO_ERROR_CONVERSACION);
      assert.equal(errores.length, 1);
    } finally {
      console.error = original;
    }
  });

  test('la ayuda menciona /reportar', async () => {
    const bot = crearBotFalso();
    registrarMenu(bot.bot);

    const { ctx, llamadas } = crearCtx();
    await bot.comandos.get('ayuda')(ctx);

    assert.match(llamadas.reply[0].mensaje, /\/reportar/);
    assert.equal(llamadas.reply[0].extra.parse_mode, 'HTML');
  });
});

// ---------------------------------------------------------------------------
// 7. Menú de comandos de Telegram
// ---------------------------------------------------------------------------

describe('menú nativo de Telegram', () => {
  test('publica los cinco comandos con descripción en español', async () => {
    const { bot, telegram } = crearBotFalso();

    assert.equal(await publicarComandos(bot), true);
    assert.deepEqual(
      telegram.comandosPublicados.map(({ command }) => command),
      ['registrar', 'reportar', 'perfil', 'cancelar', 'ayuda']
    );
    for (const comando of telegram.comandosPublicados) {
      assert.ok(comando.description.length > 3);
      assert.ok(comando.description.length <= 256);
    }
    assert.equal(COMANDOS.length, 5);
  });

  test('si Telegram falla, el bot arranca igual', async () => {
    const errores = [];
    const original = console.error;
    console.error = (...args) => errores.push(args.join(' '));

    try {
      const bot = {
        telegram: {
          async setMyCommands() {
            throw new Error('sin red');
          },
        },
      };

      assert.equal(await publicarComandos(bot), false);
    } finally {
      console.error = original;
    }

    assert.equal(errores.length, 1);
    assert.match(errores[0], /No se pudieron publicar los comandos/);
  });
});
