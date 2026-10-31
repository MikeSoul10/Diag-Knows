/**
 * Stubs de los repositorios PostgreSQL del Sprint 2.
 *
 * Tienen la MISMA firma que los mocks (`mocks/mediciones.mock.js`,
 * `mocks/sintomas.mock.js`, `mocks/medicamentos.mock.js`,
 * `mocks/dosisLogs.mock.js`), pero todavía no hablan con la base de datos: el
 * Sprint 2 se entrega con la capa de datos simulada.
 *
 * Cuando se conecte PostgreSQL (Sprint 3/4), cada función se implementa aquí o
 * en su archivo `*.repo.js` y `repositories/index.js` empieza a exportar esta
 * versión. La lógica de negocio no cambia: recibe y devuelve los mismos DTO.
 *
 * No hay SQL en este archivo a propósito: el cifrado con `pgp_sym_encrypt`
 * (AES-256) y la migración 004 (`registros_dosis.horario_id` NOT NULL) se
 * resuelven cuando se conecte la BD.
 */

function noImplementado(metodo) {
  return new Error(`No implementado: ${metodo}. Sprint 2 usa los repositorios mock.`);
}

export const mediciones = {
  async guardarMedicion() {
    throw noImplementado('mediciones.guardarMedicion');
  },
  async listarPorPaciente() {
    throw noImplementado('mediciones.listarPorPaciente');
  },
  __reset() {},
};

export const sintomas = {
  async guardarSintoma() {
    throw noImplementado('sintomas.guardarSintoma');
  },
  async listarPorPaciente() {
    throw noImplementado('sintomas.listarPorPaciente');
  },
  __reset() {},
};

export const medicamentos = {
  async listarPorPaciente() {
    throw noImplementado('medicamentos.listarPorPaciente');
  },
  async buscarPorNombre() {
    throw noImplementado('medicamentos.buscarPorNombre');
  },
  async crear() {
    throw noImplementado('medicamentos.crear');
  },
  async sembrarDatosDesarrollo() {
    throw noImplementado('medicamentos.sembrarDatosDesarrollo');
  },
  __reset() {},
};

export const dosisLogs = {
  async guardarTomaMedicamento() {
    throw noImplementado('dosisLogs.guardarTomaMedicamento');
  },
  async listarPorPaciente() {
    throw noImplementado('dosisLogs.listarPorPaciente');
  },
  __reset() {},
};
