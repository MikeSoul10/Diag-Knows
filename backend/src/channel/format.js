/**
 * Helpers de presentación para Telegram.
 *
 * Único lugar con textos fijos y teclados. Telegram solo admite un subconjunto
 * de HTML: <b>, <i>, <code>, <a>. Todo dato que venga del paciente se escapa.
 */

import { Markup } from 'telegraf';

export const EXTRA_HTML = {
  parse_mode: 'HTML',
  link_preview_options: { is_disabled: true },
};

export const AVISO_PRIVACIDAD = [
  '<b>Aviso de privacidad</b>',
  '',
  'Soy un asistente para dar seguimiento a tu enfermedad crónica: guardo tus síntomas, medicación y mediciones para que tú y tu equipo de salud puedan ver cómo vas.',
  '',
  '• Solo guardo lo necesario: un apodo, tu año de nacimiento y tu enfermedad. No pido tu nombre completo ni tu dirección.',
  '• Tus datos de salud se guardan cifrados en la base de datos.',
  '• Los chats con bots de Telegram <b>no tienen cifrado de extremo a extremo</b>: Telegram puede verlos.',
  '• Puedes pedir que borre tus datos cuando quieras.',
  '',
  '<b>No sustituyo a tu médico ni a urgencias.</b> No doy diagnósticos ni ajusto dosis.',
  '',
  '¿Aceptas?',
].join('\n');

/**
 * Botones del menú principal (teclado de la barra de mensajes). Al tocarlos,
 * Telegram manda su texto como un mensaje normal; `bot.hears` los atiende con
 * el mismo handler que el comando equivalente.
 */
export const BOTONES_MENU = Object.freeze({
  reportar: '📝 Reportar',
  tome: '💊 Ya me la tomé',
  historial: '📊 Historial',
  perfil: '👤 Mi perfil',
  ayuda: '❓ Ayuda',
  cancelar: '✖️ Cancelar',
});

export const AYUDA = [
  '<b>Qué puedo hacer</b>',
  '',
  'Usa los botones de abajo o escríbeme normal, por ejemplo: "me tomé la pastilla y tengo glucosa en 115".',
  '',
  `${BOTONES_MENU.reportar}: contarme síntomas, mediciones o tomas (/reportar)`,
  `${BOTONES_MENU.tome}: registrar tu medicamento al momento (/tome)`,
  `${BOTONES_MENU.historial}: tus últimos 7 días (/historial)`,
  `${BOTONES_MENU.perfil}: tus datos guardados (/perfil)`,
  `${BOTONES_MENU.cancelar}: salir de lo que tengas a medias (/cancelar)`,
  '',
  'Para borrar todos tus datos escribe /borrar_datos.',
].join('\n');

/** Acompaña al teclado del menú cuando el mensaje anterior no podía llevarlo. */
export const MENSAJE_MENU = 'Cuando quieras, usa los botones de abajo.';

/** Solo se entiende texto: voz, fotos y archivos no se leen. */
export const MENSAJE_SOLO_TEXTO =
  'Por ahora solo entiendo texto escrito. Cuéntame con palabras lo que sientes o la medición que tuviste.';

export function escaparHtml(texto) {
  return String(texto ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function tecladoConsentimiento() {
  return Markup.inlineKeyboard([
    Markup.button.callback('Acepto', 'consent:yes'),
    Markup.button.callback('No acepto', 'consent:no'),
  ]);
}

export function tecladoEnfermedades(opciones) {
  return Markup.inlineKeyboard(
    opciones.map((opcion) => [
      // 4 + 36 = 40 bytes, muy por debajo del límite de 64 de Telegram.
      Markup.button.callback(opcion.nombre, `enf:${opcion.id}`),
    ])
  );
}

export function tecladoConfirmar() {
  return Markup.inlineKeyboard([
    Markup.button.callback('Sí, guardar', 'reg:ok'),
    Markup.button.callback('Corregir', 'reg:no'),
  ]);
}

/**
 * Menú principal fijo en la barra de mensajes. `persistent` lo deja visible
 * aunque el paciente abra el teclado del celular; `resize` lo hace compacto.
 */
export function tecladoMenu() {
  return Markup.keyboard([
    [BOTONES_MENU.reportar, BOTONES_MENU.tome],
    [BOTONES_MENU.historial, BOTONES_MENU.perfil],
    [BOTONES_MENU.ayuda, BOTONES_MENU.cancelar],
  ])
    .resize()
    .persistent()
    .placeholder('Escribe o toca un botón');
}

/**
 * Respuestas rápidas temporales (por ejemplo, los síntomas de /reportar).
 * Se ocultan al tocar una: el texto llega como si el paciente lo escribiera.
 */
export function tecladoOpcionesRapidas(filas) {
  if (!Array.isArray(filas) || filas.length === 0) return null;
  return Markup.keyboard(filas.map((fila) => fila.map(String)))
    .resize()
    .oneTime()
    .placeholder('Toca una opción o escríbela');
}

export function tecladoRegistrar() {
  return Markup.inlineKeyboard([[Markup.button.callback('Registrarme', 'reg:iniciar')]]);
}

/**
 * Teclado a partir de los botones del servicio de conversación.
 *
 * El servicio devuelve filas de `{ texto, callback }` sin conocer Telegraf;
 * aquí se convierten en un `inline_keyboard`.
 */
export function tecladoConversacion(botones) {
  if (!Array.isArray(botones) || botones.length === 0) return null;

  return Markup.inlineKeyboard(
    botones.map((fila) => fila.map((boton) => Markup.button.callback(boton.texto, boton.callback)))
  );
}
