import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mediciones,
  sintomas,
  medicamentos,
  dosisLogs,
  reiniciarRepositorios,
} from '../src/repositories/index.js';
import * as postgres from '../src/repositories/postgres.stubs.js';

// Determinista aunque la máquina tenga DATABASE_URL: estas pruebas son del mock.
process.env.USE_MOCK_REPOS = 'true';

const PACIENTE = 'paciente-1';

beforeEach(() => {
  reiniciarRepositorios();
  process.env.USE_MOCK_REPOS = 'true';
  delete process.env.NODE_ENV;
});

describe('mediciones.mock', () => {
  test('guarda una glucosa y devuelve el DTO', async () => {
    const medicion = await mediciones.guardarMedicion({
      pacienteId: PACIENTE,
      tipo: 'glucosa',
      valor: 115,
      unidad: 'mg/dL',
      medidaEn: '2026-11-03T10:00:00.000Z',
    });

    assert.equal(medicion.pacienteId, PACIENTE);
    assert.equal(medicion.tipo, 'glucosa');
    assert.equal(medicion.valor, 115);
    assert.equal(medicion.valor2, null);
    assert.equal(medicion.unidad, 'mg/dL');
    assert.equal(medicion.esCritica, false);
    assert.equal(medicion.medidaEn, '2026-11-03T10:00:00.000Z');
    assert.match(medicion.id, /^[0-9a-f-]{36}$/);
  });

  test('la presión guarda sistólica y diastólica', async () => {
    const medicion = await mediciones.guardarMedicion({
      pacienteId: PACIENTE,
      tipo: 'presion',
      valor: 120,
      valor2: 80,
    });

    assert.equal(medicion.valor, 120);
    assert.equal(medicion.valor2, 80);
    assert.equal(medicion.unidad, 'mmHg');
  });

  test('usa la unidad por defecto del tipo', async () => {
    const medicion = await mediciones.guardarMedicion({
      pacienteId: PACIENTE,
      tipo: 'peso',
      valor: 72.5,
    });

    assert.equal(medicion.unidad, 'kg');
  });

  test('lista solo las mediciones del paciente, en orden', async () => {
    await mediciones.guardarMedicion({ pacienteId: PACIENTE, tipo: 'glucosa', valor: 100 });
    await mediciones.guardarMedicion({ pacienteId: 'otro', tipo: 'peso', valor: 80 });
    await mediciones.guardarMedicion({ pacienteId: PACIENTE, tipo: 'peso', valor: 81 });

    const lista = await mediciones.listarPorPaciente(PACIENTE);
    assert.deepEqual(
      lista.map((medicion) => medicion.tipo),
      ['glucosa', 'peso']
    );
  });

  test('rechaza un tipo desconocido y una presión incompleta', async () => {
    await assert.rejects(
      () => mediciones.guardarMedicion({ pacienteId: PACIENTE, tipo: 'temperatura', valor: 37 }),
      /Tipo de medición inválido/
    );
    await assert.rejects(
      () => mediciones.guardarMedicion({ pacienteId: PACIENTE, tipo: 'presion', valor: 120 }),
      /valor2/
    );
  });

  test('exige pacienteId', async () => {
    await assert.rejects(
      () => mediciones.guardarMedicion({ tipo: 'glucosa', valor: 115 }),
      /pacienteId es obligatorio/
    );
  });
});

describe('sintomas.mock', () => {
  test('guarda un síntoma con su nivel de gravedad', async () => {
    const sintoma = await sintomas.guardarSintoma({
      pacienteId: PACIENTE,
      descripcion: '  dolor de cabeza ',
      nivelGravedad: 'GRAVE',
      reportadoEn: '2026-11-03T10:00:00.000Z',
    });

    assert.equal(sintoma.descripcion, 'dolor de cabeza');
    assert.equal(sintoma.nivelGravedad, 'GRAVE');
    assert.equal(sintoma.reportadoEn, '2026-11-03T10:00:00.000Z');
  });

  test('rechaza un nivel fuera del esquema', async () => {
    await assert.rejects(
      () => sintomas.guardarSintoma({ pacienteId: PACIENTE, descripcion: 'tos', nivelGravedad: 3 }),
      /Nivel de gravedad inválido/
    );
  });

  test('rechaza una descripción vacía', async () => {
    await assert.rejects(
      () => sintomas.guardarSintoma({ pacienteId: PACIENTE, descripcion: '  ', nivelGravedad: 'LEVE' }),
      /descripcion es obligatoria/
    );
  });

  test('lista por paciente', async () => {
    await sintomas.guardarSintoma({ pacienteId: PACIENTE, descripcion: 'tos', nivelGravedad: 'LEVE' });

    const lista = await sintomas.listarPorPaciente(PACIENTE);
    assert.equal(lista.length, 1);
    assert.deepEqual(await sintomas.listarPorPaciente('otro'), []);
  });
});

describe('medicamentos.mock', () => {
  test('crea un medicamento del paciente', async () => {
    const medicamento = await medicamentos.crear({
      pacienteId: PACIENTE,
      nombre: 'Metformina',
      dosis: '850 mg',
      frecuencia: 'Cada 12 horas',
    });

    assert.equal(medicamento.nombre, 'Metformina');
    assert.equal(medicamento.dosis, '850 mg');
    assert.equal(medicamento.fechaFin, null);
    assert.equal(medicamento.pacienteId, PACIENTE);
  });

  test('busca por nombre sin distinguir mayúsculas ni acentos', async () => {
    await medicamentos.crear({ pacienteId: PACIENTE, nombre: 'Losartán', dosis: '50 mg' });

    const encontrado = await medicamentos.buscarPorNombre(PACIENTE, 'LOSARTAN');
    assert.equal(encontrado.nombre, 'Losartán');
  });

  test('encuentra el medicamento con un nombre parcial', async () => {
    await medicamentos.crear({ pacienteId: PACIENTE, nombre: 'Metformina 850 mg' });

    const encontrado = await medicamentos.buscarPorNombre(PACIENTE, 'metformina');
    assert.equal(encontrado.nombre, 'Metformina 850 mg');
  });

  test('devuelve null si el paciente no tiene ese medicamento', async () => {
    await medicamentos.crear({ pacienteId: PACIENTE, nombre: 'Metformina' });

    assert.equal(await medicamentos.buscarPorNombre(PACIENTE, 'insulina'), null);
    assert.equal(await medicamentos.buscarPorNombre(PACIENTE, ''), null);
    assert.equal(await medicamentos.buscarPorNombre('otro', 'metformina'), null);
  });

  test('siembra los medicamentos de desarrollo', async () => {
    const creados = await medicamentos.sembrarDatosDesarrollo(PACIENTE);

    assert.equal(creados.length, 2);
    const lista = await medicamentos.listarPorPaciente(PACIENTE);
    assert.deepEqual(
      lista.map((medicamento) => medicamento.nombre),
      ['Metformina', 'Losartán']
    );
  });

  test('no siembra en producción', async () => {
    process.env.NODE_ENV = 'production';

    await assert.rejects(
      () => medicamentos.sembrarDatosDesarrollo(PACIENTE),
      /no está permitido en producción/
    );
    assert.deepEqual(await medicamentos.listarPorPaciente(PACIENTE), []);
  });

  test('no siembra fuera del modo mock', async () => {
    process.env.USE_MOCK_REPOS = 'false';

    await assert.rejects(
      () => medicamentos.sembrarDatosDesarrollo(PACIENTE),
      /solo existe en modo mock/
    );
  });
});

describe('dosisLogs.mock', () => {
  test('una toma confirmada queda como TOMADA', async () => {
    const registro = await dosisLogs.guardarTomaMedicamento({
      pacienteId: PACIENTE,
      medicamentoId: 'med-1',
      nombreReportado: 'metformina',
      tomada: true,
      tomadaEn: '2026-11-03T10:00:00.000Z',
    });

    assert.equal(registro.estado, 'TOMADA');
    assert.equal(registro.medicamentoId, 'med-1');
    assert.equal(registro.nombreReportado, 'metformina');
    assert.equal(registro.tomadaEn, '2026-11-03T10:00:00.000Z');
  });

  test('una toma negada queda como SALTADA', async () => {
    const registro = await dosisLogs.guardarTomaMedicamento({
      pacienteId: PACIENTE,
      nombreReportado: 'Losartán',
      tomada: false,
    });

    assert.equal(registro.estado, 'SALTADA');
    assert.equal(registro.medicamentoId, null);
  });

  test('acepta hablar de "la pastilla" sin nombre ni medicamento', async () => {
    const registro = await dosisLogs.guardarTomaMedicamento({
      pacienteId: PACIENTE,
      tomada: true,
    });

    assert.equal(registro.nombreReportado, null);
    assert.equal(registro.medicamentoId, null);
  });

  test('exige saber si la tomó', async () => {
    await assert.rejects(
      () => dosisLogs.guardarTomaMedicamento({ pacienteId: PACIENTE, nombreReportado: 'metformina' }),
      /tomada debe ser booleano/
    );
  });

  test('lista por paciente', async () => {
    await dosisLogs.guardarTomaMedicamento({ pacienteId: PACIENTE, tomada: true });
    await dosisLogs.guardarTomaMedicamento({ pacienteId: 'otro', tomada: false });

    const lista = await dosisLogs.listarPorPaciente(PACIENTE);
    assert.equal(lista.length, 1);
  });
});

describe('reiniciarRepositorios', () => {
  test('deja todos los repositorios vacíos', async () => {
    await mediciones.guardarMedicion({ pacienteId: PACIENTE, tipo: 'glucosa', valor: 115 });
    await sintomas.guardarSintoma({ pacienteId: PACIENTE, descripcion: 'tos', nivelGravedad: 'LEVE' });
    await medicamentos.crear({ pacienteId: PACIENTE, nombre: 'Metformina' });
    await dosisLogs.guardarTomaMedicamento({ pacienteId: PACIENTE, tomada: true });

    reiniciarRepositorios();

    assert.deepEqual(await mediciones.listarPorPaciente(PACIENTE), []);
    assert.deepEqual(await sintomas.listarPorPaciente(PACIENTE), []);
    assert.deepEqual(await medicamentos.listarPorPaciente(PACIENTE), []);
    assert.deepEqual(await dosisLogs.listarPorPaciente(PACIENTE), []);
  });
});

describe('postgres.stubs', () => {
  test('conservan la firma pero avisan que no están implementados', async () => {
    await assert.rejects(
      () => postgres.mediciones.guardarMedicion({ pacienteId: PACIENTE, tipo: 'glucosa', valor: 115 }),
      /No implementado: mediciones\.guardarMedicion/
    );
    await assert.rejects(
      () => postgres.sintomas.guardarSintoma({ pacienteId: PACIENTE }),
      /No implementado: sintomas\.guardarSintoma/
    );
    await assert.rejects(
      () => postgres.medicamentos.buscarPorNombre(PACIENTE, 'metformina'),
      /No implementado: medicamentos\.buscarPorNombre/
    );
    await assert.rejects(
      () => postgres.dosisLogs.guardarTomaMedicamento({ pacienteId: PACIENTE, tomada: true }),
      /No implementado: dosisLogs\.guardarTomaMedicamento/
    );
  });

  test('__reset es inocuo para que el cambio de implementación no rompa pruebas', () => {
    assert.doesNotThrow(() => {
      postgres.mediciones.__reset();
      postgres.sintomas.__reset();
      postgres.medicamentos.__reset();
      postgres.dosisLogs.__reset();
    });
  });
});
