/**
 * Pruebas de integración contra PostgreSQL real (DK-103, DK-105, DK-106).
 *
 * Solo corren si existe TEST_DATABASE_URL; si no, se omiten y `npm test`
 * sigue sin necesitar red ni BD. El nombre de la BD debe contener "test":
 * cada prueba hace TRUNCATE y no queremos borrar una BD real por error.
 *
 *   docker compose up -d
 *   TEST_DATABASE_URL=postgres://diag:diag@localhost:5433/asistente_cronicas_test npm test
 */

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const URL_PRUEBAS = (process.env.TEST_DATABASE_URL || '').trim();
const nombreBd = URL_PRUEBAS ? new URL(URL_PRUEBAS).pathname.slice(1) : '';
const omitir = !URL_PRUEBAS
  ? 'TEST_DATABASE_URL no está definida'
  : !/test/i.test(nombreBd)
    ? `la BD "${nombreBd}" no parece de pruebas (su nombre debe contener "test")`
    : false;

if (!omitir) {
  process.env.DATABASE_URL = URL_PRUEBAS;
  process.env.USE_MOCK_REPOS = 'false';
  process.env.ENCRYPTION_KEY = 'llave-de-pruebas-de-integracion-0123456789abcdef';
}

const LLAVE = process.env.ENCRYPTION_KEY;

describe('PostgreSQL (integración)', { skip: omitir }, () => {
  let repos;
  let registration;
  let sesiones;
  let pool;

  before(async () => {
    const { migrar } = await import('../../src/db/migrate.js');
    pool = await import('../../src/db/pool.js');
    repos = await import('../../src/repositories/index.js');
    registration = await import('../../src/services/registration.service.js');
    sesiones = await import('../../src/services/session.store.js');
    await migrar({ log: () => {} });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE pacientes, administradores RESTART IDENTITY CASCADE');
    sesiones.__reset();
  });

  after(async () => {
    await pool?.cerrarPool();
  });

  describe('pacientes', () => {
    test('findOrCreate es idempotente y expone telegramChatId como string', async () => {
      const a = await repos.patients.findOrCreate(555001);
      const b = await repos.patients.findOrCreate('555001');
      assert.equal(a.id, b.id);
      assert.equal(a.telegramChatId, '555001');
      assert.equal(a.estado, 'ACTIVO');
      assert.equal(a.consentimientoVigente, false);
      assert.match(a.creadoEn, /Z$/);

      const { rows } = await pool.query('SELECT count(*)::int AS n FROM pacientes');
      assert.equal(rows[0].n, 1);
    });

    test('updatePerfil solo cambia lo que viene definido', async () => {
      const p = await repos.patients.findOrCreate(555002);
      await repos.patients.updatePerfil(p.id, { alias: 'Ana', anioNacimiento: 1990 });
      const soloAlias = await repos.patients.updatePerfil(p.id, { alias: 'Anita' });
      assert.equal(soloAlias.alias, 'Anita');
      assert.equal(soloAlias.anioNacimiento, 1990);
    });

    test('ids inexistentes o mal formados devuelven null', async () => {
      assert.equal(await repos.patients.findById('no-es-uuid'), null);
      assert.equal(await repos.patients.findById('99999999-9999-4999-8999-999999999999'), null);
      assert.equal(await repos.patients.findByTelegramChatId(1), null);
      assert.equal(await repos.patients.setEstado('no-es-uuid', 'INACTIVO'), null);
    });

    test('setEstado valida el estado', async () => {
      const p = await repos.patients.findOrCreate(555003);
      assert.equal((await repos.patients.setEstado(p.id, 'INACTIVO')).estado, 'INACTIVO');
      await assert.rejects(() => repos.patients.setEstado(p.id, 'BORRADO'), /Estado inválido/);
    });
  });

  describe('consentimiento', () => {
    test('manda el registro más reciente', async () => {
      const p = await repos.patients.findOrCreate(555010);
      const base = { pacienteId: p.id, versionPrivacidad: 'v1.0' };
      await repos.consentimiento.registrar({ ...base, aceptado: true });
      assert.equal(await repos.consentimiento.vigente(p.id), true);
      await repos.consentimiento.registrar({ ...base, aceptado: false });
      assert.equal(await repos.consentimiento.vigente(p.id), false);
      assert.equal((await repos.patients.findById(p.id)).consentimientoVigente, false);
      await repos.consentimiento.registrar({ ...base, aceptado: true });
      assert.equal((await repos.patients.findById(p.id)).consentimientoVigente, true);

      const historial = await repos.consentimiento.listarPorPaciente(p.id);
      assert.deepEqual(
        historial.map((r) => r.aceptado),
        [true, false, true]
      );
    });
  });

  describe('enfermedades', () => {
    test('el catálogo trae las 3 enfermedades con los mismos ids del mock', async () => {
      const real = await repos.enfermedades.listar();
      process.env.USE_MOCK_REPOS = 'true';
      const mock = await repos.enfermedades.listar();
      process.env.USE_MOCK_REPOS = 'false';
      assert.deepEqual(real, mock);
    });

    test('asignar es idempotente y rechaza enfermedades fuera del catálogo', async () => {
      const p = await repos.patients.findOrCreate(555020);
      const [diabetes] = await repos.enfermedades.listar();
      await repos.enfermedades.asignar({ pacienteId: p.id, enfermedadId: diabetes.id });
      await repos.enfermedades.asignar({ pacienteId: p.id, enfermedadId: diabetes.id });
      assert.deepEqual(await repos.enfermedades.listarPorPaciente(p.id), [diabetes]);
      await assert.rejects(
        () =>
          repos.enfermedades.asignar({
            pacienteId: p.id,
            enfermedadId: '99999999-9999-4999-8999-999999999999',
          }),
        /fuera del catálogo/
      );
    });
  });

  describe('mediciones y síntomas (cifrado AES-256)', () => {
    test('la glucosa y la presión se guardan cifradas y se leen descifradas', async () => {
      const p = await repos.patients.findOrCreate(555030);
      const medidaEn = '2026-10-30T14:05:00.000Z';
      const glucosa = await repos.mediciones.guardarMedicion({
        pacienteId: p.id,
        tipo: 'glucosa',
        valor: 115,
        medidaEn,
      });
      assert.deepEqual(
        { ...glucosa, id: undefined },
        {
          id: undefined,
          pacienteId: p.id,
          tipo: 'glucosa',
          valor: 115,
          valor2: null,
          unidad: 'mg/dL',
          esCritica: false,
          medidaEn,
        }
      );
      await repos.mediciones.guardarMedicion({
        pacienteId: p.id,
        tipo: 'presion',
        valor: 120,
        valor2: 80,
      });

      const lista = await repos.mediciones.listarPorPaciente(p.id);
      assert.deepEqual(
        lista.map((m) => [m.tipo, m.valor, m.valor2, m.unidad]),
        [
          ['glucosa', 115, null, 'mg/dL'],
          ['presion', 120, 80, 'mmHg'],
        ]
      );

      // En la columna no hay texto plano, y solo la llave correcta lo abre.
      const { rows } = await pool.query(
        `SELECT tipo_medicion, valor_cifrado, pgp_sym_decrypt(valor_cifrado, $1) AS claro
           FROM mediciones ORDER BY registrada_en`,
        [LLAVE]
      );
      assert.ok(!rows[0].valor_cifrado.toString('latin1').includes('115'));
      assert.deepEqual(
        rows.map((r) => [r.tipo_medicion, r.claro]),
        [
          ['GLUCOSA', '115'],
          ['PRESION_ARTERIAL', '120/80'],
        ]
      );
      await assert.rejects(() =>
        pool.query('SELECT pgp_sym_decrypt(valor_cifrado, $1) FROM mediciones', ['otra-llave'])
      );
    });

    test('listarPorRango respeta [desde, hasta)', async () => {
      const p = await repos.patients.findOrCreate(555031);
      for (const dia of ['2026-10-01', '2026-10-05', '2026-10-08']) {
        await repos.mediciones.guardarMedicion({
          pacienteId: p.id,
          tipo: 'peso',
          valor: 70.5,
          medidaEn: `${dia}T12:00:00Z`,
        });
      }
      const semana = await repos.mediciones.listarPorRango(p.id, '2026-10-01', '2026-10-08');
      assert.equal(semana.length, 2);
      assert.equal(semana[0].valor, 70.5);
    });

    test('el síntoma se guarda cifrado con su gravedad', async () => {
      const p = await repos.patients.findOrCreate(555032);
      await repos.sintomas.guardarSintoma({
        pacienteId: p.id,
        descripcion: '  mareo por la mañana ',
        nivelGravedad: 'LEVE',
      });
      const [s] = await repos.sintomas.listarPorPaciente(p.id);
      assert.equal(s.descripcion, 'mareo por la mañana');
      assert.equal(s.nivelGravedad, 'LEVE');

      const { rows } = await pool.query('SELECT descripcion_cifrada FROM sintomas');
      assert.ok(!rows[0].descripcion_cifrada.toString('utf8').includes('mareo'));
      await assert.rejects(
        () =>
          repos.sintomas.guardarSintoma({ pacienteId: p.id, descripcion: 'x', nivelGravedad: 'X' }),
        /Nivel de gravedad inválido/
      );
    });

    test('sin ENCRYPTION_KEY no se guarda nada', async () => {
      const p = await repos.patients.findOrCreate(555033);
      const llave = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      try {
        await assert.rejects(
          () => repos.mediciones.guardarMedicion({ pacienteId: p.id, tipo: 'glucosa', valor: 100 }),
          /Falta ENCRYPTION_KEY/
        );
      } finally {
        process.env.ENCRYPTION_KEY = llave;
      }
      assert.deepEqual(await repos.mediciones.listarPorPaciente(p.id), []);
    });
  });

  describe('medicamentos y tomas', () => {
    test('buscarPorNombre ignora acentos y mayúsculas', async () => {
      const p = await repos.patients.findOrCreate(555040);
      const creado = await repos.medicamentos.crear({
        pacienteId: p.id,
        nombre: 'Losartán',
        dosis: '50 mg',
        frecuencia: 'Cada 24 horas',
        fechaInicio: '2026-10-01',
      });
      assert.equal(creado.fechaInicio, '2026-10-01');
      assert.equal(creado.fechaFin, null);
      assert.equal((await repos.medicamentos.buscarPorNombre(p.id, 'LOSARTAN')).id, creado.id);
      assert.equal(await repos.medicamentos.buscarPorNombre(p.id, 'insulina'), null);
    });

    test('una toma suelta del chat se guarda sin horario (migración 004)', async () => {
      const p = await repos.patients.findOrCreate(555041);
      const med = await repos.medicamentos.crear({ pacienteId: p.id, nombre: 'Metformina' });
      const tomada = await repos.dosisLogs.guardarTomaMedicamento({
        pacienteId: p.id,
        medicamentoId: med.id,
        nombreReportado: 'metformina',
        tomada: true,
        tomadaEn: '2026-10-30T13:00:00Z',
      });
      assert.equal(tomada.estado, 'TOMADA');
      assert.equal(tomada.tomadaEn, '2026-10-30T13:00:00.000Z');

      const saltada = await repos.dosisLogs.guardarTomaMedicamento({
        pacienteId: p.id,
        nombreReportado: 'la pastilla',
        tomada: false,
      });
      assert.equal(saltada.estado, 'SALTADA');
      assert.equal(saltada.medicamentoId, null);

      const lista = await repos.dosisLogs.listarPorPaciente(p.id);
      assert.equal(lista.length, 2);
      const { rows } = await pool.query(
        'SELECT horario_id, tomada_en FROM registros_dosis WHERE estado = $1',
        ['SALTADA']
      );
      assert.equal(rows[0].horario_id, null);
      assert.equal(rows[0].tomada_en, null);
    });
  });

  describe('borrado en cascada', () => {
    test('borrar al paciente no deja filas hijas', async () => {
      const p = await repos.patients.findOrCreate(555050);
      await repos.consentimiento.registrar({
        pacienteId: p.id,
        aceptado: true,
        versionPrivacidad: 'v1.0',
      });
      await repos.mediciones.guardarMedicion({ pacienteId: p.id, tipo: 'glucosa', valor: 99 });
      await repos.sintomas.guardarSintoma({
        pacienteId: p.id,
        descripcion: 'tos',
        nivelGravedad: 'LEVE',
      });
      await repos.dosisLogs.guardarTomaMedicamento({ pacienteId: p.id, tomada: true });

      await pool.query('DELETE FROM pacientes WHERE id = $1', [p.id]);

      for (const tabla of [
        'registros_consentimiento',
        'mediciones',
        'sintomas',
        'registros_dosis',
      ]) {
        const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${tabla}`);
        assert.equal(rows[0].n, 0, tabla);
      }
    });
  });

  describe('DK-105: /start → consentimiento → /registrar persiste en PostgreSQL', () => {
    test('el perfil y la enfermedad quedan en la BD', async () => {
      const chat = 555100;
      await registration.iniciar(chat);
      await registration.aceptarConsentimiento(chat);
      await registration.iniciarRegistro(chat);
      await registration.procesarTexto(chat, 'Ana');
      const paso = await registration.procesarTexto(chat, '1990');
      const diabetes = paso.opciones.find((o) => o.nombre === 'Diabetes tipo 2');
      await registration.elegirEnfermedad(chat, diabetes.id);
      const fin = await registration.confirmarRegistro(chat);
      assert.equal(fin.tipo, 'completado');

      const { rows } = await pool.query(
        `SELECT p.alias, p.anio_nacimiento, e.codigo
           FROM pacientes p
           JOIN paciente_enfermedades pe ON pe.paciente_id = p.id
           JOIN enfermedades e ON e.id = pe.enfermedad_id
          WHERE p.telegram_chat_id = $1`,
        [chat]
      );
      assert.deepEqual(rows, [{ alias: 'Ana', anio_nacimiento: 1990, codigo: 'DIABETES_TIPO_2' }]);

      // Un segundo /start no duplica al paciente.
      await registration.iniciar(chat);
      const { rows: cuenta } = await pool.query('SELECT count(*)::int AS n FROM pacientes');
      assert.equal(cuenta[0].n, 1);
    });
  });

  describe('guardado atómico', () => {
    test('transaccion: si algo falla a la mitad, no queda nada guardado', async () => {
      const p = await repos.patients.findOrCreate(555300);
      await assert.rejects(() =>
        repos.transaccion(async () => {
          await repos.mediciones.guardarMedicion({ pacienteId: p.id, tipo: 'glucosa', valor: 100 });
          throw new Error('falla simulada');
        })
      );
      assert.deepEqual(await repos.mediciones.listarPorPaciente(p.id), []);
    });

    test('reporte: si falla la toma, no se guardan medición ni síntoma y se puede reintentar', async () => {
      process.env.USE_MOCK_AI = 'true';
      const { crearServicioConversacion } = await import('../../src/services/conversacion.js');
      const { extraer } = await import('../../src/services/extractor.js');
      const { anonimizar } = await import('../../src/services/anonimizador.js');
      const { validarExtraccion } = await import('../../src/services/validador.js');

      let fallar = true;
      const dosisLogs = {
        guardarTomaMedicamento: (...args) => {
          if (fallar) throw new Error('falla simulada');
          return repos.dosisLogs.guardarTomaMedicamento(...args);
        },
      };
      const servicio = crearServicioConversacion({
        repos: { ...repos, dosisLogs },
        extractor: { extraer },
        anonimizar,
        validar: validarExtraccion,
        generarToken: () => 'tokfijo',
        registrarError: () => {},
      });

      const chat = 555301;
      await registration.iniciar(chat);
      await registration.aceptarConsentimiento(chat);
      await servicio.procesarMensaje({
        chatId: chat,
        texto: 'me tomé la metformina y tengo glucosa en 115 y dolor de cabeza leve',
      });

      const contar = async () => {
        const { rows } = await pool.query(
          `SELECT (SELECT count(*) FROM mediciones)::int AS m,
                  (SELECT count(*) FROM sintomas)::int AS s,
                  (SELECT count(*) FROM registros_dosis)::int AS d`
        );
        return rows[0];
      };

      const fallo = await servicio.procesarCallback({
        chatId: chat,
        accion: 'ok',
        token: 'tokfijo',
      });
      assert.match(fallo.texto, /No pude guardar/);
      assert.deepEqual(await contar(), { m: 0, s: 0, d: 0 });

      fallar = false;
      const ok = await servicio.procesarCallback({ chatId: chat, accion: 'ok', token: 'tokfijo' });
      assert.equal(ok.aviso, 'Guardado');
      assert.deepEqual(await contar(), { m: 1, s: 1, d: 1 });
    });
  });

  describe('DK-103: un reporte confirmado queda cifrado en PostgreSQL', () => {
    test('nada se guarda antes de confirmar; al confirmar se guardan los tres registros', async () => {
      process.env.USE_MOCK_AI = 'true'; // extractor por regex: sin red ni llave de Anthropic
      const { crearConversacion } = await import('../../src/channel/conversacion.instancia.js');
      let n = 0;
      const servicio = crearConversacion({ generarToken: () => `tok${(n += 1)}` });

      const chat = 555200;
      await registration.iniciar(chat);
      await registration.aceptarConsentimiento(chat);
      const p = await repos.patients.findByTelegramChatId(chat);

      const resumen = await servicio.procesarMensaje({
        chatId: chat,
        texto: 'me tomé la metformina y tengo glucosa en 115 y dolor de cabeza leve',
      });
      const boton = resumen.botones.flat().find((b) => b.callback.startsWith('conv:ok:'));
      assert.ok(boton, 'debe ofrecer el botón de confirmar');

      const contar = async () => {
        const { rows } = await pool.query(
          `SELECT (SELECT count(*) FROM mediciones)::int AS m,
                  (SELECT count(*) FROM sintomas)::int AS s,
                  (SELECT count(*) FROM registros_dosis)::int AS d`
        );
        return rows[0];
      };
      assert.deepEqual(await contar(), { m: 0, s: 0, d: 0 });

      await servicio.procesarCallback({
        chatId: chat,
        accion: 'ok',
        token: boton.callback.split(':')[2],
      });
      assert.deepEqual(await contar(), { m: 1, s: 1, d: 1 });

      const [medicion] = await repos.mediciones.listarPorPaciente(p.id);
      assert.equal(medicion.valor, 115);
      const [sintoma] = await repos.sintomas.listarPorPaciente(p.id);
      assert.equal(sintoma.nivelGravedad, 'LEVE');
    });
  });
});
