/**
 * Validación de plausibilidad del resultado del extractor.
 *
 * OJO: estos NO son umbrales clínicos. Solo descartan valores imposibles de
 * creer (una glucosa de 9000, una presión de 12/3). Los umbrales que disparan
 * alertas viven en `config/thresholds.js`, siguen en `null` y son del Sprint 4.
 *
 * Cuando un dato se rechaza: no se guarda, se le dice al paciente qué pasó y se
 * le pide corregirlo. Nunca se completa ni se ajusta por nuestra cuenta.
 */

export const RANGOS = Object.freeze({
  glucosa: { minimo: 20, maximo: 600, unidad: 'mg/dL' },
  presion: {
    sistolica: { minimo: 50, maximo: 260 },
    diastolica: { minimo: 30, maximo: 160 },
    unidad: 'mmHg',
  },
  peso: { minimo: 20, maximo: 400, unidad: 'kg' },
  severidad: { minimo: 1, maximo: 3 },
});

export const SEVERIDADES_VALIDAS = Object.freeze([1, 2, 3]);

function comoArreglo(valor) {
  return Array.isArray(valor) ? valor : [];
}

function aNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;

  const limpio = valor.replace(',', '.').trim();
  if (!/^\d+(?:\.\d+)?$/.test(limpio)) return null;

  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : null;
}

function fueraDeRango(valor, { minimo, maximo }) {
  return valor < minimo || valor > maximo;
}

function textoDe(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

// ---------------------------------------------------------------------------
// Validadores por tipo
// ---------------------------------------------------------------------------

function validarMedicacion(items, validos, rechazados) {
  for (const item of items) {
    if (!item || typeof item.tomada !== 'boolean') {
      rechazados.push({
        item,
        motivo: 'No entendí si tomaste el medicamento. Dime "me la tomé" o "no me la tomé".',
      });
      continue;
    }

    const nombre = textoDe(item.nombre);
    validos.medicacion.push({ tomada: item.tomada, nombre: nombre || null });
  }
}

function validarMediciones(items, validos, rechazados) {
  for (const item of items) {
    const tipo = textoDe(item?.tipo).toLowerCase();
    const rango = RANGOS[tipo];

    if (!rango) {
      rechazados.push({
        item,
        motivo: 'No reconocí qué medición era. Escribe glucosa, presión o peso.',
      });
      continue;
    }

    const valor = aNumero(item?.valor);
    if (valor === null) {
      rechazados.push({ item, motivo: 'La medición no traía un número que pudiera leer.' });
      continue;
    }

    if (tipo === 'presion') {
      const diastolica = aNumero(item?.valor2);

      if (diastolica === null) {
        rechazados.push({
          item,
          motivo: 'Me falta la presión de abajo. Escríbela completa, por ejemplo 120/80.',
        });
        continue;
      }

      if (fueraDeRango(valor, rango.sistolica)) {
        rechazados.push({
          item,
          motivo: `La presión de arriba (${valor}) está fuera del rango que puedo registrar (${rango.sistolica.minimo} a ${rango.sistolica.maximo} ${rango.unidad}).`,
        });
        continue;
      }

      if (fueraDeRango(diastolica, rango.diastolica)) {
        rechazados.push({
          item,
          motivo: `La presión de abajo (${diastolica}) está fuera del rango que puedo registrar (${rango.diastolica.minimo} a ${rango.diastolica.maximo} ${rango.unidad}).`,
        });
        continue;
      }

      if (valor <= diastolica) {
        rechazados.push({
          item,
          motivo: 'La presión de arriba debe ser mayor que la de abajo. Escríbela como 120/80.',
        });
        continue;
      }

      validos.mediciones.push({ tipo, valor, valor2: diastolica, unidad: rango.unidad });
      continue;
    }

    if (fueraDeRango(valor, rango)) {
      rechazados.push({
        item,
        motivo: `El valor ${valor} está fuera del rango que puedo registrar para ${tipo} (${rango.minimo} a ${rango.maximo} ${rango.unidad}).`,
      });
      continue;
    }

    validos.mediciones.push({ tipo, valor, unidad: rango.unidad });
  }
}

function validarSintomas(items, validos, rechazados) {
  for (const item of items) {
    const descripcion = textoDe(item?.descripcion);

    if (!descripcion) {
      rechazados.push({ item, motivo: 'No entendí qué síntoma me querías contar.' });
      continue;
    }

    const severidad = item?.severidad;

    // Sin intensidad no se rechaza: la conversación la pregunta con botones.
    if (severidad === null || severidad === undefined) {
      validos.sintomas.push({ descripcion, severidad: null });
      continue;
    }

    if (!SEVERIDADES_VALIDAS.includes(severidad)) {
      rechazados.push({
        item,
        motivo: `La intensidad de "${descripcion}" debe ser 1, 2 o 3.`,
      });
      continue;
    }

    validos.sintomas.push({ descripcion, severidad });
  }
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Separa lo que se puede guardar de lo que hay que corregir.
 *
 * @param {object} extraccion Resultado de `extractor.js`.
 * @returns {{
 *   validos: { medicacion: Array<object>, mediciones: Array<object>, sintomas: Array<object> },
 *   rechazados: Array<{ item: object, motivo: string }>
 * }}
 */
export function validarExtraccion(extraccion) {
  const entrada = extraccion ?? {};

  const validos = { medicacion: [], mediciones: [], sintomas: [] };
  const rechazados = [];

  validarMedicacion(comoArreglo(entrada.medicacion), validos, rechazados);
  validarMediciones(comoArreglo(entrada.mediciones), validos, rechazados);
  validarSintomas(comoArreglo(entrada.sintomas), validos, rechazados);

  return { validos, rechazados };
}
