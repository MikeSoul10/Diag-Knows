/**
 * Cliente de la API de Claude (DK-201).
 *
 * Un solo cliente para toda la app, creado la primera vez que se usa (así las
 * pruebas y el modo mock nunca necesitan llave). El modelo sale de
 * `ANTHROPIC_MODEL`; `max_tokens`, timeout y reintentos van acotados aquí.
 *
 * La salida se pide con structured outputs + Zod: la API restringe la respuesta
 * al esquema y aquí se valida otra vez con Zod. Si aun así no cumple, se reintenta
 * UNA vez con un mensaje de corrección; si vuelve a fallar, se lanza `ErrorIA`
 * y `conversacion.js` le pide al paciente que lo intente de nuevo.
 *
 * Privacidad:
 * - Recibe texto YA anonimizado (lo hace `conversacion.js`).
 * - No registra nada en logs: ni el texto, ni la respuesta, ni valores.
 * - Los errores que lanza no incluyen el texto del paciente.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
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

/**
 * Esquema que el modelo debe cumplir. Es la forma "para el modelo"; el
 * extractor la traduce al contrato interno (severidad 1/2/3, unidad, etc.).
 * Todo campo es obligatorio (null cuando no aplica) para que structured
 * outputs lo pueda exigir.
 */
/** Hora local "YYYY-MM-DDTHH:mm" en que ocurrió, o null si el paciente no lo dijo. */
const CUANDO = z.string().nullable();

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
    // Toma ANTHROPIC_API_KEY del entorno; nunca se escribe en el código.
    clienteCompartido = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: REINTENTOS_RED });
  }
  return clienteCompartido;
}

function modelo() {
  const nombre = (process.env.ANTHROPIC_MODEL || '').trim();
  if (!nombre) {
    throw new ErrorIA('configuracion', 'Falta ANTHROPIC_MODEL en el entorno.');
  }
  return nombre;
}

/** Traduce errores del SDK a `ErrorIA`, del más específico al más general. */
function traducirError(error) {
  if (error instanceof ErrorIA) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ErrorIA('timeout', 'Claude no respondió a tiempo.', { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ErrorIA('red', 'No hubo conexión con la API de Claude.', { cause: error });
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new ErrorIA('configuracion', 'ANTHROPIC_API_KEY inválida.', { cause: error });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ErrorIA('limite', 'Se alcanzó el límite de uso de la API de Claude.', {
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError) {
    return new ErrorIA('api', `La API de Claude respondió con error ${error.status ?? ''}.`, {
      cause: error,
    });
  }
  return error;
}

/**
 * Contenido del turno del usuario. La fecha y el contexto van aquí y no en el
 * prompt de sistema, para que este último sea fijo (cacheable).
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

function textoDeRespuesta(respuesta) {
  return (respuesta.content ?? [])
    .filter((bloque) => bloque.type === 'text')
    .map((bloque) => bloque.text)
    .join('');
}

/**
 * Valida el JSON aquí y no con `messages.parse()`: los errores de parseo del
 * SDK incluyen fragmentos de la respuesta (datos clínicos) en su mensaje, y
 * esos mensajes podrían terminar en un log.
 */
function leerJson(texto) {
  try {
    return EsquemaExtraccion.safeParse(JSON.parse(texto));
  } catch {
    return { success: false };
  }
}

/** Solo el esquema JSON; el SDK lo adapta a lo que acepta structured outputs. */
const { type: TIPO_FORMATO, schema: ESQUEMA_JSON } = zodOutputFormat(EsquemaExtraccion);

/**
 * Pide a Claude los datos del mensaje.
 *
 * @param {string} texto Mensaje del paciente, ya anonimizado.
 * @param {object} [opciones]
 * @param {{ messages: { create: Function } }} [opciones.cliente] Solo en pruebas.
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
    max_tokens: MAX_TOKENS_EXTRACCION,
    system: PROMPT_EXTRACCION,
    output_config: {
      effort: ESFUERZO,
      format: { type: TIPO_FORMATO, schema: ESQUEMA_JSON },
    },
  };

  const mensajes = [
    {
      role: 'user',
      content: contenidoUsuario(String(texto ?? ''), { ahoraLocal, zonaHoraria, contexto }),
    },
  ];

  for (let intento = 1; intento <= 2; intento += 1) {
    let respuesta;
    try {
      respuesta = await api.messages.create({ ...peticionBase, messages: mensajes });
    } catch (error) {
      throw traducirError(error);
    }

    // Un rechazo por políticas no mejora reintentando con el mismo texto.
    if (respuesta.stop_reason === 'refusal') {
      throw new ErrorIA('rechazo', 'Claude declinó procesar el mensaje.');
    }

    const anterior = textoDeRespuesta(respuesta);
    const resultado = leerJson(anterior);
    if (respuesta.stop_reason !== 'max_tokens' && resultado.success) {
      return resultado.data;
    }

    // Segundo intento: se le muestra su respuesta inválida y se le pide corregirla.
    if (anterior) {
      mensajes.push({ role: 'assistant', content: anterior });
      mensajes.push({ role: 'user', content: MENSAJE_CORRECCION });
    }
  }

  throw new ErrorIA('formato', 'La respuesta de Claude no cumplió el esquema tras reintentar.');
}
