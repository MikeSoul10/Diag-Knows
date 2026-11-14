/**
 * Alertas orientativas por medición (DK-302).
 *
 * Reutiliza `esCritica()` de `config/thresholds.js`: mientras los umbrales
 * clínicos sigan en `null` ninguna medición dispara alerta. La lógica queda
 * completa y se prueba inyectando umbrales desde las pruebas.
 *
 * Fuera de esta entrega: la alerta por `DOSIS_OMITIDA` (requiere que
 * `marcarOmitidas` devuelva los ids) y el envío proactivo al paciente.
 */

import { UMBRALES, esCritica } from '../config/thresholds.js';
import { alertas as alertasRepo } from '../repositories/index.js';

/**
 * ¿La medición merece una alerta? Devuelve la alerta sin persistir o `null`.
 *
 * @param {{ tipo: string, valor: number, valor2?: number|null }} medicion
 * @param {object} [umbrales] Solo para pruebas.
 * @returns {{ tipo: 'UMBRAL_CRITICO', severidad: 'ALTA' } | null}
 */
export function evaluarMedicion(medicion, umbrales = UMBRALES) {
  return esCritica(medicion, umbrales) ? { tipo: 'UMBRAL_CRITICO', severidad: 'ALTA' } : null;
}

/**
 * Crea la alerta si la medición cruza un umbral validado.
 *
 * @param {object} opciones
 * @param {object} [opciones.repo] Repositorio de alertas (por defecto la fachada).
 * @param {string} opciones.pacienteId
 * @param {string} [opciones.medicionId]
 * @param {{ tipo: string, valor: number, valor2?: number|null }} opciones.medicion
 * @param {object} [opciones.umbrales]
 * @returns {Promise<object|null>} la alerta creada o `null`.
 */
export async function registrarSiCorresponde({
  repo = alertasRepo,
  pacienteId,
  medicionId = null,
  medicion,
  umbrales = UMBRALES,
} = {}) {
  const evaluada = evaluarMedicion(medicion, umbrales);
  if (!evaluada) return null;

  return repo.crear({
    pacienteId,
    medicionId,
    tipo: evaluada.tipo,
    severidad: evaluada.severidad,
  });
}
