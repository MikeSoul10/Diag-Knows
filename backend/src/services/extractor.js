/**
 * Extractor de datos de seguimiento a partir de texto libre.
 *
 * Contrato (el mismo para el mock y para Claude):
 *   {
 *     medicacion: [{ tomada: boolean, nombre: string|null }],
 *     mediciones: [{ tipo: 'glucosa'|'presion'|'peso', valor: number, valor2?: number, unidad: string }],
 *     sintomas:   [{ descripcion: string, severidad: 1|2|3|null }]
 *   }
 *
 * `severidad` en `null` significa "el paciente no lo dijo": NO se inventa un
 * valor, la conversación le pregunta. `nombre` en `null` significa que habló de
 * "la pastilla" sin decir cuál.
 *
 * Este módulo NO valida rangos (eso es `validador.js`) ni anonimiza (el texto
 * llega ya anonimizado desde `conversacion.js`).
 */

import { usarIAMock } from '../config/env.js';

export const UNIDADES = Object.freeze({
  glucosa: 'mg/dL',
  presion: 'mmHg',
  peso: 'kg',
});

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

/** Minúsculas y sin acentos, para tolerar "TOMÉ", "tome" y "tomé". */
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function aNumero(valor) {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const numero = Number(String(valor).replace(',', '.'));
  return Number.isFinite(numero) ? numero : null;
}

// ---------------------------------------------------------------------------
// Medicación
// ---------------------------------------------------------------------------

const NEGACIONES = [
  /\bno\s+(?:me\s+)?(?:la\s+|lo\s+|el\s+|mi\s+)?tome\b/,
  /\bse\s+me\s+olvido\b/,
  /\bolvide\s+tomar/,
  /\bno\s+la\s+tome\b/,
  /\bno\s+tome\b/,
];

const AFIRMACIONES = [
  /\b(?:ya\s+)?(?:me\s+)?(?:la\s+|lo\s+|el\s+|mi\s+)?tome\b/,
  /\bya\s+(?:me\s+)?la\s+tome\b/,
];

const PATRONES_NOMBRE = [
  /\btome\s+(?:la\s+|el\s+|lo\s+|mi\s+|mis\s+|una\s+|un\s+)?([a-z][a-z0-9]{2,})/,
  /\btomar(?:me|la|lo|los|las)?\s+(?:la\s+|el\s+|lo\s+|mi\s+)?([a-z][a-z0-9]{2,})/,
  /\bolvide\s+(?:de\s+)?(?:tomar(?:me|la|lo)?\s+)?(?:la\s+|el\s+|mi\s+)?([a-z][a-z0-9]{2,})/,
];

/** Palabras que no son el nombre de un medicamento. */
const GENERICAS = new Set([
  'pastilla',
  'pastillas',
  'medicamento',
  'medicamentos',
  'medicina',
  'remedio',
  'tableta',
  'tabletas',
  'capsula',
  'capsulas',
  'pildora',
  'pildoras',
  'dosis',
  'tratamiento',
  'ayer',
  'hoy',
  'tarde',
  'noche',
  'manana',
  'despues',
  'antes',
  'todo',
  'nada',
]);

function nombreDeMedicamento(texto) {
  for (const patron of PATRONES_NOMBRE) {
    const coincidencia = texto.match(patron);
    if (!coincidencia) continue;

    const candidato = coincidencia[1];
    if (GENERICAS.has(candidato)) continue;
    return candidato;
  }
  return null;
}

function medicacionDe(texto) {
  const negada = NEGACIONES.some((patron) => patron.test(texto));
  const afirmada = AFIRMACIONES.some((patron) => patron.test(texto));

  if (!negada && !afirmada) return [];

  return [{ tomada: !negada, nombre: nombreDeMedicamento(texto) }];
}

// ---------------------------------------------------------------------------
// Mediciones
// ---------------------------------------------------------------------------

const PATRONES_MEDICION = [
  // "presión 120/80", "tensión 120 sobre 80"
  {
    tipo: 'presion',
    patron: /(?:presion|tension|arterial)[^\d]{0,20}(\d{2,3})\s*(?:\/|sobre)\s*(\d{2,3})/,
  },
  // "traigo 130/85" (sin la palabra presión). El lookahead evita leer 12/03/2026 como presión.
  {
    tipo: 'presion',
    patron: /\b(\d{2,3})\s*(?:\/|sobre)\s*(\d{2,3})\b(?!\s*(?:\/|sobre)\s*\d)/,
  },
  // "glucosa en 115", "azúcar 115"
  {
    tipo: 'glucosa',
    patron: /(?:glucosa|azucar)[^\d]{0,15}(\d{1,3}(?:[.,]\d+)?)/,
  },
  // "115 mg/dL"
  {
    tipo: 'glucosa',
    patron: /\b(\d{1,3}(?:[.,]\d+)?)\s*(?:mg\/dl|mgdl|miligramos)\b/,
  },
  // "peso 72.5", "peso de 80"
  {
    tipo: 'peso',
    patron: /(?:peso|peso de)[^\d]{0,10}(\d{2,3}(?:[.,]\d{1,2})?)/,
  },
  // "72.5 kg", "80 kilos"
  {
    tipo: 'peso',
    patron: /\b(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg|kgs|kilos?|kilogramos?)\b/,
  },
];

function medicionesDe(texto) {
  const encontradas = [];

  const agregar = (medicion) => {
    const repetida = encontradas.some(
      (otra) =>
        otra.tipo === medicion.tipo &&
        otra.valor === medicion.valor &&
        (otra.valor2 ?? null) === (medicion.valor2 ?? null)
    );
    if (!repetida) encontradas.push(medicion);
  };

  for (const { tipo, patron } of PATRONES_MEDICION) {
    const coincidencia = texto.match(patron);
    if (!coincidencia) continue;

    const valor = aNumero(coincidencia[1]);
    if (valor === null) continue;

    if (tipo === 'presion') {
      const valor2 = aNumero(coincidencia[2]);
      if (valor2 === null) continue;
      agregar({ tipo, valor, valor2, unidad: UNIDADES[tipo] });
    } else {
      agregar({ tipo, valor, unidad: UNIDADES[tipo] });
    }
  }

  return encontradas;
}

// ---------------------------------------------------------------------------
// Síntomas
// ---------------------------------------------------------------------------

/** Los siete síntomas del alcance, con sinónimos coloquiales. */
const SINTOMAS = [
  {
    nombre: 'dolor de cabeza',
    patrones: [
      /\bdolor de cabeza\b/,
      /\bme duele la cabeza\b/,
      /\bcabeza\b/,
      /\bjaqueca\b/,
      /\bmigrana\b/,
    ],
  },
  {
    nombre: 'mareo',
    patrones: [/\bmareo\b/, /\bmaread[oa]\b/, /\bvahido\b/, /\bvertigo\b/],
  },
  {
    nombre: 'cansancio',
    patrones: [
      /\bcansancio\b/,
      /\bcansad[oa]\b/,
      /\bfatiga\b/,
      /\bsin energia\b/,
      /\bagotad[oa]\b/,
    ],
  },
  {
    nombre: 'falta de aire',
    patrones: [
      /\bfalta de aire\b/,
      /\bfalta el aire\b/,
      /\bdificultad para respirar\b/,
      /\bno puedo respirar\b/,
      /\bahogo\b/,
      /\bdisnea\b/,
    ],
  },
  {
    nombre: 'nauseas',
    patrones: [/\bnauseas?\b/, /\bganas de vomitar\b/],
  },
  {
    nombre: 'tos',
    patrones: [/\btos\b/, /\btosiendo\b/, /\btose\b/],
  },
  {
    nombre: 'silbidos en el pecho',
    patrones: [/\bsilbidos?\b/, /\bsibilancias?\b/, /\bchiflidos?\b/, /\bpito en el pecho\b/],
  },
];

const SEVERIDADES = [
  { valor: 1, patron: /\b(?:leve|leves|ligero|ligera|apenas|poquito|poquita|un poco)\b/ },
  { valor: 2, patron: /\b(?:moderado|moderada|regular)\b/ },
  {
    valor: 3,
    patron:
      /\b(?:mucho|mucha|fuerte|fuertes|intenso|intensa|insoportable|grave|severo|severa|terrible)\b/,
  },
];

/** La intensidad se busca en la misma cláusula del síntoma, no en todo el mensaje. */
function severidadDe(clausula) {
  for (const { valor, patron } of SEVERIDADES) {
    if (patron.test(clausula)) return valor;
  }
  return null;
}

function sintomasDe(texto) {
  const clausulas = texto.split(/[,.;!?\n]|\by\b|\bpero\b/);
  const encontrados = [];

  for (const clausula of clausulas) {
    for (const sintoma of SINTOMAS) {
      if (encontrados.some((previo) => previo.descripcion === sintoma.nombre)) continue;
      if (!sintoma.patrones.some((patron) => patron.test(clausula))) continue;

      encontrados.push({
        descripcion: sintoma.nombre,
        severidad: severidadDe(clausula),
      });
    }
  }

  return encontrados;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Extractor basado en expresiones regulares, sin red ni costo.
 *
 * @param {string} texto Mensaje en español (ya anonimizado).
 * @returns {{medicacion: Array<object>, mediciones: Array<object>, sintomas: Array<object>}}
 */
export function extraerMock(texto) {
  const normalizado = normalizar(texto);
  if (!normalizado) {
    return { medicacion: [], mediciones: [], sintomas: [] };
  }

  return {
    medicacion: medicacionDe(normalizado),
    mediciones: medicionesDe(normalizado),
    sintomas: sintomasDe(normalizado),
  };
}

/**
 * Extracción real con la Claude API (DK-201). Todavía no implementada.
 *
 * @param {string} texto Mensaje ya anonimizado (sin nombres, teléfonos ni IDs).
 * @returns {Promise<{
 *   medicacion: Array<{ tomada: boolean, nombre: string|null }>,
 *   mediciones: Array<{ tipo: 'glucosa'|'presion'|'peso', valor: number, valor2?: number, unidad: string }>,
 *   sintomas: Array<{ descripcion: string, severidad: 1|2|3|null }>
 * }>}
 * @throws {Error} Siempre, mientras no exista el cliente de Claude.
 */
export async function extraerConClaude(texto) {
  void texto;
  throw new Error('No implementado: extraerConClaude (DK-201).');
}

/**
 * Punto de entrada del extractor. Elige la implementación según el entorno.
 *
 * @param {string} texto Mensaje ya anonimizado.
 */
export async function extraer(texto) {
  if (usarIAMock()) return extraerMock(texto);
  return extraerConClaude(texto);
}
