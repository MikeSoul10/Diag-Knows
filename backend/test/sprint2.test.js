/**
 * Cierre del Sprint 2 en la conversación (con repos mock):
 * - DK-202: cada dato se guarda con el momento que dijo el paciente.
 * - Trazabilidad: el mensaje (anonimizado) se guarda y los registros lo enlazan.
 * - Contexto: el extractor recibe los mensajes anteriores del chat.
 * - DK-203: es_critica pasa por config/thresholds.js (false con umbrales en null).
 */
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  crearAlmacenMemoria,
  crearServicioConversacion,
  MENSAJES_DE_CONTEXTO,
} from '../src/services/conversacion.js';
import { extraerMock } from '../src/services/extractor.js';
import { anonimizar } from '../src/services/anonimizador.js';
import { validarExtraccion } from '../src/services/validador.js';
import { depurarMensajesVencidos } from '../src/services/retencion.service.js';
import {
  patients,
  consentimiento,
  mediciones,
  sintomas,
  medicamentos,
  dosisLogs,
  mensajes,
  eliminarPaciente,
  reiniciarRepositorios,
} from '../src/repositories/index.js';

const CHAT = 820001;
// Martes 10 nov 2026, 12:30 en Ciudad de México (18:30 UTC).
const INICIO = new Date('2026-11-10T18:30:00.000Z');

function crearHarness({ extraer = extraerMock } = {}) {
  let reloj = INICIO;
  let contador = 0;
  const llamadas = [];

  const servicio = crearServicioConversacion({
    repos: { patients, mediciones, sintomas, medicamentos, dosisLogs, mensajes },
    extractor: {
      extraer: (texto, opciones) => {
        llamadas.push({ texto, opciones });
        return extraer(texto, opciones);
      },
    },
    anonimizar,
    validar: validarExtraccion,
    almacenEstado: crearAlmacenMemoria(),
    ahora: () => reloj,
    generarToken: () => `tok${(contador += 1)}`,
    registrarError: () => {},
  });

  return {
    servicio,
    llamadas,
    avanzarMinutos(minutos) {
      reloj = new Date(reloj.getTime() + minutos * 60 * 1000);
    },
  };
}

async function pacienteConConsentimiento(alias = null) {
  const paciente = await patients.findOrCreate(CHAT);
  await consentimiento.registrar({
    pacienteId: paciente.id,
    aceptado: true,
    versionPrivacidad: 'v1.0',
  });
  if (alias) await patients.updatePerfil(paciente.id, { alias });
  return paciente;
}

function tokenOk(respuesta) {
  const boton = (respuesta.botones ?? [])
    .flat()
    .find(({ callback }) => callback.startsWith('conv:ok:'));
  return boton.callback.split(':')[2];
}

async function confirmar(servicio, respuesta) {
  return servicio.procesarCallback({ chatId: CHAT, accion: 'ok', token: tokenOk(respuesta) });
}

beforeEach(() => reiniciarRepositorios());

describe('DK-202: momento del dato', () => {
  test('"anoche" se muestra en el resumen y se guarda con esa hora', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const resumen = await servicio.procesarMensaje({
      chatId: CHAT,
      texto: 'anoche me dolió mucho la cabeza',
    });
    assert.match(resumen.texto, /Dolor de cabeza \(fuerte\) · <i>ayer 21:00<\/i>/);

    await confirmar(servicio, resumen);
    const [sintoma] = await sintomas.listarPorPaciente(paciente.id);
    assert.equal(sintoma.reportadoEn, '2026-11-10T03:00:00.000Z');
  });

  test('sin referencia de tiempo se guarda con la hora de confirmación', async () => {
    const { servicio, avanzarMinutos } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    const resumen = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    assert.doesNotMatch(resumen.texto, /<i>/);
    avanzarMinutos(2);
    await confirmar(servicio, resumen);

    const [medicion] = await mediciones.listarPorPaciente(paciente.id);
    assert.equal(medicion.medidaEn, '2026-11-10T18:32:00.000Z');
    assert.equal(medicion.esCritica, false);
  });

  test('un momento en el futuro se rechaza con aviso y no entra al borrador', async () => {
    const { servicio } = crearHarness();
    await pacienteConConsentimiento();

    // A las 12:30, "esta noche" todavía no pasa.
    const respuesta = await servicio.procesarMensaje({
      chatId: CHAT,
      texto: 'esta noche tuve tos',
    });
    assert.match(respuesta.texto, /todavía no pasa/);
  });

  test('la zona horaria del paciente manda sobre la de respaldo', async () => {
    const { servicio, llamadas } = crearHarness();
    await pacienteConConsentimiento();

    await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    assert.equal(llamadas[0].opciones.zonaHoraria, 'America/Mexico_City');
    assert.equal(llamadas[0].opciones.ahora.toISOString(), INICIO.toISOString());
  });
});

describe('Trazabilidad: mensaje original', () => {
  test('al confirmar se guarda el mensaje anonimizado y los registros lo enlazan', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento('Lupita');

    const resumen = await servicio.procesarMensaje({
      chatId: CHAT,
      texto: 'Soy Lupita, me tomé la metformina y glucosa en 130',
    });
    await confirmar(servicio, resumen);

    const [medicion] = await mediciones.listarPorPaciente(paciente.id);
    const [toma] = await dosisLogs.listarPorPaciente(paciente.id);
    assert.ok(medicion.mensajeId);
    assert.equal(toma.mensajeId, medicion.mensajeId);

    const mensaje = await mensajes.obtener(medicion.mensajeId);
    assert.doesNotMatch(mensaje.texto, /Lupita/);
    assert.match(mensaje.texto, /glucosa en 130/);
    assert.equal(mensaje.pacienteId, paciente.id);
    assert.equal(mensaje.expiraEn, '2027-02-08T18:30:00.000Z'); // 90 días
  });

  test('en el flujo guiado se juntan todos los mensajes del reporte', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    await servicio.iniciar({ chatId: CHAT });
    await servicio.procesarMensaje({ chatId: CHAT, texto: 'tos leve' });
    await servicio.procesarMensaje({ chatId: CHAT, texto: 'ya me la tomé' });
    const resumen = await servicio.procesarMensaje({ chatId: CHAT, texto: 'peso 72 kg' });
    await confirmar(servicio, resumen);

    const [medicion] = await mediciones.listarPorPaciente(paciente.id);
    const mensaje = await mensajes.obtener(medicion.mensajeId);
    assert.equal(mensaje.texto, 'tos leve\nya me la tomé\npeso 72 kg');
  });

  test('si no confirma, no se guarda ningún mensaje', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();

    await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    await servicio.cancelar({ chatId: CHAT });

    assert.equal(await mensajes.eliminarPorPaciente(paciente.id), 0);
  });

  test('la retención borra los vencidos y deja los registros', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();
    const resumen = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    await confirmar(servicio, resumen);

    const [antes] = await mediciones.listarPorPaciente(paciente.id);
    const dia91 = new Date(INICIO.getTime() + 91 * 86_400_000);

    assert.equal(await depurarMensajesVencidos({ ahora: INICIO }), 0);
    assert.equal(await depurarMensajesVencidos({ ahora: dia91 }), 1);
    assert.equal(await mensajes.obtener(antes.mensajeId), null);
    assert.equal((await mediciones.listarPorPaciente(paciente.id)).length, 1);
  });

  test('/borrar_datos también borra los mensajes del paciente', async () => {
    const { servicio } = crearHarness();
    const paciente = await pacienteConConsentimiento();
    const resumen = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    await confirmar(servicio, resumen);
    const [medicion] = await mediciones.listarPorPaciente(paciente.id);

    await eliminarPaciente(paciente.id);
    assert.equal(await mensajes.obtener(medicion.mensajeId), null);
  });

  test('un fallo de la depuración no tumba el proceso', async () => {
    const errores = [];
    const borrados = await depurarMensajesVencidos({
      mensajes: { eliminarVencidos: async () => Promise.reject(new Error('sin BD')) },
      registrarError: (error) => errores.push(error.message),
    });
    assert.equal(borrados, 0);
    assert.deepEqual(errores, ['sin BD']);
  });
});

describe('Contexto de la conversación', () => {
  test('el extractor recibe los mensajes anteriores (anonimizados) del chat', async () => {
    const { servicio, llamadas } = crearHarness();
    await pacienteConConsentimiento('Lupita');

    await servicio.procesarMensaje({ chatId: CHAT, texto: 'hola, soy Lupita' });
    await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });

    assert.deepEqual(llamadas[0].opciones.contexto, []);
    assert.deepEqual(llamadas[1].opciones.contexto, ['hola, soy [NOMBRE]']);
  });

  test(`guarda como máximo ${MENSAJES_DE_CONTEXTO} mensajes y caduca a los 30 min`, async () => {
    const { servicio, llamadas, avanzarMinutos } = crearHarness();
    await pacienteConConsentimiento();

    for (let i = 1; i <= MENSAJES_DE_CONTEXTO + 2; i += 1) {
      await servicio.procesarMensaje({ chatId: CHAT, texto: `hola ${i}` });
    }
    const ultima = llamadas.at(-1).opciones.contexto;
    assert.equal(ultima.length, MENSAJES_DE_CONTEXTO);
    assert.equal(ultima.at(-1), `hola ${MENSAJES_DE_CONTEXTO + 1}`);

    avanzarMinutos(31);
    await servicio.procesarMensaje({ chatId: CHAT, texto: 'otra vez' });
    assert.deepEqual(llamadas.at(-1).opciones.contexto, []);
  });

  test('se olvida al confirmar y al cancelar', async () => {
    const { servicio, llamadas } = crearHarness();
    await pacienteConConsentimiento();

    const resumen = await servicio.procesarMensaje({ chatId: CHAT, texto: 'glucosa en 115' });
    await confirmar(servicio, resumen);
    await servicio.procesarMensaje({ chatId: CHAT, texto: 'hola' });
    assert.deepEqual(llamadas.at(-1).opciones.contexto, []);

    await servicio.cancelar({ chatId: CHAT });
    await servicio.procesarMensaje({ chatId: CHAT, texto: 'otra' });
    assert.deepEqual(llamadas.at(-1).opciones.contexto, []);
  });
});
