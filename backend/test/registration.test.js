import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import * as registration from '../src/services/registration.service.js';
import { reiniciarRepositorios } from '../src/repositories/index.js';
import { __reset as reiniciarSesiones } from '../src/services/session.store.js';

const CHAT = 900001;

beforeEach(() => {
  reiniciarRepositorios();
  reiniciarSesiones();
});

describe('consentimiento', () => {
  test('/start crea al paciente sin consentimiento', async () => {
    const { paciente, requiereConsentimiento } = await registration.iniciar(CHAT);
    assert.equal(requiereConsentimiento, true);
    assert.equal(paciente.consentimientoVigente, false);
    assert.equal(paciente.estado, 'ACTIVO');
  });

  test('dos /start del mismo chat no duplican al paciente', async () => {
    const primero = await registration.iniciar(CHAT);
    const segundo = await registration.iniciar(CHAT);
    assert.equal(primero.paciente.id, segundo.paciente.id);
  });

  test('aceptar deja el consentimiento vigente', async () => {
    await registration.iniciar(CHAT);
    await registration.aceptarConsentimiento(CHAT);
    const activo = await registration.obtenerPacienteActivo(CHAT);
    assert.ok(activo);
    assert.equal(activo.consentimientoVigente, true);
  });

  test('rechazar bloquea el registro de datos', async () => {
    await registration.iniciar(CHAT);
    await registration.rechazarConsentimiento(CHAT);
    assert.equal(await registration.obtenerPacienteActivo(CHAT), null);

    const resultado = await registration.iniciarRegistro(CHAT);
    assert.equal(resultado.tipo, 'requiere_consentimiento');
  });

  test('el último consentimiento manda', async () => {
    await registration.iniciar(CHAT);
    await registration.aceptarConsentimiento(CHAT);
    await registration.rechazarConsentimiento(CHAT);
    assert.equal(await registration.obtenerPacienteActivo(CHAT), null);
  });
});

describe('flujo de registro', () => {
  async function pacienteConConsentimiento(chatId = CHAT) {
    await registration.iniciar(chatId);
    await registration.aceptarConsentimiento(chatId);
    return chatId;
  }

  test('recorre los pasos y guarda el perfil', async () => {
    const chatId = await pacienteConConsentimiento();

    const paso1 = await registration.iniciarRegistro(chatId);
    assert.equal(paso1.tipo, 'pregunta');
    assert.equal(paso1.paso, 'alias');

    const paso2 = await registration.procesarTexto(chatId, '  Ana  ');
    assert.equal(paso2.paso, 'anioNacimiento');

    const paso3 = await registration.procesarTexto(chatId, '1990');
    assert.equal(paso3.paso, 'enfermedad');
    assert.equal(paso3.opciones.length, 3);

    const diabetes = paso3.opciones.find((opcion) => opcion.nombre === 'Diabetes tipo 2');
    assert.ok(diabetes, 'el catálogo debe incluir diabetes tipo 2');

    const resumen = await registration.elegirEnfermedad(chatId, diabetes.id);
    assert.equal(resumen.tipo, 'resumen');
    assert.match(resumen.mensaje, /Ana/);
    assert.match(resumen.mensaje, /Diabetes tipo 2/);

    const completado = await registration.confirmarRegistro(chatId);
    assert.equal(completado.tipo, 'completado');

    const perfil = await registration.obtenerPerfil(chatId);
    assert.equal(perfil.paciente.alias, 'Ana');
    assert.equal(perfil.paciente.anioNacimiento, 1990);
    assert.deepEqual(
      perfil.enfermedades.map((enfermedad) => enfermedad.codigo),
      ['DIABETES_TIPO_2']
    );

    // La sesión se limpia al terminar.
    assert.equal(registration.tieneRegistroEnCurso(chatId), false);
  });

  test('un año inválido no avanza el paso', async () => {
    const chatId = await pacienteConConsentimiento();
    await registration.iniciarRegistro(chatId);
    await registration.procesarTexto(chatId, 'Ana');

    for (const invalido of ['199', '2050', '1800', 'mil']) {
      const resultado = await registration.procesarTexto(chatId, invalido);
      assert.equal(resultado.tipo, 'error');
      assert.equal(resultado.paso, 'anioNacimiento');
    }

    const valido = await registration.procesarTexto(chatId, '1985');
    assert.equal(valido.paso, 'enfermedad');
  });

  test('rechaza una enfermedad fuera del catálogo', async () => {
    const chatId = await pacienteConConsentimiento();
    await registration.iniciarRegistro(chatId);
    await registration.procesarTexto(chatId, 'Ana');
    await registration.procesarTexto(chatId, '1990');

    const resultado = await registration.elegirEnfermedad(
      chatId,
      '99999999-9999-4999-8999-999999999999'
    );
    assert.equal(resultado.tipo, 'error');
    assert.equal(resultado.paso, 'enfermedad');
  });

  test('un alias demasiado corto no avanza el paso', async () => {
    const chatId = await pacienteConConsentimiento();
    await registration.iniciarRegistro(chatId);

    const resultado = await registration.procesarTexto(chatId, 'A');
    assert.equal(resultado.tipo, 'error');
    assert.equal(resultado.paso, 'alias');
  });

  test('cancelar descarta la sesión sin guardar', async () => {
    const chatId = await pacienteConConsentimiento();
    await registration.iniciarRegistro(chatId);
    await registration.procesarTexto(chatId, 'Ana');

    assert.equal(await registration.cancelarRegistro(chatId), true);
    assert.equal(registration.tieneRegistroEnCurso(chatId), false);

    const perfil = await registration.obtenerPerfil(chatId);
    assert.equal(perfil.paciente.alias, null);
  });

  test('no se puede confirmar sin sesión', async () => {
    const chatId = await pacienteConConsentimiento();
    const resultado = await registration.confirmarRegistro(chatId);
    assert.equal(resultado.tipo, 'sin_sesion');
  });

  test('no permite registrar sin consentimiento vigente', async () => {
    await registration.iniciar(CHAT);
    const resultado = await registration.iniciarRegistro(CHAT);
    assert.equal(resultado.tipo, 'requiere_consentimiento');
  });

  test('retoma un registro a medias sin volver a preguntar el alias', async () => {
    const chatId = await pacienteConConsentimiento();
    await registration.iniciarRegistro(chatId);
    await registration.procesarTexto(chatId, 'Ana');

    const retomado = await registration.iniciarRegistro(chatId);
    assert.equal(retomado.paso, 'anioNacimiento');
  });
});
