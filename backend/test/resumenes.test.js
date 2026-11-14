/**
 * DK-302: resumen semanal. Adherencia, ventana lunes 00:00 → domingo 20:00,
 * idempotencia por semana y aislamiento de errores entre pacientes.
 */
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { crearServicioResumenes, ventanaSemana } from '../src/services/resumenes.js';
import { enviarResumenesSemanales } from '../src/jobs/scheduler.js';
import { localAUtc } from '../src/services/fechas.js';
import {
  patients,
  consentimiento,
  dosisLogs,
  resumenes,
  reiniciarRepositorios,
} from '../src/repositories/index.js';

process.env.USE_MOCK_REPOS = 'true';

const CHAT = 950001;
const OTRO_CHAT = 950002;
const ZONA = 'America/Mexico_City'; // UTC-6 todo el año

/** Instante UTC de una hora local de Ciudad de México. */
function local(anio, mes, dia, hora, minuto = 0) {
  return localAUtc({ anio, mes, dia, hora, minuto }, ZONA);
}

const DESDE_SEMANA = local(2026, 11, 9, 0, 0); // lunes 00:00
const HASTA_SEMANA = local(2026, 11, 15, 20, 0); // domingo 20:00

async function pacienteConConsentimiento(chatId = CHAT) {
  const paciente = await patients.findOrCreate(chatId);
  await consentimiento.registrar({
    pacienteId: paciente.id,
    aceptado: true,
    versionPrivacidad: 'v1.0',
  });
  return paciente;
}

async function tomaEn(pacienteId, fecha, tomada = true) {
  return dosisLogs.guardarTomaMedicamento({
    pacienteId,
    tomada,
    tomadaEn: fecha.toISOString(),
  });
}

function crearServicio(reloj) {
  return crearServicioResumenes({
    ahora: () => reloj.ahora,
    zonaHorariaPorDefecto: ZONA,
    registrarError: () => {},
  });
}

beforeEach(() => reiniciarRepositorios());

// ---------------------------------------------------------------------------
// Adherencia y ventana
// ---------------------------------------------------------------------------

describe('calcularAdherencia', () => {
  test('2 tomadas de 4 esperadas dan 50 % e ignoran las PENDIENTE', async () => {
    const paciente = await pacienteConConsentimiento();
    await tomaEn(paciente.id, local(2026, 11, 9, 8), true);
    await tomaEn(paciente.id, local(2026, 11, 10, 8), true);
    await tomaEn(paciente.id, local(2026, 11, 11, 8), false);
    await tomaEn(paciente.id, local(2026, 11, 12, 8), false);
    await dosisLogs.crearPendiente({
      pacienteId: paciente.id,
      horarioId: 'horario-1',
      programadaEn: local(2026, 11, 13, 8).toISOString(),
    });

    const resultado = await resumenes.calcularAdherencia({
      pacienteId: paciente.id,
      desde: DESDE_SEMANA,
      hasta: HASTA_SEMANA,
    });

    assert.deepEqual(resultado, { porcentaje: 50, tomadas: 2, esperadas: 4 });
  });

  test('la ventana es [lunes 00:00, domingo 20:00): el domingo 21:00 no cuenta', async () => {
    const paciente = await pacienteConConsentimiento();
    await tomaEn(paciente.id, local(2026, 11, 9, 0, 1), true); // lunes 00:01: sí
    await tomaEn(paciente.id, local(2026, 11, 15, 21, 0), true); // domingo 21:00: no

    const resultado = await resumenes.calcularAdherencia({
      pacienteId: paciente.id,
      desde: DESDE_SEMANA,
      hasta: HASTA_SEMANA,
    });

    assert.deepEqual(resultado, { porcentaje: 100, tomadas: 1, esperadas: 1 });
  });

  test('la ventana calculada es del lunes de esa semana al domingo 20:00 local', () => {
    const partes = { anio: 2026, mes: 11, dia: 15 }; // domingo
    const ventana = ventanaSemana(partes, ZONA);

    assert.equal(ventana.semanaInicio, '2026-11-09');
    assert.equal(ventana.desde.toISOString(), DESDE_SEMANA.toISOString());
    assert.equal(ventana.hasta.toISOString(), HASTA_SEMANA.toISOString());
  });
});

describe('listarCandidatos', () => {
  test('solo pacientes ACTIVO con consentimiento vigente', async () => {
    const conConsentimiento = await pacienteConConsentimiento(CHAT);
    const sinConsentimiento = await patients.findOrCreate(OTRO_CHAT);

    const candidatos = await resumenes.listarCandidatos();

    assert.deepEqual(
      candidatos.map(({ id }) => id),
      [conConsentimiento.id]
    );
    assert.equal(candidatos[0].telegramChatId, String(CHAT));
    assert.equal(sinConsentimiento.consentimientoVigente, false);
  });
});

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

describe('servicio de resumenes', () => {
  test('domingo 20:00 en la zona del paciente dispara; lunes 20:00 no', async () => {
    const paciente = await pacienteConConsentimiento();
    await tomaEn(paciente.id, local(2026, 11, 9, 10), true);

    const domingo = { ahora: local(2026, 11, 15, 20) };
    const [aviso, ...resto] = await crearServicio(domingo).resumenesQueTocan();
    assert.equal(resto.length, 0);
    assert.equal(aviso.chatId, String(CHAT));
    assert.equal(aviso.semanaInicio, '2026-11-09');
    assert.match(
      aviso.texto,
      /Resumen de tu semana: registraste 1 de 1 tomas \(100%\)\. Si tienes dudas, consúltalo con tu profesional de la salud\./
    );

    const lunes = { ahora: local(2026, 11, 9, 20) };
    assert.equal((await crearServicio(lunes).resumenesQueTocan()).length, 0);
  });

  test('sin tomas esperadas no envía «0 de 0»', async () => {
    await pacienteConConsentimiento();
    const domingo = { ahora: local(2026, 11, 15, 20) };

    assert.deepEqual(await crearServicio(domingo).resumenesQueTocan(), []);
  });

  test('ya enviado: guarda una sola fila y no repite el envío', async () => {
    const paciente = await pacienteConConsentimiento();
    await tomaEn(paciente.id, local(2026, 11, 10, 8), true);
    const domingo = { ahora: local(2026, 11, 15, 20) };
    const servicio = crearServicio(domingo);

    assert.equal((await servicio.resumenesQueTocan()).length, 1);
    assert.equal((await servicio.resumenesQueTocan()).length, 0);

    const guardados = await resumenes.listarPorPaciente(paciente.id);
    assert.equal(guardados.length, 1);
    assert.equal(guardados[0].semanaInicio, '2026-11-09');
    assert.equal(guardados[0].porcentajeAdherencia, 100);
  });

  test('un error en un paciente se registra y no interrumpe a los demás', async () => {
    const errores = [];
    const candidatos = [
      { id: 'roto', telegramChatId: '1', zonaHoraria: ZONA },
      { id: 'sano', telegramChatId: '2', zonaHoraria: ZONA },
    ];
    const servicio = crearServicioResumenes({
      repos: {
        resumenes: {
          listarCandidatos: async () => candidatos,
          calcularAdherencia: async ({ pacienteId }) => {
            if (pacienteId === 'roto') throw new Error('falló la BD');
            return { porcentaje: 100, tomadas: 1, esperadas: 1 };
          },
          crear: async ({ pacienteId }) => ({ id: `resumen-${pacienteId}` }),
        },
      },
      ahora: () => local(2026, 11, 15, 20),
      zonaHorariaPorDefecto: ZONA,
      registrarError: (contexto, error) => errores.push(`${contexto}: ${error.message}`),
    });

    const pendientes = await servicio.resumenesQueTocan();

    assert.deepEqual(
      pendientes.map(({ chatId }) => chatId),
      ['2']
    );
    assert.deepEqual(errores, ['el resumen semanal de un paciente: falló la BD']);
  });
});

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

describe('scheduler de resumenes', () => {
  test('un envío que falla no frena a los demás ni tumba el proceso', async () => {
    const enviados = [];
    const errores = [];
    const servicio = {
      resumenesQueTocan: async () => [{ chatId: '1' }, { chatId: '2' }, { chatId: '3' }],
    };
    const enviar = async (aviso) => {
      if (aviso.chatId === '2') throw new Error('Forbidden: bot was blocked by the user');
      enviados.push(aviso.chatId);
    };

    const total = await enviarResumenesSemanales({
      servicio,
      enviar,
      registrarError: (contexto, error) => errores.push(`${contexto}: ${error.name}`),
    });

    assert.equal(total, 2);
    assert.deepEqual(enviados, ['1', '3']);
    assert.deepEqual(errores, ['el envío de un resumen semanal: Error']);
  });

  test('si la búsqueda falla, la vuelta termina en 0 sin lanzar', async () => {
    const errores = [];
    const total = await enviarResumenesSemanales({
      servicio: { resumenesQueTocan: async () => Promise.reject(new Error('sin BD')) },
      enviar: async () => {},
      registrarError: (contexto) => errores.push(contexto),
    });

    assert.equal(total, 0);
    assert.deepEqual(errores, ['la búsqueda de resúmenes semanales']);
  });
});
