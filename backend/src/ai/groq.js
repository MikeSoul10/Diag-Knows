/**
 * Cliente de la API de Groq (DK-201; reemplaza al cliente de Claude, ver D17).
 *
 * Un solo cliente para toda la app, creado la primera vez que se usa (así las
 * pruebas y el modo mock nunca necesitan llave). El modelo sale de
 * `GROQ_MODEL`; `max_completion_tokens`, timeout y reintentos van acotados aquí.
 *
 * La salida se pide con Structured Outputs en modo estricto (`json_schema`,
 * `strict: true`): Groq restringe la respuesta al esquema y aquí se valida otra
 * vez con Zod. Si aun así no cumple (por ejemplo, la respuesta se cortó), se
 * reintenta UNA vez con un mensaje de corrección; si vuelve a fallar, se lanza
 * `ErrorIA` y `conversacion.js` le pide al paciente que lo intente de nuevo.
 *
 * Privacidad:
 * - Recibe texto YA anonimizado (lo hace `conversacion.js`).
 * - No registra nada en logs: ni el texto, ni la respuesta, ni valores.
 * - Los errores que lanza no incluyen el texto del paciente.
 * - Se pide `include_reasoning: false`: el razonamiento del modelo no viaja de
 *   regreso (no hace falta y podría repetir datos del paciente).
 */

import Groq, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from 'groq-sdk';
import { z } from 'zod';

import { MENSAJE_CORRECCION, PROMPT_EXTRACCION } from './prompts.js';

/** Incluye el razonamiento del modelo; la respuesta JSON en sí ocupa pocos cientos. */
export const MAX_TOKENS_EXTRACCION = 4000;

/** El paciente espera en Telegram: mejor fallar rápido que dejarlo colgado. */
export const TIMEOUT_MS = 20_000;

/** Reintentos del SDK ante 429, 5xx y fallos de conexión. */
const REINTENTOS_RED = 1;

/** Extraer datos es una tarea sencilla: poco razonamiento basta y responde más rápido. */
const ESFUERZO = 'low';

/** Hora local "YYYY-MM-DDTHH:mm" en que ocurrió, o null si el paciente no lo dijo. */
const CUANDO = z.string().nullable();

/**
 * Esquema que el modelo debe cumplir. Es la forma "para el modelo"; el
 * extractor la traduce al contrato interno (severidad 1/2/3, unidad, etc.).
 * Todo campo es obligatorio (null cuando no aplica): el modo estricto de Groq
 * no admite campos opcionales.
 */
export const EsquemaExtraccion = z.object({
  medicacion: z.array(
    z.object({
      tomada: z.boolean(),
      nombre: z.string().nullable(),
      cuando: CUANDO,
    })
  ),
  mediciones: z.array(
    z.object({
      tipo: z.enum(['glucosa', 'presion', 'peso']),
      valor: z.number(),
      valor2: z.number().nullable(),
      cuando: CUANDO,
    })
  ),
  sintomas: z.array(
    z.object({
      descripcion: z.string(),
      severidad: z.enum(['leve', 'moderada', 'fuerte']).nullable(),
      cuando: CUANDO,
    })
  ),
});

/**
 * JSON Schema para el modo estricto: sin `$schema` y con
 * `additionalProperties: false` en cada objeto, como lo exige Groq.
 */
function esquemaEstricto(nodo) {
  if (Array.isArray(nodo)) return nodo.map(esquemaEstricto);
  if (!nodo || typeof nodo !== 'object') return nodo;

  const salida = {};
  for (const [clave, valor] of Object.entries(nodo)) {
    if (clave === '$schema') continue;
    salida[clave] = esquemaEstricto(valor);
  }
  if (salida.type === 'object') salida.additionalProperties = false;
  return salida;
}

export const ESQUEMA_JSON = esquemaEstricto(z.toJSONSchema(EsquemaExtraccion));

/**
 * Error controlado de la capa de IA. `codigo` permite decidir qué hacer sin
 * revisar mensajes: configuracion | timeout | red | limite | api | rechazo | formato.
 */
export class ErrorIA extends Error {
  constructor(codigo, mensaje, opciones) {
    super(mensaje, opciones);
    this.name = 'ErrorIA';
    this.codigo = codigo;
  }
}

let clienteCompartido = null;

function clientePorDefecto() {
  if (!clienteCompartido) {
    // Toma GROQ_API_KEY del entorno; nunca se escribe en el código.
    clienteCompartido = new Groq({ timeout: TIMEOUT_MS, maxRetries: REINTENTOS_RED });
  }
  return clienteCompartido;
}

function modelo() {
  const nombre = (process.env.GROQ_MODEL || '').trim();
  if (!nombre) {
    throw new ErrorIA('configuracion', 'Falta GROQ_MODEL en el entorno.');
  }
  return nombre;
}

/** Traduce errores del SDK a `ErrorIA`, del más específico al más general. */
function traducirError(error) {
  if (error instanceof ErrorIA) return error;
  if (error instanceof APIConnectionTimeoutError) {
    return new ErrorIA('timeout', 'Groq no respondió a tiempo.', { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new ErrorIA('red', 'No hubo conexión con la API de Groq.', { cause: error });
  }
  if (error instanceof AuthenticationError) {
    return new ErrorIA('configuracion', 'GROQ_API_KEY inválida.', { cause: error });
  }
  if (error instanceof RateLimitError) {
    return new ErrorIA('limite', 'Se alcanzó el límite de uso de la API de Groq.', {
      cause: error,
    });
  }
  if (error instanceof APIError) {
    return new ErrorIA('api', `La API de Groq respondió con error ${error.status ?? ''}.`, {
      cause: error,
    });
  }
  return error;
}

/**
 * Contenido del turno del usuario. La fecha y el contexto van aquí y no en el
 * prompt de sistema, para que este último sea fijo.
 */
function contenidoUsuario(texto, { ahoraLocal, zonaHoraria, contexto } = {}) {
  const anteriores = (contexto ?? []).filter(Boolean);
  if (!ahoraLocal && anteriores.length === 0) return texto;

  const partes = [];
  if (ahoraLocal) {
    partes.push(`Fecha y hora actual del paciente: ${ahoraLocal} (${zonaHoraria}).`);
  }
  if (anteriores.length > 0) {
    const lista = anteriores.map((mensaje) => `- ${mensaje}`).join('\n');
    partes.push(`<mensajes_anteriores>\n${lista}\n</mensajes_anteriores>`);
  }
  partes.push(`<mensaje_actual>\n${texto}\n</mensaje_actual>`);
  return partes.join('\n\n');
}

/**
 * Valida el JSON aquí con `safeParse`: un error de parseo nunca lleva la
 * respuesta (datos clínicos) en su mensaje, así que no puede terminar en un log.
 */
function leerJson(texto) {
  try {
    return EsquemaExtraccion.safeParse(JSON.parse(texto));
  } catch {
    return { success: false };
  }
}

/**
 * Pide a Groq los datos del mensaje.
 *
 * @param {string} texto Mensaje del paciente, ya anonimizado.
 * @param {object} [opciones]
 * @param {{ chat: { completions: { create: Function } } }} [opciones.cliente] Solo en pruebas.
 * @param {string} [opciones.ahoraLocal] "YYYY-MM-DDTHH:mm" en la zona del paciente.
 * @param {string} [opciones.zonaHoraria] Zona IANA del paciente.
 * @param {string[]} [opciones.contexto] Mensajes anteriores, ya anonimizados.
 * @returns {Promise<z.infer<typeof EsquemaExtraccion>>}
 * @throws {ErrorIA}
 */
export async function extraerDatos(texto, { cliente, ahoraLocal, zonaHoraria, contexto } = {}) {
  // El modelo se revisa antes de crear el cliente: una configuración incompleta
  // falla de inmediato, sin intentar ninguna llamada de red.
  const nombreModelo = modelo();
  const api = cliente ?? clientePorDefecto();
  const peticionBase = {
    model: nombreModelo,
    max_completion_tokens: MAX_TOKENS_EXTRACCION,
    reasoning_effort: ESFUERZO,
    include_reasoning: false,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'extraccion', strict: true, schema: ESQUEMA_JSON },
    },
  };

  const mensajes = [
    { role: 'system', content: PROMPT_EXTRACCION },
    {
      role: 'user',
      content: contenidoUsuario(String(texto ?? ''), { ahoraLocal, zonaHoraria, contexto }),
    },
  ];

  for (let intento = 1; intento <= 2; intento += 1) {
    let respuesta;
    try {
      respuesta = await api.chat.completions.create({ ...peticionBase, messages: mensajes });
    } catch (error) {
      throw traducirError(error);
    }

    const eleccion = respuesta?.choices?.[0];
    const mensaje = eleccion?.message ?? {};

    // Un rechazo del modelo no mejora reintentando con el mismo texto.
    if (mensaje.refusal) {
      throw new ErrorIA('rechazo', 'El modelo declinó procesar el mensaje.');
    }

    const anterior = typeof mensaje.content === 'string' ? mensaje.content : '';
    const resultado = leerJson(anterior);
    if (eleccion?.finish_reason !== 'length' && resultado.success) {
      return resultado.data;
    }

    // Segundo intento: se le muestra su respuesta inválida y se le pide corregirla.
    if (anterior) {
      mensajes.push({ role: 'assistant', content: anterior });
      mensajes.push({ role: 'user', content: MENSAJE_CORRECCION });
    }
  }

  throw new ErrorIA('formato', 'La respuesta del modelo no cumplió el esquema tras reintentar.');
}
