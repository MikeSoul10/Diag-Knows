/**
 * Anonimizador previo a la IA.
 *
 * Regla del proyecto: a Claude solo viaja texto, nunca identificadores. Este
 * módulo tapa teléfonos, correos, URLs, números largos y nombres conocidos.
 *
 * Lo que NO toca (a propósito): valores clínicos como `115`, `120/80` o
 * `72.5 kg`, y fechas como `2026-10-27`. El reconocedor de teléfonos exige
 * 10 dígitos, un `+` inicial o separadores propios de un número telefónico;
 * si no, deja el texto intacto.
 */

const REEMPLAZOS = {
  telefono: '[TELEFONO]',
  correo: '[CORREO]',
  url: '[URL]',
  nombre: '[NOMBRE]',
};

/** Nombres de menos de 3 letras se ignoran: taparían texto normal sin ganar nada. */
const LARGO_MINIMO_NOMBRE = 3;

function textoDe(entrada) {
  return typeof entrada === 'string' ? entrada : '';
}

function escaparRegex(cadena) {
  return cadena.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ¿El fragmento parece un teléfono y no una fecha o un valor clínico?
 * @param {string} fragmento
 */
function pareceTelefono(fragmento) {
  const digitos = (fragmento.match(/\d/g) || []).length;
  if (fragmento.startsWith('+')) return digitos >= 7;
  if (/[\s(]/.test(fragmento)) return digitos >= 7;
  return digitos >= 10;
}

/**
 * Tapa los datos personales de un mensaje.
 *
 * @param {string} texto Mensaje original del paciente.
 * @param {{ nombres?: Array<string|null|undefined> }} [opciones] Nombres conocidos (p. ej. el alias).
 * @returns {string} Texto anonimizado, listo para el extractor.
 */
export function anonimizar(texto, { nombres = [] } = {}) {
  let salida = textoDe(texto);
  if (!salida) return '';

  // 1. URLs completas (antes que correos: una URL puede contener un correo).
  salida = salida.replace(/(?:https?:\/\/|www\.)\S+/gi, REEMPLAZOS.url);

  // 2. Correos.
  salida = salida.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, REEMPLAZOS.correo);

  // 3. Teléfonos con separadores o prefijo internacional.
  salida = salida.replace(/\+?\d[\d\s().-]{8,}\d/g, (fragmento) =>
    pareceTelefono(fragmento) ? REEMPLAZOS.telefono : fragmento
  );

  // 4. Números de 7 dígitos o más sin separadores (IDs, teléfonos pegados).
  salida = salida.replace(/\b\d{7,}\b/g, REEMPLAZOS.telefono);

  // 5. Nombres conocidos, respetando límites de palabra y mayúsculas.
  const candidatos = (Array.isArray(nombres) ? nombres : [])
    .map((nombre) => textoDe(nombre).trim())
    .filter((nombre) => nombre.length >= LARGO_MINIMO_NOMBRE);

  for (const nombre of candidatos) {
    // Límites por letra/número: `\b` falla con nombres que terminan en ")".
    salida = salida.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escaparRegex(nombre)}(?![\\p{L}\\p{N}])`, 'giu'),
      REEMPLAZOS.nombre
    );
  }

  return salida;
}
