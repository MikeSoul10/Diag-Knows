import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  crearAlmacenMemoria,
  crearServicioConversacion,
  ESTADOS,
  TTL_MINUTOS,
} from '../src/services/conversacion.js';
import { extraerMock } from '../src/services/extractor.js';
import { anonimizar } from '../src/services/anonimizador.js';
import { validarExtraccion } from '../src/services/validador.js';
import {
  patients,
  consentimiento,
  mediciones,
  sintomas,
  medicamentos,
  dosisLogs,
  reiniciarRepositorios,
} from '../src/repositories/index.js';

const CHAT = 700001;
const OTRO_CHAT = 700002;

// ---------------------------------------------------------------------------
// Utilidades de prueba
// ---------------------------------------------------------------------------

function crearHarness({ extraer = extraerMock, registrarError } = {}) {
  const almacen = crearAlmacenMemoria();
  const errores = [];
  let reloj = new Date('2026-11-03T10:00:00.000Z');
  let contador = 0;

  const servicio = crearServicioConversacion({
    repos: { patients, mediciones, sintomas, medicamentos, dosisLogs },
    extractor: { extraer: (...args) => extraer(...args) },
    anonimizar,
    validar: validarExtraccion,
    almacenEstado: almacen,
    ahora: () => reloj,
    generarToken: () => `tok${(contador += 1)}`,
    registrarError:
      registrarError ?? ((contexto, error) => errores.push(`${contexto} ${error?.name}`)),
  });

  return {
    servicio,
    almacen,
    errores,
    avanzarMinutos(minutos) {
      reloj = new Date(reloj.getTime() + minutos * 60 * 1000);
    },
    estadoDe(chatId = CHAT) {
      return almacen.obtener(chatId);
    },
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

async function registrosDe(paciente) {
  return {
    mediciones: await mediciones.listarPorPaciente(paciente.id),
    sintomas: await sintomas.listarPorPaciente(paciente.id),
    dosis: await dosisLogs.listarPorPaciente(paciente.id),
  };
}

beforeEach(() => {
  reiniciarRepositorios();
});

// ---------------------------------------------------------------------------
// Flujo libre
// ---------------------------------------------------------------------------

describe('flujo libre', () => {
  test('un mensaje con toma, medición y síntoma va al resumen y no guarda nada', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const respuesta = await servicio.procesarMensaje({
      chatId: CHAT,
      texto: 'me tomé la metformina y tengo glucosa en 115 y dolor de cabeza leve',
    });

    assert.match(respuesta.texto, /Esto es lo que voy a registrar/);
    assert.match(respuesta.texto, /Metformina: sí la tomé/);
    assert.match(respuesta.texto, /Glucosa: 115 mg\/dL/);
    assert.match(respuesta.texto, /Dolor de cabeza \(leve\)/);
    assert.match(respuesta.texto, /¿Lo guardo\?/);
    assert.deepEqual(
      botonesDe(respuesta).map(
        ({ callback }) => callback.split(':')[0] + ':' + callback.split(':')[1]
      ),
      ['conv:ok', 'conv:no']
    );

    // Nada se guardó todavía.
    const antes = await registrosDe(paciente);
    assert.deepEqual(antes, { mediciones: [], sintomas: [], dosis: [] });
  });

  test('al confirmar se guardan los tres registros con fecha', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const resumen = await servicio.procesarMensaje({
      chatId: CHAT,
      texto: 'me tomé la metformina y tengo glucosa en 115 y dolor de cabeza leve',
    });

    const respuesta = await servicio.procesarCallback({
      chatId: CHAT,
      accion: 'ok',
      token: tokenDe(resumen),
    });

    assert.match(respuesta.texto, /quedó guardado/);
    assert.equal(respuesta.editarMensaje, true);

    const guardado = await registrosDe(paciente);
    assert.equal(guardado.mediciones.length, 1);
    assert.equal(guardado.mediciones[0].tipo, 'glucosa');
    assert.equal(guardado.mediciones[0].valor, 115);
    assert.equal(guardado.mediciones[0].medidaEn, '2026-11-03T10:00:00.000Z');

    assert.deepEqual(
      guardado.sintomas.map((s) => [s.descripcion, s.nivelGravedad]),
      [['dolor de cabeza', 'LEVE']]
    );

    assert.equal(guardado.dosis.length, 1);
    assert.equal(guardado.dosis[0].estado, 'TOMADA');
    assert.equal(guardado.dosis[0].nombreReportado, 'metformina');
  });

  test('si falta la intensidad, la pregunta antes del resumen', async () => {
    const { servicio } = crearHarness();
    await pacienteConConsentimiento();

    const respuesta = await servicio.procesarMensaje({
      chatId: CHAT,
      texto: 'tengo mareo y glucosa en 115',
    });

    assert.match(respuesta.texto, /¿Qué intensidad tenía <b>mareo<\/b>\?/);
    assert.equal(botonesDe(respuesta).length, 3);
    assert.deepEqual(
      botonesDe(respuesta).map(({ texto }) => texto),
      ['Leve', 'Moderado', 'Fuerte']
    );
    assert.doesNotMatch(respuesta.texto, /¿Lo guardo\?/);

    const token = botonesDe(respuesta)[1].callback.split(':')[1];
    const conIntensidad = await servicio.procesarCallback({
      chatId: CHAT,
      accion: 'sev',
      token,
      indice: 0,
      valor: 2,
    });

    assert.match(conIntensidad.texto, /Mareo \(moderada\)/);
    assert.match(conIntensidad.texto, /¿Lo guardo\?/);
  });

  test('la intensidad elegida se guarda como MODERADO', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const pregunta = await servicio.procesarMensaje({ chatId: CHAT, texto: 'tengo mareo' });
    const token = botonesDe(pregunta)[2].callback.split(':')[1];

    const resumen = await servicio.procesarCallback({
      chatId: CHAT,
      accion: 'sev',
      token,
      indice: 0,
      valor: 3,
    });

    await servicio.procesarCallback({ chatId: CHAT, accion: 'ok', token: tokenDe(resumen) });

    const guardado = await registrosDe(paciente);
    assert.equal(guardado.sintomas[0].nivelGravedad, 'GRAVE');
  });

  test('un mensaje sin datos avisa y da un ejemplo', async () => {
    const { servicio } = crearHarness();
    await pacienteConConsentimiento();

    const respuesta = await servicio.procesarMensaje({
      chatId: CHAT,
      texto: 'hola, buenas tardes',
    });

    assert.match(respuesta.texto, /No identifiqué datos para registrar/);
    assert.match(respuesta.texto, /glucosa está en 115/);
    assert.equal(respuesta.botones, undefined);
  });

  test('un mensaje nuevo en el resumen reemplaza el dato del mismo tipo', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    const segundo = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 180' });

    assert.match(segundo.texto, /Glucosa: 180 mg\/dL/);
    assert.doesNotMatch(segundo.texto, /115/);

    await servicio.procesarCallback({ chatId: CHAT, accion: 'ok', token: tokenDe(segundo) });

    const guardado = await registrosDe(paciente);
    assert.equal(guardado.mediciones.length, 1);
    assert.equal(guardado.mediciones[0].valor, 180);
  });
});

// ---------------------------------------------------------------------------
// Flujo guiado
// ---------------------------------------------------------------------------

describe('flujo guiado (/reportar)', () => {
  test('pregunta síntoma, medicación y medición, y permite omitir con el botón', async () => {
    const { servicio, estadoDe } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const inicio = await servicio.iniciar({ chatId: CHAT });
    assert.match(inicio.texto, /Vamos a registrar cómo te sientes hoy/);
    assert.match(inicio.texto, /¿Cómo te sentiste\?/);
    assert.equal(estadoDe().estado, ESTADOS.PREGUNTANDO_SINTOMAS);

    const trasSintomas = await servicio.procesarCallback({
      chatId: CHAT,
      accion: 'skip',
      token: tokenDe(inicio, 'conv:skip:'),
    });
    assert.match(trasSintomas.texto, /¿Te tomaste algún medicamento hoy\?/);
    assert.equal(estadoDe().estado, ESTADOS.PREGUNTANDO_MEDICACION);

    const trasMedicacion = await servicio.procesarMensaje({
      chatId: CHAT,
      texto: 'no me tomé la metformina',
    });
    assert.match(trasMedicacion.texto, /¿Tienes alguna medición de hoy\?/);
    assert.equal(estadoDe().estado, ESTADOS.PREGUNTANDO_MEDICIONES);

    const resumen = await servicio.procesarCallback({
      chatId: CHAT,
      accion: 'skip',
      token: tokenDe(trasMedicacion, 'conv:skip:'),
    });
    assert.match(resumen.texto, /no la tomé/);
    assert.match(resumen.texto, /¿Lo guardo\?/);
    assert.equal(estadoDe().estado, ESTADOS.ESPERANDO_CONFIRMACION);

    await servicio.procesarCallback({ chatId: CHAT, accion: 'ok', token: tokenDe(resumen) });

    const guardado = await registrosDe(paciente);
    assert.equal(guardado.dosis.length, 1);
    assert.equal(guardado.dosis[0].estado, 'SALTADA');
  });

  test('si no entiende, repite la pregunta del paso', async () => {
    const { servicio, estadoDe } = crearHarness();
    await pacienteConConsentimiento();

    await servicio.iniciar({ chatId: CHAT });
    const respuesta = await servicio.procesarMensaje({ chatId: CHAT, texto: 'no sé qué decir' });

    assert.match(respuesta.texto, /No identifiqué datos para registrar/);
    assert.match(respuesta.texto, /¿Cómo te sentiste\?/);
    assert.ok(botonesDe(respuesta).some(({ callback }) => callback.startsWith('conv:skip:')));
    assert.equal(estadoDe().estado, ESTADOS.PREGUNTANDO_SINTOMAS);
  });

  test('omitir todo no inventa un registro', async () => {
    const { servicio, estadoDe } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const inicio = await servicio.iniciar({ chatId: CHAT });
    const paso2 = await servicio.procesarCallback({
      chatId: CHAT,
      accion: 'skip',
      token: tokenDe(inicio, 'conv:skip:'),
    });
    const paso3 = await servicio.procesarCallback({
      chatId: CHAT,
      accion: 'skip',
      token: tokenDe(paso2, 'conv:skip:'),
    });
    const final = await servicio.procesarCallback({
      chatId: CHAT,
      accion: 'skip',
      token: tokenDe(paso3, 'conv:skip:'),
    });

    assert.match(final.texto, /No hay nada que guardar/);
    assert.equal(final.botones, undefined);
    assert.equal(estadoDe(), null);
    assert.deepEqual(await registrosDe(paciente), { mediciones: [], sintomas: [], dosis: [] });
  });

  test('la pregunta de medicación usa el catálogo del paciente', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();
    await medicamentos.sembrarDatosDesarrollo(paciente.id);

    const inicio = await servicio.iniciar({ chatId: CHAT });
    const paso2 = await servicio.procesarCallback({
      chatId: CHAT,
      accion: 'skip',
      token: tokenDe(inicio, 'conv:skip:'),
    });

    assert.match(paso2.texto, /Metformina/);
    assert.match(paso2.texto, /Losartán/);
  });

  test('reiniciar con /reportar avisa que descartó lo anterior', async () => {
    const { servicio } = crearHarness();
    await pacienteConConsentimiento();

    await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    const reinicio = await servicio.iniciar({ chatId: CHAT });

    assert.match(reinicio.texto, /lo anterior no se guardó/);
  });
});

// ---------------------------------------------------------------------------
// Corrección, cancelación y confirmaciones
// ---------------------------------------------------------------------------

describe('corrección y cancelación', () => {
  test('corregir reemplaza el borrador completo', async () => {
    const { servicio, estadoDe } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const resumen = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    const correccion = await servicio.procesarCallback({
      chatId: CHAT,
      accion: 'no',
      token: tokenDe(resumen, 'conv:no:'),
    });

    assert.match(correccion.texto, /no guardé nada/);
    assert.equal(estadoDe().estado, ESTADOS.CORRIGIENDO);

    const nuevo = await servicio.procesarMensaje({ chatId: CHAT, texto: 'peso 80 kg' });

    assert.match(nuevo.texto, /Peso: 80 kg/);
    assert.doesNotMatch(nuevo.texto, /Glucosa/);

    await servicio.procesarCallback({ chatId: CHAT, accion: 'ok', token: tokenDe(nuevo) });

    const guardado = await registrosDe(paciente);
    assert.equal(guardado.mediciones.length, 1);
    assert.equal(guardado.mediciones[0].tipo, 'peso');
  });

  test('cancelar limpia el estado a medio flujo', async () => {
    const { servicio, estadoDe } = crearHarness();
    await pacienteConConsentimiento();

    await servicio.iniciar({ chatId: CHAT });
    const respuesta = await servicio.cancelar({ chatId: CHAT });

    assert.match(respuesta.texto, /No guardé nada/);
    assert.equal(estadoDe(), null);
  });

  test('cancelar con un resumen pendiente invalida el botón de guardar', async () => {
    const { servicio, estadoDe } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const resumen = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    const token = tokenDe(resumen);

    await servicio.cancelar({ chatId: CHAT });
    const respuesta = await servicio.procesarCallback({ chatId: CHAT, accion: 'ok', token });

    assert.match(respuesta.texto, /ya no está vigente/);
    assert.equal(estadoDe(), null);
    assert.deepEqual((await registrosDe(paciente)).mediciones, []);
  });

  test('un segundo clic avisa que ya quedó registrado y no duplica', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const resumen = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    const token = tokenDe(resumen);

    await servicio.procesarCallback({ chatId: CHAT, accion: 'ok', token });
    const segundo = await servicio.procesarCallback({ chatId: CHAT, accion: 'ok', token });

    assert.match(segundo.texto, /ya quedó guardado/);
    assert.equal((await registrosDe(paciente)).mediciones.length, 1);
  });

  test('un token ajeno no guarda nada', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    const respuesta = await servicio.procesarCallback({
      chatId: CHAT,
      accion: 'ok',
      token: 'tokAjeno',
    });

    assert.match(respuesta.texto, /ya no está vigente/);
    assert.deepEqual((await registrosDe(paciente)).mediciones, []);
  });

  test('un token de otro chat no guarda nada', async () => {
    const { servicio } = crearHarness();
    const propio = await pacienteConConsentimiento(CHAT);
    const ajeno = await pacienteConConsentimiento(OTRO_CHAT);

    const resumenPropio = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    await servicio.procesarMensaje({ chatId: OTRO_CHAT, texto: 'peso 80 kg' });

    const respuesta = await servicio.procesarCallback({
      chatId: OTRO_CHAT,
      accion: 'ok',
      token: tokenDe(resumenPropio),
    });

    assert.match(respuesta.texto, /ya no está vigente/);
    assert.deepEqual((await registrosDe(ajeno)).mediciones, []);
    assert.deepEqual((await registrosDe(propio)).mediciones, []);
  });

  test(`el estado expira a los ${TTL_MINUTOS} minutos y el botón deja de servir`, async () => {
    const { servicio, avanzarMinutos } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const resumen = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    const token = tokenDe(resumen);

    avanzarMinutos(TTL_MINUTOS + 1);
    const respuesta = await servicio.procesarCallback({ chatId: CHAT, accion: 'ok', token });

    assert.match(respuesta.texto, /ya no está vigente/);
    assert.deepEqual((await registrosDe(paciente)).mediciones, []);
  });

  test('tras la expiración el siguiente mensaje arranca de cero', async () => {
    const { servicio, avanzarMinutos, estadoDe } = crearHarness();
    await pacienteConConsentimiento();

    await servicio.iniciar({ chatId: CHAT });
    avanzarMinutos(TTL_MINUTOS + 1);

    const respuesta = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });

    assert.match(respuesta.texto, /¿Lo guardo\?/);
    assert.doesNotMatch(respuesta.texto, /¿Cómo te sentiste\?/);
    assert.equal(estadoDe().modo, 'libre');
  });
});

// ---------------------------------------------------------------------------
// Reglas del proyecto
// ---------------------------------------------------------------------------

describe('reglas del proyecto', () => {
  test('sin registro no extrae ni guarda, y dice cómo registrarse', async () => {
    let llamadas = 0;
    const { servicio } = crearHarness({
      extraer: (texto) => {
        llamadas += 1;
        return extraerMock(texto);
      },
    });

    const respuesta = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });

    assert.match(respuesta.texto, /\/start/);
    assert.equal(llamadas, 0);
  });

  test('sin consentimiento vigente no registra nada', async () => {
    const { servicio } = crearHarness();
    await patients.findOrCreate(CHAT); // existe, pero no aceptó

    const respuesta = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });

    assert.match(respuesta.texto, /aviso de privacidad/);
    assert.match(respuesta.texto, /\/start/);
  });

  test('los rechazados se informan y los válidos se conservan', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const resumen = await servicio.procesarMensaje({
      chatId: CHAT,
      texto: 'glucosa en 900 y peso 80 kg',
    });

    assert.match(resumen.texto, /Esto no lo pude registrar/);
    assert.match(resumen.texto, /fuera del rango/);
    assert.match(resumen.texto, /Peso: 80 kg/);
    assert.doesNotMatch(resumen.texto, /Glucosa:/);

    await servicio.procesarCallback({ chatId: CHAT, accion: 'ok', token: tokenDe(resumen) });

    const guardado = await registrosDe(paciente);
    assert.equal(guardado.mediciones.length, 1);
    assert.equal(guardado.mediciones[0].tipo, 'peso');
  });

  test('un valor fuera de rango y nada más no llega al resumen', async () => {
    const { servicio, estadoDe } = crearHarness();
    await pacienteConConsentimiento();

    const respuesta = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 900' });

    assert.match(respuesta.texto, /fuera del rango/);
    assert.doesNotMatch(respuesta.texto, /¿Lo guardo\?/);
    assert.equal(estadoDe(), null);
  });

  test('DK-205: una pregunta médica sin datos no se extrae ni se guarda', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const respuesta = await servicio.procesarMensaje({
      chatId: CHAT,
      texto: '¿es normal 180 de glucosa?',
    });

    assert.match(respuesta.texto, /profesional de la salud/);
    assert.equal(respuesta.botones, undefined);
    assert.deepEqual(await registrosDe(paciente), { mediciones: [], sintomas: [], dosis: [] });
  });

  test('DK-205: un mensaje con datos sí sigue el flujo normal', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const resumen = await servicio.procesarMensaje({ chatId: CHAT, texto: 'me tomé la pastilla' });

    assert.doesNotMatch(resumen.texto, /profesional de la salud/);
    assert.match(resumen.texto, /¿Lo guardo\?/);

    await servicio.procesarCallback({ chatId: CHAT, accion: 'ok', token: tokenDe(resumen) });

    assert.equal((await registrosDe(paciente)).dosis.length, 1);
  });

  test('un fallo del extractor no tumba el bot ni registra el texto del paciente', async () => {
    const errores = [];
    const { servicio } = crearHarness({
      extraer: () => {
        throw new Error('timeout del proveedor');
      },
      registrarError: (contexto, error) => errores.push(`${contexto} :: ${error?.name}`),
    });
    await pacienteConConsentimiento();

    const respuesta = await servicio.procesarMensaje({
      chatId: CHAT,
      texto: 'mi glucosa está en 115',
    });

    assert.match(respuesta.texto, /No pude interpretar tu mensaje/);
    assert.equal(errores.length, 1);
    assert.doesNotMatch(errores.join(' '), /glucosa|115/);
  });

  test('"no me tomé la metformina" se asocia al medicamento del catálogo', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();
    const [metformina] = await medicamentos.sembrarDatosDesarrollo(paciente.id);

    const resumen = await servicio.procesarMensaje({
      chatId: CHAT,
      texto: 'no me tomé la metformina',
    });
    await servicio.procesarCallback({ chatId: CHAT, accion: 'ok', token: tokenDe(resumen) });

    const guardado = await registrosDe(paciente);
    assert.equal(guardado.dosis.length, 1);
    assert.equal(guardado.dosis[0].estado, 'SALTADA');
    assert.equal(guardado.dosis[0].medicamentoId, metformina.id);
    assert.equal(guardado.dosis[0].nombreReportado, 'metformina');
  });

  test('nunca guarda sin confirmación aunque pasen varios mensajes', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    await servicio.procesarMensaje({ chatId: CHAT, texto: 'presión 120/80' });
    await servicio.procesarMensaje({ chatId: CHAT, texto: 'dolor de cabeza leve' });
    await servicio.procesarCallback({ chatId: CHAT, accion: 'skip', token: 'tokCualquiera' });

    assert.deepEqual(await registrosDe(paciente), { mediciones: [], sintomas: [], dosis: [] });
  });

  test('los nombres con HTML se escapan en el resumen', async () => {
    const { servicio } = crearHarness({
      extraer: () => ({
        medicacion: [],
        mediciones: [],
        sintomas: [{ descripcion: 'dolor <b>fuerte</b> & raro', severidad: 1 }],
      }),
    });
    await pacienteConConsentimiento();

    const resumen = await servicio.procesarMensaje({ chatId: CHAT, texto: 'me duele algo' });

    assert.match(resumen.texto, /Dolor &lt;b&gt;fuerte&lt;\/b&gt; &amp; raro/);
  });
});
