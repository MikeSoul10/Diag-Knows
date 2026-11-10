/**
 * /historial (DK-301): resumen de lo que el paciente registró en los últimos días.
 *
 * Solo describe lo guardado (conteos, promedios, últimos valores). No interpreta
 * ni diagnostica, y no marca nada como "normal" o "alto": no hay umbrales
 * clínicos validados. El descifrado ocurre en los repositorios, no aquí.
 *
 *   resumenHistorial({ chatId, dias?, tipo?, ahora? }) -> { texto, sinConsentimiento? }
 *   detectarConsultaHistorial(texto)                   -> { tipo } | null
 *
 * El texto sale en HTML de Telegram, con lo escrito por el paciente escapado.
 */

import { mediciones, sintomas, dosisLogs } from '../repositories/index.js';
import { obtenerPacienteActivo } from './registration.service.js';
import { escaparHtml } from '../channel/format.js';

export const DIAS_POR_DEFECTO = 7;
export const MAX_SINTOMAS_LISTADOS = 5;
const LARGO_SINTOMA = 80;

const ZONA_HORARIA = process.env.TZ || 'America/Mexico_City';
const MS_DIA = 24 * 60 * 60 * 1000;

const TIPOS = Object.freeze({
  glucosa: { etiqueta: 'Glucosa', unidad: 'mg/dL' },
  presion: { etiqueta: 'Presión', unidad: 'mmHg' },
  peso: { etiqueta: 'Peso', unidad: 'kg' },
});

const GRAVEDAD = Object.freeze({ LEVE: 'Leve', MODERADO: 'Moderado', GRAVE: 'Fuerte' });

const SIN_CONSENTIMIENTO = Object.freeze({
  texto: 'Primero necesito que aceptes el aviso de privacidad.',
  sinConsentimiento: true,
});

const AVISO_FINAL =
  'Esto solo resume lo que registraste; no es un diagnóstico. Coméntalo con tu médico.';

function dia(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    timeZone: ZONA_HORARIA,
  });
}

function numero(valor) {
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(1);
}

function promedio(valores) {
  return valores.reduce((suma, valor) => suma + valor, 0) / valores.length;
}

function recortar(texto) {
  const limpio = String(texto ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio.length > LARGO_SINTOMA ? `${limpio.slice(0, LARGO_SINTOMA - 1)}…` : limpio;
}

function lineaMedicion(tipo, filas) {
  const { etiqueta, unidad } = TIPOS[tipo];
  const ordenadas = [...filas].sort((a, b) => new Date(a.medidaEn) - new Date(b.medidaEn));
  const ultima = ordenadas[ordenadas.length - 1];
  const registros = `${ordenadas.length} ${ordenadas.length === 1 ? 'registro' : 'registros'}`;

  if (tipo === 'presion') {
    const sistolica = ordenadas.map((fila) => fila.valor);
    const diastolica = ordenadas.map((fila) => fila.valor2);
    return (
      `${etiqueta}: ${registros} · promedio ${numero(Math.round(promedio(sistolica)))}/` +
      `${numero(Math.round(promedio(diastolica)))} ${unidad} · ` +
      `última ${numero(ultima.valor)}/${numero(ultima.valor2)} (${dia(ultima.medidaEn)})`
    );
  }

  const valores = ordenadas.map((fila) => fila.valor);
  const media = tipo === 'peso' ? promedio(valores).toFixed(1) : Math.round(promedio(valores));
  const rango =
    valores.length > 1
      ? ` · de ${numero(Math.min(...valores))} a ${numero(Math.max(...valores))}`
      : '';

  return (
    `${etiqueta}: ${registros} · promedio ${media} ${unidad}${rango} · ` +
    `última ${numero(ultima.valor)} ${unidad} (${dia(ultima.medidaEn)})`
  );
}

function seccionMediciones(filas, tipo) {
  const tipos = tipo ? [tipo] : Object.keys(TIPOS);
  const lineas = [];

  for (const actual of tipos) {
    const delTipo = filas.filter((fila) => fila.tipo === actual);
    if (delTipo.length > 0) lineas.push(lineaMedicion(actual, delTipo));
  }

  if (lineas.length === 0) {
    return tipo
      ? [`No tienes registros de ${TIPOS[tipo].etiqueta.toLowerCase()} en este periodo.`]
      : ['Sin mediciones en este periodo.'];
  }
  return lineas;
}

function seccionSintomas(filas) {
  if (filas.length === 0) return ['Sin síntomas en este periodo.'];

  const recientes = [...filas]
    .sort((a, b) => new Date(b.reportadoEn) - new Date(a.reportadoEn))
    .slice(0, MAX_SINTOMAS_LISTADOS);

  const lineas = recientes.map(
    (fila) =>
      `• ${dia(fila.reportadoEn)} · ${GRAVEDAD[fila.nivelGravedad] ?? fila.nivelGravedad} · ` +
      escaparHtml(recortar(fila.descripcion))
  );

  const faltan = filas.length - recientes.length;
  if (faltan > 0) lineas.push(`…y ${faltan} más.`);
  return lineas;
}

function seccionTomas(filas) {
  if (filas.length === 0) return ['Sin tomas registradas en este periodo.'];

  const tomadas = filas.filter((fila) => fila.estado === 'TOMADA').length;
  const noTomadas = filas.filter((fila) => ['SALTADA', 'OMITIDA'].includes(fila.estado)).length;

  const partes = [`Tomas registradas: ${tomadas}`];
  if (noTomadas > 0) partes.push(`no tomadas: ${noTomadas}`);
  return [partes.join(' · ')];
}

export async function resumenHistorial({
  chatId,
  dias = DIAS_POR_DEFECTO,
  tipo = null,
  ahora = () => new Date(),
} = {}) {
  const paciente = await obtenerPacienteActivo(chatId);
  if (!paciente) return SIN_CONSENTIMIENTO;

  const hasta = ahora();
  const desde = new Date(hasta.getTime() - dias * MS_DIA);
  // Un minuto de margen: un registro hecho justo ahora no debe quedar fuera.
  const limite = new Date(hasta.getTime() + 60 * 1000);

  const medidas = await mediciones.listarPorRango(paciente.id, desde, limite);
  const hayTipo = tipo && TIPOS[tipo];

  const encabezado = [
    `<b>Tu resumen de los últimos ${dias} días</b>`,
    `${dia(desde)} – ${dia(hasta)}`,
    '',
  ];
  const secciones = [['Mediciones', seccionMediciones(medidas, hayTipo ? tipo : null)]];

  if (!hayTipo) {
    const [sintomasFilas, tomas] = await Promise.all([
      sintomas.listarPorRango(paciente.id, desde, limite),
      dosisLogs.listarPorRango(paciente.id, desde, limite),
    ]);
    secciones.push(
      [`Síntomas (${sintomasFilas.length})`, seccionSintomas(sintomasFilas)],
      ['Medicamento', seccionTomas(tomas)]
    );

    if (medidas.length === 0 && sintomasFilas.length === 0 && tomas.length === 0) {
      return {
        texto: [
          ...encabezado.slice(0, 2),
          '',
          'Todavía no tienes registros en este periodo.',
          'Cuéntame cómo te sientes con /reportar o registra tu medicamento con /tome.',
        ].join('\n'),
      };
    }
  }

  const cuerpo = secciones.flatMap(([titulo, lineas]) => [`<b>${titulo}</b>`, ...lineas, '']);

  return { texto: [...encabezado, ...cuerpo, AVISO_FINAL].join('\n') };
}

// ---------------------------------------------------------------------------
// Pregunta en lenguaje natural ("¿cómo ha estado mi glucosa esta semana?")
// ---------------------------------------------------------------------------

function sinAcentos(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const RE_PREGUNTA =
  /\b(como (ha|han|van|estuvo|estuvieron|he estado|ando|anda)|mi historial|mi resumen|resumen de)\b/;
const RE_TEMA = /\b(glucosa|azucar|presion|peso|sintomas|semana|historial|resumen|ultimos dias)\b/;

/**
 * ¿El texto es una consulta del historial y no un reporte?
 *
 * Es deliberadamente estricta: un mensaje con números ("glucosa 115") es un
 * reporte y sigue su flujo normal.
 *
 * @returns {{ tipo: 'glucosa'|'presion'|'peso'|null }|null}
 */
export function detectarConsultaHistorial(texto) {
  const limpio = sinAcentos(texto);
  if (!limpio || /\d/.test(limpio)) return null;
  if (!RE_PREGUNTA.test(limpio) || !RE_TEMA.test(limpio)) return null;

  if (/\b(glucosa|azucar)\b/.test(limpio)) return { tipo: 'glucosa' };
  if (/\bpresion\b/.test(limpio)) return { tipo: 'presion' };
  if (/\bpeso\b/.test(limpio)) return { tipo: 'peso' };
  return { tipo: null };
}

/** Tipo pedido como argumento: `/historial glucosa`. */
export function tipoDeArgumento(argumento) {
  const limpio = sinAcentos(argumento).trim();
  if (/^(glucosa|azucar)$/.test(limpio)) return 'glucosa';
  if (/^presion$/.test(limpio)) return 'presion';
  if (/^peso$/.test(limpio)) return 'peso';
  return null;
}
