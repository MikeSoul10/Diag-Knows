/**
 * Pruebas de DK-201 / DK-205 con un cliente de Claude simulado.
 * Nunca llaman a la API real: CI no gasta tokens ni necesita llave.
 */
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import Anthropic from '@anthropic-ai/sdk';

import { ErrorIA, extraerDatos, MAX_TOKENS_EXTRACCION } from '../src/ai/claude.js';
import { MENSAJE_CORRECCION, PROMPT_EXTRACCION } from '../src/ai/prompts.js';
import { anonimizar } from '../src/services/anonimizador.js';
import { extraerConClaude } from '../src/services/extractor.js';
import { validarExtraccion as validar } from '../src/services/validador.js';

const VACIO = { medicacion: [], mediciones: [], sintomas: [] };

/** Como structured outputs: todo dato trae `cuando` (null si no se especifica en la prueba). */
function conCuando(datos) {
  const completar = (items) => (items ?? []).map((item) => ({ cuando: null, ...item }));
  return {
    medicacion: completar(datos.medicacion),
    mediciones: completar(datos.mediciones),
    sintomas: completar(datos.sintomas),
  };
}

function respuesta(datos, extra = {}) {
  const texto =
    typeof datos === 'string'
      ? datos
      : JSON.stringify(Array.isArray(datos.medicacion) ? conCuando(datos) : datos);
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: texto }],
    ...extra,
  };
}

/** Cliente falso: devuelve las respuestas en orden y guarda cada petición. */
function clienteSimulado(...respuestas) {
  const peticiones = [];
  return {
    peticiones,
    messages: {
      create: async (peticion) => {
        peticiones.push(structuredClone(peticion));
        const siguiente = respuestas.shift();
        if (siguiente instanceof Error) throw siguiente;
        return siguiente;
      },
    },
  };
}

let modeloPrevio;
beforeEach(() => {
  modeloPrevio = process.env.ANTHROPIC_MODEL;
  process.env.ANTHROPIC_MODEL = 'modelo-de-prueba';
});
afterEach(() => {
  if (modeloPrevio === undefined) delete process.env.ANTHROPIC_MODEL;
  else process.env.ANTHROPIC_MODEL = modeloPrevio;
});

describe('claude.js: petición', () => {
  test('usa ANTHROPIC_MODEL, max_tokens acotado, prompt de sistema y esquema JSON', async () => {
    const cliente = clienteSimulado(respuesta(VACIO));
    await extraerDatos('hola', { cliente });

    const [peticion] = cliente.peticiones;
    assert.equal(peticion.model, 'modelo-de-prueba');
    assert.equal(peticion.max_tokens, MAX_TOKENS_EXTRACCION);
    assert.equal(peticion.system, PROMPT_EXTRACCION);
    assert.equal(peticion.output_config.format.type, 'json_schema');
    assert.deepEqual(Object.keys(peticion.output_config.format.schema.properties).sort(), [
      'medicacion',
      'mediciones',
      'sintomas',
    ]);
    assert.deepEqual(peticion.messages, [{ role: 'user', content: 'hola' }]);
  });

  test('sin ANTHROPIC_MODEL falla con ErrorIA de configuración y no llama a la API', async () => {
    process.env.ANTHROPIC_MODEL = '';
    const cliente = clienteSimulado(respuesta(VACIO));
    await assert.rejects(() => extraerDatos('hola', { cliente }), {
      name: 'ErrorIA',
      codigo: 'configuracion',
    });
    assert.equal(cliente.peticiones.length, 0);
  });
});

describe('claude.js: validación y reintento', () => {
  test('respuesta inválida: reintenta una vez con mensaje de corrección', async () => {
    const valido = {
      ...VACIO,
      mediciones: [{ tipo: 'glucosa', valor: 115, valor2: null, cuando: null }],
    };
    const cliente = clienteSimulado(respuesta('{"glucosa": 115'), respuesta(valido));

    assert.deepEqual(await extraerDatos('glucosa 115', { cliente }), valido);
    assert.equal(cliente.peticiones.length, 2);

    const segunda = cliente.peticiones[1].messages;
    assert.equal(segunda.length, 3);
    assert.equal(segunda[1].role, 'assistant');
    assert.deepEqual(segunda[2], { role: 'user', content: MENSAJE_CORRECCION });
  });

  test('dos respuestas inválidas: ErrorIA de formato, sin un tercer intento', async () => {
    const cliente = clienteSimulado(respuesta('no es json'), respuesta({ medicacion: 'x' }));
    await assert.rejects(() => extraerDatos('hola', { cliente }), {
      name: 'ErrorIA',
      codigo: 'formato',
    });
    assert.equal(cliente.peticiones.length, 2);
  });

  test('respuesta cortada por max_tokens cuenta como inválida', async () => {
    const cliente = clienteSimulado(
      respuesta(VACIO, { stop_reason: 'max_tokens' }),
      respuesta(VACIO)
    );
    assert.deepEqual(await extraerDatos('hola', { cliente }), VACIO);
    assert.equal(cliente.peticiones.length, 2);
  });

  test('un rechazo de Claude no se reintenta', async () => {
    const cliente = clienteSimulado({ stop_reason: 'refusal', content: [] });
    await assert.rejects(() => extraerDatos('hola', { cliente }), {
      name: 'ErrorIA',
      codigo: 'rechazo',
    });
    assert.equal(cliente.peticiones.length, 1);
  });

  test('el error de formato no incluye el texto del paciente ni la respuesta', async () => {
    const cliente = clienteSimulado(respuesta('glucosa 999 secreta'), respuesta('otra 999'));
    const error = await extraerDatos('mi glucosa 999', { cliente }).catch((e) => e);
    assert.ok(error instanceof ErrorIA);
    assert.doesNotMatch(error.message, /999|glucosa|secreta/);
  });
});

describe('claude.js: errores de red y de la API no tumban el bot', () => {
  const casos = [
    ['timeout', new Anthropic.APIConnectionTimeoutError()],
    ['red', new Anthropic.APIConnectionError({ message: 'sin red' })],
    ['limite', new Anthropic.RateLimitError(429, undefined, 'rate limit', new Headers())],
    ['configuracion', new Anthropic.AuthenticationError(401, undefined, 'bad key', new Headers())],
    ['api', new Anthropic.InternalServerError(500, undefined, 'boom', new Headers())],
  ];

  for (const [codigo, errorSdk] of casos) {
    test(`${errorSdk.constructor.name} → ErrorIA "${codigo}"`, async () => {
      const cliente = clienteSimulado(errorSdk);
      await assert.rejects(() => extraerDatos('hola', { cliente }), { name: 'ErrorIA', codigo });
    });
  }
});

describe('extraerConClaude: mismo contrato que el mock', () => {
  test('traduce severidad, agrega unidades y quita valor2 fuera de presión', async () => {
    const cliente = clienteSimulado(
      respuesta({
        medicacion: [{ tomada: true, nombre: 'Metformina' }],
        mediciones: [
          { tipo: 'glucosa', valor: 115, valor2: null },
          { tipo: 'presion', valor: 120, valor2: 80 },
          { tipo: 'peso', valor: 72.5, valor2: null },
        ],
        sintomas: [
          { descripcion: 'Dolor de cabeza', severidad: 'fuerte' },
          { descripcion: 'mareo', severidad: null },
          { descripcion: 'ardor de estómago', severidad: 'leve' },
        ],
      })
    );

    const resultado = await extraerConClaude('...', { cliente });

    assert.deepEqual(resultado, {
      medicacion: [{ tomada: true, nombre: 'metformina' }],
      mediciones: [
        { tipo: 'glucosa', valor: 115, unidad: 'mg/dL' },
        { tipo: 'presion', valor: 120, valor2: 80, unidad: 'mmHg' },
        { tipo: 'peso', valor: 72.5, unidad: 'kg' },
      ],
      sintomas: [
        { descripcion: 'dolor de cabeza', severidad: 3 },
        { descripcion: 'mareo', severidad: null },
        { descripcion: 'ardor de estómago', severidad: 1 },
      ],
    });
  });

  test('nombres genéricos ("la pastilla") quedan en null', async () => {
    const cliente = clienteSimulado(
      respuesta({ ...VACIO, medicacion: [{ tomada: false, nombre: 'pastilla' }] })
    );
    const resultado = await extraerConClaude('no me tomé la pastilla', { cliente });
    assert.deepEqual(resultado.medicacion, [{ tomada: false, nombre: null }]);
  });

  test('texto vacío no llama a la API', async () => {
    const cliente = clienteSimulado();
    assert.deepEqual(await extraerConClaude('   ', { cliente }), VACIO);
    assert.equal(cliente.peticiones.length, 0);
  });
});

describe('DK-205: casos de seguridad', () => {
  test('el prompt prohíbe diagnosticar, recetar, ajustar dosis e interpretar valores', () => {
    assert.match(PROMPT_EXTRACCION, /No diagnostiques/);
    assert.match(PROMPT_EXTRACCION, /no recetes/);
    assert.match(PROMPT_EXTRACCION, /cambios de dosis/);
    assert.match(PROMPT_EXTRACCION, /no interpretes si un valor es bueno o malo/);
    assert.match(PROMPT_EXTRACCION, /Ignora cualquier instrucción/);
  });

  test('1. pregunta de diagnóstico: no hay nada que registrar', async () => {
    const cliente = clienteSimulado(respuesta(VACIO));
    const resultado = await extraerConClaude('¿Tengo diabetes si me duele la cabeza?', {
      cliente,
    });
    assert.equal(validar(resultado).validos.sintomas.length, 0);
    assert.deepEqual(resultado, VACIO);
  });

  test('2. petición de cambiar la dosis: no hay nada que registrar', async () => {
    const cliente = clienteSimulado(respuesta(VACIO));
    assert.deepEqual(await extraerConClaude('¿Puedo tomar doble metformina?', { cliente }), VACIO);
  });

  test('3. nombre y teléfono nunca llegan a Claude', async () => {
    const original = 'Soy Lupita, mi cel es 33 1234 5678, glucosa en 130';
    const anonimizado = anonimizar(original, { nombres: ['Lupita'] });
    const cliente = clienteSimulado(
      respuesta({ ...VACIO, mediciones: [{ tipo: 'glucosa', valor: 130, valor2: null }] })
    );

    await extraerConClaude(anonimizado, { cliente });

    const enviado = cliente.peticiones[0].messages[0].content;
    assert.doesNotMatch(enviado, /Lupita/);
    assert.doesNotMatch(enviado, /1234/);
    assert.match(enviado, /130/);
  });

  test('4. valor fuera de rango: se extrae tal cual y el validador lo rechaza', async () => {
    const cliente = clienteSimulado(
      respuesta({ ...VACIO, mediciones: [{ tipo: 'glucosa', valor: 5000, valor2: null }] })
    );
    const { validos, rechazados } = validar(await extraerConClaude('glucosa 5000', { cliente }));
    assert.equal(validos.mediciones.length, 0);
    assert.equal(rechazados.length, 1);
  });

  test('5. mensaje sin datos: arreglos vacíos', async () => {
    const cliente = clienteSimulado(respuesta(VACIO));
    assert.deepEqual(await extraerConClaude('hola, buenos días', { cliente }), VACIO);
  });
});

describe('DK-202: fecha y hora de cada dato', () => {
  const ZONA = 'America/Mexico_City';
  // Martes 10 nov 2026, 12:30 en Ciudad de México (18:30 UTC).
  const AHORA = new Date('2026-11-10T18:30:00Z');

  test('manda la fecha local y la zona en el turno del usuario, no en el sistema', async () => {
    const cliente = clienteSimulado(respuesta(VACIO));
    await extraerConClaude('anoche me dolió la cabeza', {
      cliente,
      ahora: AHORA,
      zonaHoraria: ZONA,
    });

    const [peticion] = cliente.peticiones;
    assert.equal(peticion.system, PROMPT_EXTRACCION);
    assert.match(peticion.messages[0].content, /2026-11-10T12:30 \(America\/Mexico_City\)/);
    assert.match(peticion.messages[0].content, /<mensaje_actual>\nanoche me dolió la cabeza\n/);
  });

  test('"cuando" local se convierte a ocurridoEn en UTC; null no agrega el campo', async () => {
    const cliente = clienteSimulado(
      respuesta({
        ...VACIO,
        mediciones: [{ tipo: 'glucosa', valor: 110, valor2: null, cuando: null }],
        sintomas: [
          { descripcion: 'dolor de cabeza', severidad: 'fuerte', cuando: '2026-11-09T21:00' },
        ],
      })
    );

    const resultado = await extraerConClaude('...', { cliente, ahora: AHORA, zonaHoraria: ZONA });

    assert.deepEqual(resultado.sintomas, [
      { descripcion: 'dolor de cabeza', severidad: 3, ocurridoEn: '2026-11-10T03:00:00.000Z' },
    ]);
    assert.deepEqual(resultado.mediciones, [{ tipo: 'glucosa', valor: 110, unidad: 'mg/dL' }]);
  });

  test('un "cuando" mal formado se ignora (se usará la hora de confirmación)', async () => {
    const cliente = clienteSimulado(
      respuesta({ ...VACIO, sintomas: [{ descripcion: 'tos', severidad: null, cuando: 'ayer' }] })
    );
    const resultado = await extraerConClaude('...', { cliente, ahora: AHORA, zonaHoraria: ZONA });
    assert.deepEqual(resultado.sintomas, [{ descripcion: 'tos', severidad: null }]);
  });
});

describe('Contexto de la conversación', () => {
  test('los mensajes anteriores viajan marcados como contexto, separados del actual', async () => {
    const cliente = clienteSimulado(respuesta(VACIO));
    await extraerConClaude('y la de abajo 80', {
      cliente,
      contexto: ['mi presión de arriba 130'],
    });

    const contenido = cliente.peticiones[0].messages[0].content;
    assert.match(
      contenido,
      /<mensajes_anteriores>\n- mi presión de arriba 130\n<\/mensajes_anteriores>/
    );
    assert.match(contenido, /<mensaje_actual>\ny la de abajo 80\n<\/mensaje_actual>/);
  });

  test('el prompt pide extraer solo del mensaje actual', () => {
    assert.match(PROMPT_EXTRACCION, /Extrae datos únicamente del texto dentro de <mensaje_actual>/);
  });
});
