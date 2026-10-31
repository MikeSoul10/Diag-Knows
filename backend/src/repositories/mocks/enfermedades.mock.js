/**
 * Mock en memoria del catálogo `enfermedades` y de `paciente_enfermedades`.
 *
 * Misma interfaz que tendrá `src/repositories/enfermedades.repo.js`:
 *   listar() -> [{ id, codigo, nombre }]
 *   obtenerPorId(id) -> enfermedad | null
 *   listarPorPaciente(pacienteId) -> [{ id, codigo, nombre }]
 *   asignar({ pacienteId, enfermedadId, diagnosticadaEn }) -> asignación
 *   __reset()
 *
 * Los ids son fijos (UUID válidos) para que las pruebas y los `callback_data`
 * de Telegram sean deterministas. En la BD real los genera `gen_random_uuid()`.
 */

const CATALOGO = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    codigo: 'DIABETES_TIPO_2',
    nombre: 'Diabetes tipo 2',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    codigo: 'HIPERTENSION',
    nombre: 'Hipertensión arterial',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    codigo: 'ASMA',
    nombre: 'Asma',
  },
];

/** @type {Map<string, Map<string, {diagnosticadaEn: string|null}>>} */
let asignaciones = new Map();

function comoDTO(enfermedad) {
  return { id: enfermedad.id, codigo: enfermedad.codigo, nombre: enfermedad.nombre };
}

export async function listar() {
  return CATALOGO.map(comoDTO);
}

export async function obtenerPorId(id) {
  const encontrada = CATALOGO.find((enfermedad) => enfermedad.id === String(id ?? ''));
  return encontrada ? comoDTO(encontrada) : null;
}

export async function listarPorPaciente(pacienteId) {
  const delPaciente = asignaciones.get(String(pacienteId ?? ''));
  if (!delPaciente) return [];

  // Se respeta el orden del catálogo, no el de inserción.
  return CATALOGO.filter((enfermedad) => delPaciente.has(enfermedad.id)).map(comoDTO);
}

export async function asignar({ pacienteId, enfermedadId, diagnosticadaEn = null }) {
  if (!pacienteId) throw new Error('pacienteId es obligatorio');

  const enfermedad = await obtenerPorId(enfermedadId);
  if (!enfermedad) throw new Error(`Enfermedad fuera del catálogo: ${enfermedadId}`);

  const clave = String(pacienteId);
  if (!asignaciones.has(clave)) asignaciones.set(clave, new Map());
  asignaciones.get(clave).set(enfermedad.id, { diagnosticadaEn });

  return { pacienteId: clave, enfermedadId: enfermedad.id, diagnosticadaEn };
}

export function __reset() {
  asignaciones = new Map();
}
