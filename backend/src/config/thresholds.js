/**
 * Umbrales clínicos de las mediciones (DK-203).
 *
 * REGLA (AGENTS.md §2): estos valores NO los define el equipo ni un agente de
 * IA. Los debe revisar y firmar un profesional de la salud. Mientras un umbral
 * sea `null`, ninguna medición se marca como crítica y no se dispara alerta.
 *
 * Para activarlos:
 *   1. El profesional de la salud propone los valores por tipo de medición.
 *   2. Se registra quién los validó y cuándo en `docs/decisiones.md`.
 *   3. Se reemplaza el `null` correspondiente y se agregan pruebas.
 *
 * Significado de cada campo (todos en la unidad de la medición):
 *   - minimo: por debajo de este valor la medición es crítica.
 *   - maximo: por arriba de este valor la medición es crítica.
 * En presión, `sistolica` y `diastolica` tienen su propio par.
 *
 * Estos umbrales no son los rangos de `validador.js`: aquellos solo descartan
 * valores imposibles o mal escritos (glucosa 5000), no juzgan la salud.
 */

export const UMBRALES = Object.freeze({
  glucosa: Object.freeze({ minimo: null, maximo: null }),
  presion: Object.freeze({
    sistolica: Object.freeze({ minimo: null, maximo: null }),
    diastolica: Object.freeze({ minimo: null, maximo: null }),
  }),
  peso: Object.freeze({ minimo: null, maximo: null }),
});

/** Quién validó los umbrales y cuándo. `null` mientras nadie lo haya hecho. */
export const VALIDACION_CLINICA = Object.freeze({ validadoPor: null, fecha: null });

function fueraDe(valor, umbral) {
  if (typeof valor !== 'number' || !umbral) return false;
  if (umbral.minimo !== null && valor < umbral.minimo) return true;
  if (umbral.maximo !== null && valor > umbral.maximo) return true;
  return false;
}

/**
 * ¿La medición cruza un umbral validado? Con los umbrales en `null` siempre
 * devuelve `false`.
 *
 * @param {{ tipo: string, valor: number, valor2?: number|null }} medicion
 * @param {object} [umbrales] Solo para pruebas.
 */
export function esCritica(medicion, umbrales = UMBRALES) {
  const { tipo, valor, valor2 } = medicion ?? {};
  if (tipo === 'presion') {
    return (
      fueraDe(valor, umbrales.presion?.sistolica) || fueraDe(valor2, umbrales.presion?.diastolica)
    );
  }
  return fueraDe(valor, umbrales[tipo]);
}
