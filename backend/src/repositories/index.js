/**
 * Punto único de acceso a datos.
 *
 * Los servicios importan SIEMPRE de aquí, nunca de `./mocks/*` ni de `*.repo.js`.
 * Eso es lo que permite pasar de mocks a PostgreSQL sin tocar la lógica de negocio.
 *
 * Contrato de los DTO (ya normalizado en camelCase), idéntico en mock y en real:
 *   paciente      -> { id, telegramChatId, alias, anioNacimiento, estado, creadoEn, consentimientoVigente }
 *   consentimiento-> { id, pacienteId, aceptado, versionPrivacidad, aceptadoEn }
 *   enfermedad    -> { id, codigo, nombre }
 *   medicamento   -> { id, pacienteId, nombre, dosis, frecuencia, fechaInicio, fechaFin }
 *   medicion      -> { id, pacienteId, tipo, valor, valor2, unidad, esCritica, medidaEn }
 *   sintoma       -> { id, pacienteId, descripcion, nivelGravedad, reportadoEn }
 *   toma          -> { id, pacienteId, medicamentoId, nombreReportado, estado, tomadaEn }
 *
 * La elección mock/PostgreSQL se hace EN CADA LLAMADA con `usarRepositoriosMock()`
 * (USE_MOCK_REPOS, o mock si no hay DATABASE_URL). Así no importa el orden en
 * que se carguen el `.env` y los módulos, y las pruebas pueden forzar el modo.
 */

import { usarRepositoriosMock } from '../config/env.js';
import { enTransaccion } from '../db/pool.js';

import * as patientsMock from './mocks/patients.mock.js';
import * as consentimientoMock from './mocks/consentimiento.mock.js';
import * as enfermedadesMock from './mocks/enfermedades.mock.js';
import * as medicionesMock from './mocks/mediciones.mock.js';
import * as sintomasMock from './mocks/sintomas.mock.js';
import * as medicamentosMock from './mocks/medicamentos.mock.js';
import * as dosisLogsMock from './mocks/dosisLogs.mock.js';
import * as saludMock from './mocks/salud.mock.js';

import * as patientsReal from './patients.repo.js';
import * as consentimientoReal from './consentimiento.repo.js';
import * as enfermedadesReal from './enfermedades.repo.js';
import * as medicionesReal from './mediciones.repo.js';
import * as sintomasReal from './sintomas.repo.js';
import * as medicamentosReal from './medicamentos.repo.js';
import * as dosisLogsReal from './dosisLogs.repo.js';
import * as saludReal from './salud.repo.js';

/**
 * Fachada que delega cada función al mock o al repo real según el modo vigente.
 * `__reset` siempre limpia el mock (el repo real no guarda estado en memoria).
 */
export function elegir(mock, real) {
  const fachada = {};
  for (const nombre of new Set([...Object.keys(mock), ...Object.keys(real)])) {
    const muestra = mock[nombre] ?? real[nombre];
    if (typeof muestra !== 'function') {
      fachada[nombre] = muestra;
    } else if (nombre === '__reset') {
      fachada[nombre] = () => mock.__reset?.();
    } else {
      fachada[nombre] = (...args) => {
        const impl = usarRepositoriosMock() ? mock : real;
        if (typeof impl[nombre] !== 'function') {
          throw new Error(`El repositorio no implementa ${nombre}`);
        }
        return impl[nombre](...args);
      };
    }
  }
  return Object.freeze(fachada);
}

export const patients = elegir(patientsMock, patientsReal);
export const consentimiento = elegir(consentimientoMock, consentimientoReal);
export const enfermedades = elegir(enfermedadesMock, enfermedadesReal);
export const mediciones = elegir(medicionesMock, medicionesReal);
export const sintomas = elegir(sintomasMock, sintomasReal);
export const medicamentos = elegir(medicamentosMock, medicamentosReal);
export const dosisLogs = elegir(dosisLogsMock, dosisLogsReal);
export const salud = elegir(saludMock, saludReal);

/**
 * Ejecuta `fn()` de forma atómica: en PostgreSQL, todas las llamadas a los
 * repositorios hechas dentro de `fn` van en una sola transacción (o se guarda
 * todo o nada). En modo mock solo ejecuta `fn`.
 */
export function transaccion(fn) {
  return usarRepositoriosMock() ? fn() : enTransaccion(() => fn());
}

/** Solo para pruebas: deja los repositorios mock como recién arrancados. */
export function reiniciarRepositorios() {
  patients.__reset();
  consentimiento.__reset();
  enfermedades.__reset();
  mediciones.__reset();
  sintomas.__reset();
  medicamentos.__reset();
  dosisLogs.__reset();
}
