/**
 * Traduce el resultado de `registration.service.js` a un mensaje de Telegram.
 *
 * Los servicios devuelven texto plano; aquí se decide si lleva teclado y si
 * usa HTML. Nada de datos del paciente se interpola en HTML.
 */

import {
  AVISO_PRIVACIDAD,
  EXTRA_HTML,
  MENSAJE_MENU,
  tecladoConfirmar,
  tecladoConsentimiento,
  tecladoConversacion,
  tecladoEnfermedades,
  tecladoMenu,
  tecladoOpcionesRapidas,
  tecladoRegistrar,
} from '../format.js';

/** Con el registro listo, el paciente ve el menú principal en la barra. */
const TIPOS_CON_MENU = new Set(['completado', 'ya_registrado']);

function tecladoPara(resultado) {
  if (resultado.tipo === 'resumen') return tecladoConfirmar();
  if (resultado.opciones?.length) return tecladoEnfermedades(resultado.opciones);
  if (TIPOS_CON_MENU.has(resultado.tipo)) return tecladoMenu();
  return null;
}

/**
 * Manda el menú principal a la barra. Se usa cuando el mensaje anterior no
 * pudo llevarlo (un mensaje editado o uno con botones en línea: Telegram solo
 * admite un teclado por mensaje).
 */
export async function mostrarMenu(ctx, texto = MENSAJE_MENU) {
  return ctx.reply(texto, tecladoMenu());
}

export async function responder(ctx, resultado) {
  if (!resultado) {
    return ctx.reply('No pude completar eso. Intenta de nuevo.');
  }

  if (resultado.tipo === 'requiere_consentimiento') {
    return ctx.reply(AVISO_PRIVACIDAD, { ...EXTRA_HTML, ...tecladoConsentimiento() });
  }

  const teclado = tecladoPara(resultado);
  const extra = teclado ? teclado : undefined;

  if (resultado.tipo === 'sin_sesion') {
    return ctx.reply(resultado.mensaje, tecladoRegistrar());
  }

  return ctx.reply(resultado.mensaje, extra);
}

/** Reenvía el aviso completo cuando alguien escribe sin haber aceptado. */
export async function recordarConsentimiento(ctx) {
  return ctx.reply(AVISO_PRIVACIDAD, { ...EXTRA_HTML, ...tecladoConsentimiento() });
}

// ---------------------------------------------------------------------------
// Conversación de seguimiento (servicio `services/conversacion.js`)
// ---------------------------------------------------------------------------

export const TEXTO_ERROR_CONVERSACION =
  'No pude completar eso en este momento. Intenta de nuevo en un momento.';

/** Telegram avisa con este texto si el mensaje a editar ya es idéntico. */
function esMensajeSinCambios(error) {
  const detalle = error?.description ?? error?.message ?? '';
  return /message is not modified/i.test(String(detalle));
}

/**
 * Pinta una respuesta del servicio de conversación.
 *
 * El servicio ya devuelve el texto en HTML de Telegram (escapa los datos del
 * paciente), así que aquí solo se decide teclado y si se edita o se manda otro
 * mensaje. Al editar sin botones se quita el teclado viejo: si no, Telegram
 * deja activos unos botones cuyo token ya no sirve.
 *
 * Teclados (Telegram admite uno por mensaje):
 *   - `botones`: botones en línea, pegados al mensaje. Tienen prioridad.
 *   - `opcionesRapidas`: filas de textos que se muestran en la barra de
 *     mensajes; al tocar uno llega como si el paciente lo escribiera. Un
 *     mensaje editado no puede llevarlas, así que en ese caso se manda uno nuevo.
 *   - `mostrarMenu`: el flujo terminó y vuelve el menú principal a la barra.
 *     Si el mensaje ya llevaba otro teclado (o se editó), el menú se manda en
 *     un mensaje corto aparte.
 *
 * @param {object} ctx Contexto de Telegraf.
 * @param {{ texto: string, botones?: Array<Array<{texto: string, callback: string}>>, opcionesRapidas?: string[][], mostrarMenu?: boolean, editarMensaje?: boolean }} respuesta
 * @param {{ editar?: boolean }} [opciones]
 */
export async function responderConversacion(ctx, respuesta, { editar = false } = {}) {
  if (!respuesta) return null;

  const texto = String(respuesta.texto ?? '').trim();
  if (!texto) return null;

  const extra = { ...EXTRA_HTML };
  const teclado = tecladoConversacion(respuesta.botones);
  const rapidas = teclado ? null : tecladoOpcionesRapidas(respuesta.opcionesRapidas);
  const vaAEditar = editar && respuesta.editarMensaje !== false && !rapidas;
  let menuAparte = Boolean(respuesta.mostrarMenu);

  if (teclado) {
    extra.reply_markup = teclado.reply_markup;
  } else if (rapidas) {
    extra.reply_markup = rapidas.reply_markup;
  } else if (vaAEditar) {
    extra.reply_markup = { inline_keyboard: [] };
  } else if (menuAparte) {
    extra.reply_markup = tecladoMenu().reply_markup;
    menuAparte = false;
  }

  let enviado = null;
  if (vaAEditar) {
    try {
      enviado = await ctx.editMessageText(texto, extra);
    } catch (error) {
      // Mensaje viejo o sin permisos para editarlo: se manda aparte.
      if (!esMensajeSinCambios(error)) enviado = await ctx.reply(texto, extra);
    }
  } else {
    enviado = await ctx.reply(texto, extra);
  }

  if (menuAparte) await mostrarMenu(ctx);
  return enviado;
}

/**
 * Cierra el "relojito" del botón. Nunca lanza: la consulta puede haber
 * caducado y no hay forma de avisar al paciente por ahí.
 */
export async function responderAviso(ctx, aviso) {
  if (typeof ctx?.answerCbQuery !== 'function') return false;

  try {
    await ctx.answerCbQuery(aviso ? String(aviso) : undefined);
    return true;
  } catch {
    return false;
  }
}

/** Respuesta a un botón: primero el aviso, luego el mensaje. */
export async function responderCallback(ctx, respuesta) {
  await responderAviso(ctx, respuesta?.aviso);
  return responderConversacion(ctx, respuesta, { editar: true });
}

/**
 * Envuelve una llamada al servicio para que un fallo nunca tumbe el bot.
 *
 * El log lleva solo el nombre del error: ni el texto del paciente ni valores
 * clínicos. Se devuelve un mensaje genérico para el paciente.
 */
export async function ejecutarConversacion(contexto, trabajo) {
  try {
    return await trabajo();
  } catch (error) {
    console.error(`[conversacion] Falló ${contexto}: ${error?.name ?? 'Error'}`);
    return { texto: TEXTO_ERROR_CONVERSACION, error: true };
  }
}

/**
 * Atiende un botón de la conversación.
 *
 * `answerCbQuery` se llama SIEMPRE (aunque el servicio falle), porque Telegram
 * deja el botón en "cargando" hasta que se responde.
 */
export async function atenderCallback(ctx, trabajo) {
  let respuesta;

  try {
    respuesta = await trabajo();
  } catch (error) {
    console.error(`[conversacion] Falló el botón: ${error?.name ?? 'Error'}`);
    await responderAviso(ctx, 'No pude completar eso');
    return ctx.reply(TEXTO_ERROR_CONVERSACION);
  }

  try {
    return await responderCallback(ctx, respuesta);
  } catch (error) {
    console.error(`[conversacion] Falló la respuesta del botón: ${error?.name ?? 'Error'}`);
    return responderAviso(ctx, 'No pude mostrar la respuesta');
  }
}
