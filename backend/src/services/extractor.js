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
 * Cualquier dato puede traer además `ocurridoEn` (ISO UTC) cuando el paciente
 * dice cuándo pasó ("ayer en la noche"). Si no lo dice, el campo no aparece y
 * se guarda con la hora en que confirma (DK-202).
 *
 * Este módulo NO valida rangos (eso es `validador.js`) ni anonimiza (el texto
 * llega ya anonimizado desde `conversacion.js`).
 */

import { extraerDatos } from '../ai/claude.js';
import { usarIAMock } from '../config/env.js';
import { formatoLocal, localAUtc, localTextoAIsoUtc, partesEnZona } from './fechas.js';

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
export function extraerMock(texto, { ahora, zonaHoraria } = {}) {
  const normalizado = normalizar(texto);
  if (!normalizado) {
    return { medicacion: [], mediciones: [], sintomas: [] };
  }

  const resultado = {
    medicacion: medicacionDe(normalizado),
    mediciones: medicionesDe(normalizado),
    sintomas: sintomasDe(normalizado),
  };

  // El mock aplica el mismo momento a todo el mensaje; Claude lo distingue por dato.
  const ocurridoEn = ahora && zonaHoraria ? momentoDe(normalizado, ahora, zonaHoraria) : null;
  return ocurridoEn ? conMomento(resultado, () => ocurridoEn) : resultado;
}

// ---------------------------------------------------------------------------
// Momento ("ayer en la noche", "a las 8") — DK-202
// ---------------------------------------------------------------------------

const DIAS_ATRAS = [
  { dias: 2, patron: /\b(?:antier|anteayer)\b/ },
  { dias: 1, patron: /\b(?:ayer|anoche)\b/ },
];

const PARTES_DEL_DIA = [
  { hora: 21, patron: /\b(?:anoche|(?:en|por|de) la noche|esta noche)\b/ },
  { hora: 16, patron: /\b(?:(?:en|por|de) la tarde|esta tarde)\b/ },
  { hora: 13, patron: /\b(?:al )?mediodia\b/ },
  { hora: 9, patron: /\b(?:(?:en|por|de) la manana|esta manana|temprano)\b/ },
  { hora: 3, patron: /\b(?:en|por|de) la madrugada\b/ },
];

const HORA_EXPLICITA =
  /\ba las? (\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|de la manana|de la tarde|de la noche)?/;

/** Hora usada cuando dice el día ("ayer") pero no la hora. */
const HORA_POR_DEFECTO = 12;

function horaExplicita(texto) {
  const coincidencia = HORA_EXPLICITA.exec(texto);
  if (!coincidencia) return null;

  let hora = Number(coincidencia[1]);
  const minuto = Number(coincidencia[2] ?? 0);
  const sufijo = coincidencia[3] ?? '';
  if (hora > 23 || minuto > 59) return null;

  if (/^(?:pm|p\.m\.|de la tarde|de la noche)$/.test(sufijo) && hora < 12) hora += 12;
  if (/^(?:am|a\.m\.|de la manana)$/.test(sufijo) && hora === 12) hora = 0;
  return { hora, minuto };
}

/**
 * Instante (ISO UTC) que el mensaje describe, o `null` si no dice cuándo
 * (entonces se usa la hora en que el paciente confirma).
 */
function momentoDe(texto, ahora, zona) {
  const dias = DIAS_ATRAS.find(({ patron }) => patron.test(texto))?.dias ?? 0;
  const parte = PARTES_DEL_DIA.find(({ patron }) => patron.test(texto))?.hora ?? null;
  const explicita = horaExplicita(texto);

  if (dias === 0 && parte === null && !explicita) return null;

  const hoy = partesEnZona(ahora, zona);
  return localAUtc(
    {
      anio: hoy.anio,
      mes: hoy.mes,
      dia: hoy.dia - dias,
      hora: explicita?.hora ?? parte ?? (dias > 0 ? HORA_POR_DEFECTO : hoy.hora),
      minuto: explicita?.minuto ?? (parte === null && dias === 0 ? hoy.minuto : 0),
    },
    zona
  ).toISOString();
}

/** Agrega `ocurridoEn` a cada dato (solo si hay uno; si no, el campo no aparece). */
function conMomento(resultado, momentoDeItem) {
  const agregar = (item) => {
    const ocurridoEn = momentoDeItem(item);
    return ocurridoEn ? { ...item, ocurridoEn } : item;
  };
  return {
    medicacion: resultado.medicacion.map(agregar),
    mediciones: resultado.mediciones.map(agregar),
    sintomas: resultado.sintomas.map(agregar),
  };
}

const SEVERIDAD_DE_CLAUDE = Object.freeze({ leve: 1, moderada: 2, fuerte: 3 });

/** Nombre del medicamento como lo da el mock: minúsculas, sin acentos ni genéricos. */
function nombreDeClaude(nombre) {
  const limpio = normalizar(nombre);
  if (!limpio || GENERICAS.has(limpio)) return null;
  return limpio;
}

/**
 * Traduce la respuesta de Claude al contrato del extractor. Las unidades las
 * pone el código (no el modelo) y `valor2` solo existe en presión, igual que
 * en el mock. Los rangos los revisa `validador.js` después.
 */
function aContrato(datos, zonaHoraria) {
  const contrato = {
    medicacion: datos.medicacion.map(({ tomada, nombre, cuando }) => ({
      tomada,
      nombre: nombreDeClaude(nombre),
      cuando,
    })),
    mediciones: datos.mediciones.map(({ tipo, valor, valor2, cuando }) =>
      tipo === 'presion'
        ? { tipo, valor, valor2, unidad: UNIDADES[tipo], cuando }
        : { tipo, valor, unidad: UNIDADES[tipo], cuando }
    ),
    sintomas: datos.sintomas
      .map(({ descripcion, severidad, cuando }) => ({
        // Conserva acentos: un síntoma fuera de la lista se muestra tal cual al paciente.
        descripcion: String(descripcion).toLowerCase().replace(/\s+/g, ' ').trim(),
        severidad: severidad === null ? null : SEVERIDAD_DE_CLAUDE[severidad],
        cuando,
      }))
      .filter(({ descripcion }) => descripcion),
  };

  // "cuando" llega en hora local del paciente; el contrato usa ISO UTC.
  const momento = ({ cuando }) =>
    zonaHoraria && cuando ? localTextoAIsoUtc(cuando, zonaHoraria) : null;
  const conFecha = conMomento(contrato, momento);
  const sinCuando = ({ cuando, ...resto }) => {
    void cuando;
    return resto;
  };
  return {
    medicacion: conFecha.medicacion.map(sinCuando),
    mediciones: conFecha.mediciones.map(sinCuando),
    sintomas: conFecha.sintomas.map(sinCuando),
  };
}

/**
 * Extracción real con la Claude API (DK-201).
 *
 * @param {string} texto Mensaje ya anonimizado (sin nombres, teléfonos ni IDs).
 * @param {OpcionesExtraccion & { cliente?: object }} [opciones] `cliente` solo en pruebas.
 * @returns {Promise<Extraccion>}
 * @throws {import('../ai/claude.js').ErrorIA} Si Claude falla, declina o no cumple el esquema.
 */
export async function extraerConClaude(texto, opciones = {}) {
  if (!normalizar(texto)) {
    return { medicacion: [], mediciones: [], sintomas: [] };
  }
  const { ahora, zonaHoraria, contexto, cliente } = opciones;
  const ahoraLocal = ahora && zonaHoraria ? formatoLocal(ahora, zonaHoraria) : null;
  const datos = await extraerDatos(texto, { cliente, ahoraLocal, zonaHoraria, contexto });
  return aContrato(datos, zonaHoraria);
}

/**
 * @typedef {object} OpcionesExtraccion
 * @property {Date} [ahora] Momento del mensaje (para "ayer", "en la noche").
 * @property {string} [zonaHoraria] Zona IANA del paciente.
 * @property {string[]} [contexto] Mensajes anteriores ya anonimizados (solo Claude los usa).
 */

/**
 * @typedef {{
 *   medicacion: Array<{ tomada: boolean, nombre: string|null, ocurridoEn?: string }>,
 *   mediciones: Array<{ tipo: 'glucosa'|'presion'|'peso', valor: number, valor2?: number, unidad: string, ocurridoEn?: string }>,
 *   sintomas: Array<{ descripcion: string, severidad: 1|2|3|null, ocurridoEn?: string }>
 * }} Extraccion
 */

/**
 * Punto de entrada del extractor. Elige la implementación según el entorno.
 *
 * @param {string} texto Mensaje ya anonimizado.
 * @param {OpcionesExtraccion} [opciones]
 * @returns {Promise<Extraccion>}
 */
export async function extraer(texto, opciones = {}) {
  if (usarIAMock()) return extraerMock(texto, opciones);
  return extraerConClaude(texto, opciones);
}
