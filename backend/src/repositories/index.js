/**
 * Punto único de acceso a datos.
 *
 * Los servicios importan SIEMPRE de aquí, nunca de `./mocks/*` ni de `*.repo.js`.
 * Eso es lo que permite pasar de mocks a PostgreSQL sin tocar la lógica de negocio.
 *
 * Contrato de los DTO (ya normalizado en camelCase):
 *   paciente      -> { id, telegramChatId, alias, anioNacimiento, estado, creadoEn, consentimientoVigente }
 *   consentimiento-> { id, pacienteId, aceptado, versionPrivacidad, aceptadoEn }
 *   enfermedad    -> { id, codigo, nombre }
 *   medicamento   -> { id, pacienteId, nombre, dosis, frecuencia, fechaInicio, fechaFin }
 *   medicion      -> { id, pacienteId, tipo, valor, valor2, unidad, esCritica, medidaEn }
 *   sintoma       -> { id, pacienteId, descripcion, nivelGravedad, reportadoEn }
 *   toma          -> { id, pacienteId, medicamentoId, nombreReportado, estado, tomadaEn }
 *
 * Cuando exista el repositorio real, el cambio es solo este archivo:
 *
 *   import { usarRepositoriosMock } from '../config/env.js';
 *   import * as medicionesMock from './mocks/mediciones.mock.js';
 *   import * as medicionesReal from './mediciones.repo.js';
 *   ...
 *   export const mediciones = usarRepositoriosMock() ? medicionesMock : medicionesReal;
 *
 * Mientras tanto, `postgres.stubs.js` conserva la firma que tendrá el repo real.
 */

import * as patientsMock from './mocks/patients.mock.js';
import * as consentimientoMock from './mocks/consentimiento.mock.js';
import * as enfermedadesMock from './mocks/enfermedades.mock.js';
import * as medicionesMock from './mocks/mediciones.mock.js';
import * as sintomasMock from './mocks/sintomas.mock.js';
import * as medicamentosMock from './mocks/medicamentos.mock.js';
import * as dosisLogsMock from './mocks/dosisLogs.mock.js';

export const patients = patientsMock;
export const consentimiento = consentimientoMock;
export const enfermedades = enfermedadesMock;
export const mediciones = medicionesMock;
export const sintomas = sintomasMock;
export const medicamentos = medicamentosMock;
export const dosisLogs = dosisLogsMock;

/** Solo para pruebas: deja los repositorios como recién arrancados. */
export function reiniciarRepositorios() {
  patients.__reset();
  consentimiento.__reset();
  enfermedades.__reset();
  mediciones.__reset();
  sintomas.__reset();
  medicamentos.__reset();
  dosisLogs.__reset();
}
