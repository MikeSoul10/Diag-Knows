/**
 * Conversación de seguimiento (DK-202, DK-203, DK-204, DK-205).
 *
 * Flujo: mensaje del paciente -> anonimizar -> extraer -> validar -> resumen ->
 * confirmación del paciente -> guardar. Nada se guarda sin confirmación.
 *
 * NO conoce Telegraf: recibe chatId y texto planos y devuelve
 *   { texto, botones?, editarMensaje?, aviso? }
 * donde `botones` son filas de `{ texto, callback }` y `editarMensaje` indica al
 * canal que edite el mensaje original (el del resumen) en lugar de mandar otro.
 *
 * El texto sale en HTML de Telegram (se escapan `<`, `>` y `&` de todo lo que
 * viene del paciente o del extractor). Es la excepción a la regla del Sprint 1
 * de devolver texto plano: aquí el resumen lo necesita.
 *
 * Estados por chat (Map con expiración de 30 min, reloj inyectable):
 *   INACTIVO · PREGUNTANDO_SINTOMAS · PREGUNTANDO_MEDICACION
 *   PREGUNTANDO_MEDICIONES · ESPERANDO_CONFIRMACION · CORRIGIENDO
 *
 * Los callbacks llevan el token del borrador (`conv:ok:<token>`,
 * `conv:no:<token>`, `conv:skip:<token>`, `sev:<token>:<índice>:<1|2|3>`):
 * cualquier botón de un mensaje anterior deja de servir.
 */

import { randomBytes } from 'node:crypto';

import { esCritica } from '../config/thresholds.js';
import { describirMomento, zonaValida } from './fechas.js';

export const ESTADOS = Object.freeze({
  INACTIVO: 'INACTIVO',
  PREGUNTANDO_SINTOMAS: 'PREGUNTANDO_SINTOMAS',
  PREGUNTANDO_MEDICACION: 'PREGUNTANDO_MEDICACION',
  PREGUNTANDO_MEDICIONES: 'PREGUNTANDO_MEDICIONES',
  ESPERANDO_CONFIRMACION: 'ESPERANDO_CONFIRMACION',
  CORRIGIENDO: 'CORRIGIENDO',
});

const PASOS_DE_PREGUNTA = [
  ESTADOS.PREGUNTANDO_SINTOMAS,
  ESTADOS.PREGUNTANDO_MEDICACION,
  ESTADOS.PREGUNTANDO_MEDICIONES,
];

const SIGUIENTE_PASO = Object.freeze({
  [ESTADOS.PREGUNTANDO_SINTOMAS]: ESTADOS.PREGUNTANDO_MEDICACION,
  [ESTADOS.PREGUNTANDO_MEDICACION]: ESTADOS.PREGUNTANDO_MEDICIONES,
  [ESTADOS.PREGUNTANDO_MEDICIONES]: ESTADOS.ESPERANDO_CONFIRMACION,
});

/** La escala de la conversación (1|2|3) contra el CHECK de la columna. */
const NIVEL_GRAVEDAD = Object.freeze({ 1: 'LEVE', 2: 'MODERADO', 3: 'GRAVE' });
const ETIQUETA_GRAVEDAD = Object.freeze({ 1: 'leve', 2: 'moderada', 3: 'fuerte' });

export const TTL_MINUTOS = 30;
const TTL_MS = TTL_MINUTOS * 60 * 1000;

/** Cuántos mensajes anteriores (anonimizados) se dan como contexto al extractor. */
export const MENSAJES_DE_CONTEXTO = 5;

const ZONA_HORARIA_RESPALDO = 'America/Mexico_City';

// ---------------------------------------------------------------------------
// Textos fijos (español, breves, sin diagnosticar)
// ---------------------------------------------------------------------------

const TEXTO_SIN_REGISTRO =
  'Primero necesito tu registro. Envía /start, acepta el aviso de privacidad y luego podrás contarme cómo te sientes.';

const TEXTO_SIN_CONSENTIMIENTO =
  'Necesito que aceptes el aviso de privacidad antes de registrar datos de salud. Envía /start cuando quieras.';

const TEXTO_ERROR_EXTRACCION =
  'No pude interpretar tu mensaje en este momento. Inténtalo de nuevo en un rato o escríbelo más simple, por ejemplo: "mi glucosa está en 115".';

const TEXTO_CONSULTA_MEDICA =
  'No puedo darte diagnósticos ni recomendarte tratamientos: eso le toca a tu profesional de la salud. Si quieres, cuéntame qué síntomas, mediciones o tomas tuviste y lo registro.';

const TEXTO_NO_ENTENDI =
  'No identifiqué datos para registrar. Cuéntame, por ejemplo: "me tomé la pastilla y mi glucosa está en 115".';

const TEXTO_NADA_QUE_GUARDAR =
  'No hay nada que guardar todavía. Cuando quieras, escríbeme lo que sientes o la medición que tuviste.';

const TEXTO_YA_REGISTRADO =
  'Ese registro ya quedó guardado. Si quieres anotar algo más, escríbeme.';

const TEXTO_NO_VIGENTE =
  'Esa opción ya no está vigente. Escríbeme de nuevo lo que quieres registrar.';

/** Texto de la opción para saltar un paso del reporte guiado. */
export const TEXTO_OMITIR = 'Nada que reportar';

/**
 * Respuestas rápidas del paso de síntomas: el canal las muestra como botones
 * en la barra de mensajes y, al tocar una, llega como texto normal (el
 * extractor la reconoce igual que si el paciente la escribiera).
 */
export const OPCIONES_SINTOMAS = Object.freeze([
  ['Dolor de cabeza', 'Mareo'],
  ['Cansancio', 'Falta de aire'],
  ['Náuseas', 'Tos', 'Silbidos en el pecho'],
  [TEXTO_OMITIR],
]);

/** Lo que cuenta como "saltar este paso" si llega escrito (o tocado en la barra). */
const PATRONES_OMITIR = [
  /^nada que reportar$/,
  /^nada$/,
  /^ninguno$/,
  /^ninguna$/,
  /^sin sintomas$/,
];

/** Preguntas médicas: el bot no opina (DK-205). */
const PATRONES_PREGUNTA = [
  /^\s*¿/,
  /\?\s*$/,
  /\b(?:es normal|es malo|es bueno|es peligroso|está bien|esta bien|qué hago|que hago|debo|puedo|podría|podria|cuál|cual|cuándo|cuando|por qué|por que|sirve|hace daño|hace dano|tengo que|qué tomo|que tomo|me conviene)\b/,
];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function borradorVacio() {
  return { medicacion: [], mediciones: [], sintomas: [] };
}

function escapar(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function capitalizar(texto) {
  const limpio = String(texto ?? '');
  return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : limpio;
}

function unir(...partes) {
  return partes.filter((parte) => Boolean(parte && parte.trim())).join('\n\n');
}

function conAvisos(respuesta, avisos) {
  if (!avisos) return respuesta;
  return { ...respuesta, texto: `${avisos}\n\n${respuesta.texto}` };
}

function estaVacio(borrador) {
  return (
    borrador.medicacion.length === 0 &&
    borrador.mediciones.length === 0 &&
    borrador.sintomas.length === 0
  );
}

function esPasoDePregunta(estado) {
  return PASOS_DE_PREGUNTA.includes(estado);
}

function parecePregunta(texto) {
  return PATRONES_PREGUNTA.some((patron) => patron.test(texto));
}

function esOmitir(texto) {
  const limpio = normalizar(texto).replace(/[.!¡]/g, '').trim();
  return PATRONES_OMITIR.some((patron) => patron.test(limpio));
}

function contarValidos(validos) {
  return validos.medicacion.length + validos.mediciones.length + validos.sintomas.length;
}

function motivosDeRechazo(rechazados) {
  if (rechazados.length === 0) return '';

  return [
    '⚠️ Esto no lo pude registrar:',
    ...rechazados.map(({ motivo }) => `• ${escapar(motivo)}`),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Almacén de estados por defecto (memoria)
// ---------------------------------------------------------------------------

/**
 * Almacén en memoria con el que trabaja la conversación por defecto.
 * Se puede reemplazar por otro (Redis, tabla) sin cambiar la lógica.
 */
export function crearAlmacenMemoria() {
  const estados = new Map();

  const clave = (chatId) => String(chatId ?? '');

  return {
    obtener(chatId) {
      const guardado = estados.get(clave(chatId));
      return guardado ? structuredClone(guardado) : null;
    },
    guardar(chatId, estado) {
      estados.set(clave(chatId), structuredClone(estado));
      return structuredClone(estado);
    },
    limpiar(chatId) {
      estados.delete(clave(chatId));
    },
    __reset() {
      estados.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

/**
 * Crea el servicio de conversación.
 *
 * @param {object} dependencias
 * @param {object} dependencias.repos Repositorios (`patients`, `mediciones`, `sintomas`, `medicamentos`, `dosisLogs`).
 * @param {{ extraer: (texto: string, opciones?: object) => Promise<object> }} dependencias.extractor
 *   Recibe `{ ahora, zonaHoraria, contexto }` (contexto: mensajes anteriores anonimizados).
 * @param {(texto: string, opciones?: object) => string} dependencias.anonimizar
 * @param {(extraccion: object, opciones?: { ahora: Date }) => { validos: object, rechazados: Array<object> }} dependencias.validar
 * @param {{ obtener: Function, guardar: Function, limpiar: Function }} [dependencias.almacenEstado]
 * @param {() => Date} [dependencias.ahora] Reloj inyectable (pruebas de expiración).
 * @param {() => string} [dependencias.generarToken] Token corto para los botones.
 * @param {(contexto: string, error: Error) => void} [dependencias.registrarError] Log sin datos del paciente.
 * @param {string} [dependencias.zonaHorariaPorDefecto] Si el paciente no tiene zona propia.
 * @param {(medicion: object) => boolean} [dependencias.evaluarCritica] Umbral crítico inyectable (pruebas).
 */
export function crearServicioConversacion({
  repos,
  extractor,
  anonimizar,
  validar,
  almacenEstado = crearAlmacenMemoria(),
  ahora = () => new Date(),
  generarToken = () => randomBytes(4).toString('hex'),
  registrarError = (contexto, error) => {
    // Nunca se registra el texto del paciente ni valores clínicos.
    console.error(`[conversacion] Falló ${contexto}: ${error?.name ?? 'Error'}`);
  },
  zonaHorariaPorDefecto = ZONA_HORARIA_RESPALDO,
  evaluarCritica = esCritica,
} = {}) {
  if (!repos) throw new Error('crearServicioConversacion necesita repos');
  if (!extractor?.extraer) throw new Error('crearServicioConversacion necesita extractor.extraer');
  if (typeof anonimizar !== 'function') {
    throw new Error('crearServicioConversacion necesita anonimizar');
  }
  if (typeof validar !== 'function') throw new Error('crearServicioConversacion necesita validar');

  const relojMs = () => new Date(ahora()).getTime();

  function zonaDe(paciente) {
    if (zonaValida(paciente?.zonaHoraria)) return paciente.zonaHoraria;
    return zonaValida(zonaHorariaPorDefecto) ? zonaHorariaPorDefecto : ZONA_HORARIA_RESPALDO;
  }

  // -------------------------------------------------------------------------
  // Contexto: últimos mensajes del chat (anonimizados, solo en memoria)
  // -------------------------------------------------------------------------

  /** @type {Map<string, Array<{ texto: string, en: number }>>} */
  const contextos = new Map();

  function vigentesDe(chatId) {
    return (contextos.get(String(chatId ?? '')) ?? []).filter(({ en }) => relojMs() - en <= TTL_MS);
  }

  function leerContexto(chatId) {
    const vigentes = vigentesDe(chatId);
    if (vigentes.length === 0) contextos.delete(String(chatId ?? ''));
    return vigentes.map(({ texto }) => texto);
  }

  function recordarMensaje(chatId, texto) {
    const previos = vigentesDe(chatId);
    previos.push({ texto, en: relojMs() });
    contextos.set(String(chatId ?? ''), previos.slice(-MENSAJES_DE_CONTEXTO));
  }

  function olvidarContexto(chatId) {
    contextos.delete(String(chatId ?? ''));
  }

  // -------------------------------------------------------------------------
  // Estado
  // -------------------------------------------------------------------------

  function leerEstado(chatId) {
    const estado = almacenEstado.obtener(chatId);
    if (!estado) return null;

    if (relojMs() - estado.actualizadoEn > TTL_MS) {
      almacenEstado.limpiar(chatId);
      return null;
    }
    return estado;
  }

  function guardarEstado(chatId, estado) {
    const actualizado = { ...estado, actualizadoEn: relojMs() };
    almacenEstado.guardar(chatId, actualizado);
    return actualizado;
  }

  function estadoNuevo(modo) {
    return {
      estado: modo === 'guiado' ? ESTADOS.PREGUNTANDO_SINTOMAS : ESTADOS.INACTIVO,
      modo,
      borrador: borradorVacio(),
      token: generarToken(),
      pendienteSeveridad: null,
      actualizadoEn: relojMs(),
    };
  }

  async function contextoPaciente(chatId) {
    const paciente = await repos.patients.findByTelegramChatId(String(chatId ?? ''));
    if (!paciente) return { paciente: null, mensaje: TEXTO_SIN_REGISTRO };
    if (paciente.estado !== 'ACTIVO' || !paciente.consentimientoVigente) {
      return { paciente: null, mensaje: TEXTO_SIN_CONSENTIMIENTO };
    }
    return { paciente, mensaje: null };
  }

  // -------------------------------------------------------------------------
  // Borrador
  // -------------------------------------------------------------------------

  function fusionarBorrador(borrador, validos) {
    const medicacion = [...borrador.medicacion];
    for (const toma of validos.medicacion) {
      const clave = normalizar(toma.nombre ?? '');
      const indice = medicacion.findIndex((previa) => normalizar(previa.nombre ?? '') === clave);
      if (indice >= 0) medicacion[indice] = toma;
      else medicacion.push(toma);
    }

    const mediciones = [...borrador.mediciones];
    for (const medicion of validos.mediciones) {
      const indice = mediciones.findIndex((previa) => previa.tipo === medicion.tipo);
      if (indice >= 0) mediciones[indice] = medicion;
      else mediciones.push(medicion);
    }

    const sintomas = [...borrador.sintomas];
    for (const sintoma of validos.sintomas) {
      const clave = normalizar(sintoma.descripcion);
      const indice = sintomas.findIndex((previo) => normalizar(previo.descripcion) === clave);
      if (indice >= 0) {
        // Corregir la descripción no borra la intensidad ya dicha.
        sintomas[indice] = {
          ...sintoma,
          severidad: sintoma.severidad ?? sintomas[indice].severidad,
        };
      } else {
        sintomas.push(sintoma);
      }
    }

    return { medicacion, mediciones, sintomas };
  }

  // -------------------------------------------------------------------------
  // Preguntas y resumen
  // -------------------------------------------------------------------------

  function botonOmitir(estado) {
    return [{ texto: TEXTO_OMITIR, callback: `conv:skip:${estado.token}` }];
  }

  async function preguntaDePaso(paciente, estado) {
    if (estado.estado === ESTADOS.PREGUNTANDO_SINTOMAS) {
      // Sin botones en línea: los síntomas van como respuestas rápidas en la barra
      // (Telegram no admite los dos teclados en el mismo mensaje).
      return {
        texto:
          '¿Cómo te sentiste? Toca un síntoma de los botones de abajo o cuéntamelo con tus palabras.',
        opcionesRapidas: OPCIONES_SINTOMAS.map((fila) => [...fila]),
      };
    }

    if (estado.estado === ESTADOS.PREGUNTANDO_MEDICACION) {
      const medicamentos = await repos.medicamentos.listarPorPaciente(paciente.id);
      const nombres = medicamentos.map((medicamento) => `<b>${escapar(medicamento.nombre)}</b>`);

      return {
        texto: nombres.length
          ? `¿Te tomaste tu medicamento de hoy? Tienes: ${nombres.join(', ')}.\nEscríbeme "ya me la tomé" o "no me la tomé".`
          : '¿Te tomaste algún medicamento hoy? Si tu médico te recetó alguno, dime cómo se llama.',
        botones: [botonOmitir(estado)],
      };
    }

    return {
      texto:
        '¿Tienes alguna medición de hoy? Puedes escribir, por ejemplo: "glucosa en 115", "presión 120/80" o "peso 72 kg".',
      botones: [botonOmitir(estado)],
    };
  }

  function preguntaDeSeveridad(estado, indice) {
    const sintoma = estado.borrador.sintomas[indice];

    return {
      texto: `¿Qué intensidad tenía <b>${escapar(sintoma.descripcion)}</b>?`,
      botones: [
        [
          { texto: 'Leve', callback: `sev:${estado.token}:${indice}:1` },
          { texto: 'Moderado', callback: `sev:${estado.token}:${indice}:2` },
          { texto: 'Fuerte', callback: `sev:${estado.token}:${indice}:3` },
        ],
      ],
    };
  }

  /** " · ayer 21:00" si el paciente dijo cuándo pasó (DK-202). */
  function momentoDe(item, zona) {
    if (!item.ocurridoEn) return '';
    return ` · <i>${escapar(describirMomento(item.ocurridoEn, new Date(relojMs()), zona))}</i>`;
  }

  function lineaMedicacion(toma, zona) {
    const nombre = toma.nombre ? escapar(capitalizar(toma.nombre)) : 'Medicamento sin nombre';
    return `• ${nombre}: ${toma.tomada ? 'sí la tomé' : 'no la tomé'}${momentoDe(toma, zona)}`;
  }

  function lineaMedicion(medicion, zona) {
    const momento = momentoDe(medicion, zona);
    if (medicion.tipo === 'presion') {
      return `• Presión: ${medicion.valor}/${medicion.valor2} ${escapar(medicion.unidad)}${momento}`;
    }
    if (medicion.tipo === 'glucosa') {
      return `• Glucosa: ${medicion.valor} ${escapar(medicion.unidad)}${momento}`;
    }
    return `• Peso: ${medicion.valor} ${escapar(medicion.unidad)}${momento}`;
  }

  function lineaSintoma(sintoma, zona) {
    const etiqueta = ETIQUETA_GRAVEDAD[sintoma.severidad];
    const detalle = etiqueta ? ` (${etiqueta})` : '';
    return `• ${escapar(capitalizar(sintoma.descripcion))}${detalle}${momentoDe(sintoma, zona)}`;
  }

  function resumenDe(estado, zona) {
    const secciones = [];
    const lineas = (items, linea) => items.map((item) => linea(item, zona));

    if (estado.borrador.medicacion.length > 0) {
      secciones.push(['<b>Medicación</b>', ...lineas(estado.borrador.medicacion, lineaMedicacion)]);
    }
    if (estado.borrador.mediciones.length > 0) {
      secciones.push(['<b>Mediciones</b>', ...lineas(estado.borrador.mediciones, lineaMedicion)]);
    }
    if (estado.borrador.sintomas.length > 0) {
      secciones.push(['<b>Síntomas</b>', ...lineas(estado.borrador.sintomas, lineaSintoma)]);
    }

    return {
      texto: unir(
        '<b>Esto es lo que voy a registrar:</b>',
        secciones.map((seccion) => seccion.join('\n')).join('\n\n'),
        '¿Lo guardo?'
      ),
      botones: [
        [{ texto: '✅ Sí, guardar', callback: `conv:ok:${estado.token}` }],
        [{ texto: '✏️ Corregir', callback: `conv:no:${estado.token}` }],
      ],
    };
  }

  function resumenGuardado(borrador) {
    const partes = [];
    if (borrador.medicacion.length > 0) partes.push('medicación');
    if (borrador.mediciones.length > 0) partes.push('mediciones');
    if (borrador.sintomas.length > 0) partes.push('síntomas');

    return unir(
      '✅ Listo, quedó guardado.',
      `Registré: ${partes.join(', ')}.`,
      'Si quieres anotar algo más, escríbeme.'
    );
  }

  // -------------------------------------------------------------------------
  // Continuación del flujo
  // -------------------------------------------------------------------------

  async function continuar(chatId, paciente, estado, avisos = '') {
    // Un token nuevo por mensaje: los botones anteriores dejan de servir.
    const siguiente = { ...estado, token: generarToken() };

    // 1. Falta la intensidad de algún síntoma.
    const indicePendiente = siguiente.borrador.sintomas.findIndex(
      (sintoma) => sintoma.severidad === null || sintoma.severidad === undefined
    );
    if (indicePendiente >= 0) {
      siguiente.pendienteSeveridad = indicePendiente;
      const guardado = guardarEstado(chatId, siguiente);
      return conAvisos(preguntaDeSeveridad(guardado, indicePendiente), avisos);
    }
    siguiente.pendienteSeveridad = null;

    // 2. Siguiente pregunta del flujo guiado (/reportar).
    if (esPasoDePregunta(siguiente.estado)) {
      const guardado = guardarEstado(chatId, siguiente);
      return conAvisos(await preguntaDePaso(paciente, guardado), avisos);
    }

    // 3. No hay nada que registrar.
    if (estaVacio(siguiente.borrador)) {
      almacenEstado.limpiar(chatId);
      return conAvisos({ texto: TEXTO_NADA_QUE_GUARDAR, mostrarMenu: true }, avisos);
    }

    // 4. Resumen y espera de confirmación.
    siguiente.estado = ESTADOS.ESPERANDO_CONFIRMACION;
    const guardado = guardarEstado(chatId, siguiente);
    return conAvisos(resumenDe(guardado, zonaDe(paciente)), avisos);
  }

  // -------------------------------------------------------------------------
  // Persistencia (solo tras confirmar)
  // -------------------------------------------------------------------------

  /** Todo o nada: si el repo ofrece transacciones, el borrador se guarda en una sola. */
  function persistir(pacienteId, borrador, mensajes) {
    const guardar = () => persistirSinTransaccion(pacienteId, borrador, mensajes);
    return typeof repos.transaccion === 'function' ? repos.transaccion(guardar) : guardar();
  }

  /**
   * Trazabilidad: el texto (anonimizado) de los mensajes que formaron el
   * reporte se guarda cifrado y cada registro apunta a él. Caduca solo
   * (ver `mensajes.repo.js`); al caducar, los registros quedan sin mensaje.
   */
  async function guardarMensajeOriginal(pacienteId, mensajes, cuando) {
    const textos = (mensajes ?? []).filter(Boolean);
    if (!repos.mensajes || textos.length === 0) return null;

    const guardado = await repos.mensajes.guardarMensaje({
      pacienteId,
      texto: textos.join('\n'),
      recibidoEn: cuando,
    });
    return guardado?.id ?? null;
  }

  async function persistirSinTransaccion(pacienteId, borrador, mensajes) {
    const cuando = new Date(relojMs()).toISOString();
    const mensajeId = await guardarMensajeOriginal(pacienteId, mensajes, cuando);
    const origen = mensajeId ? { mensajeId } : {};

    for (const medicion of borrador.mediciones) {
      const critica = evaluarCritica(medicion);
      const guardada = await repos.mediciones.guardarMedicion({
        pacienteId,
        tipo: medicion.tipo,
        valor: medicion.valor,
        valor2: medicion.valor2 ?? null,
        unidad: medicion.unidad,
        medidaEn: medicion.ocurridoEn ?? cuando,
        esCritica: critica,
        ...origen,
      });

      // Con los umbrales en `null` esto nunca ocurre. El repositorio de alertas
      // participa de la misma transacción que la medición.
      if (critica && repos.alertas?.crear) {
        await repos.alertas.crear({
          pacienteId,
          medicionId: guardada?.id ?? null,
          tipo: 'UMBRAL_CRITICO',
          severidad: 'ALTA',
        });
      }
    }

    for (const sintoma of borrador.sintomas) {
      const nivelGravedad = NIVEL_GRAVEDAD[sintoma.severidad];
      if (!nivelGravedad) throw new Error('Falta la intensidad del síntoma');

      await repos.sintomas.guardarSintoma({
        pacienteId,
        descripcion: sintoma.descripcion,
        nivelGravedad,
        reportadoEn: sintoma.ocurridoEn ?? cuando,
        ...origen,
      });
    }

    for (const toma of borrador.medicacion) {
      const medicamento = toma.nombre
        ? await repos.medicamentos.buscarPorNombre(pacienteId, toma.nombre)
        : null;

      await repos.dosisLogs.guardarTomaMedicamento({
        pacienteId,
        medicamentoId: medicamento?.id ?? null,
        nombreReportado: toma.nombre ?? null,
        tomada: toma.tomada,
        tomadaEn: toma.ocurridoEn ?? cuando,
        ...origen,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Callbacks
  // -------------------------------------------------------------------------

  function noVigente() {
    return { texto: TEXTO_NO_VIGENTE, aviso: 'Ya no está vigente', editarMensaje: false };
  }

  async function confirmar(chatId, estado, datos) {
    // El token se consume antes de guardar: conv:ok es de un solo uso.
    if (estado.token === null) {
      return { texto: TEXTO_YA_REGISTRADO, aviso: 'Ya quedó registrado', editarMensaje: false };
    }
    if (estado.estado !== ESTADOS.ESPERANDO_CONFIRMACION) {
      return {
        texto: 'Todavía no hay nada listo para guardar. Escríbeme cómo te sientes y lo preparo.',
        aviso: 'Sin nada que guardar',
        editarMensaje: false,
      };
    }
    if (estado.token !== String(datos.token ?? '')) return noVigente();

    const { paciente, mensaje } = await contextoPaciente(chatId);
    if (!paciente) return { texto: mensaje, editarMensaje: false };

    const borrador = estado.borrador;
    guardarEstado(chatId, { ...estado, token: null, pendienteSeveridad: null });

    try {
      await persistir(paciente.id, borrador, estado.mensajes);
    } catch (error) {
      registrarError('guardar el borrador', error);
      // El guardado es atómico: no quedó nada a medias. Se restaura el borrador
      // con su token para que el paciente pueda reintentar con el mismo botón.
      guardarEstado(chatId, estado);
      return {
        texto:
          'No pude guardar el registro en este momento. Intenta de nuevo con «Sí, guardar» en un rato.',
        aviso: 'No se pudo guardar',
        editarMensaje: false,
      };
    }

    // Se deja un estado INACTIVO (token null): un segundo clic se reconoce como
    // "ya quedó registrado", no como "expiró".
    guardarEstado(chatId, {
      estado: ESTADOS.INACTIVO,
      modo: 'libre',
      borrador: borradorVacio(),
      mensajes: [],
      token: null,
      pendienteSeveridad: null,
    });
    // Lo ya guardado no debe volver a extraerse como "contexto".
    olvidarContexto(chatId);

    // El reporte terminó: el canal vuelve a poner el menú principal en la barra.
    return {
      texto: resumenGuardado(borrador),
      editarMensaje: true,
      aviso: 'Guardado',
      mostrarMenu: true,
    };
  }

  async function corregir(chatId, estado) {
    if (estado.estado !== ESTADOS.ESPERANDO_CONFIRMACION) return noVigente();

    guardarEstado(chatId, {
      ...estado,
      estado: ESTADOS.CORRIGIENDO,
      modo: 'libre',
      token: generarToken(),
      pendienteSeveridad: null,
    });

    return {
      texto:
        'Está bien, no guardé nada. Escríbeme de nuevo lo que quieres registrar y reemplazo lo anterior.',
      editarMensaje: true,
    };
  }

  async function omitir(chatId, estado) {
    if (!esPasoDePregunta(estado.estado)) return noVigente();

    const { paciente, mensaje } = await contextoPaciente(chatId);
    if (!paciente) return { texto: mensaje, editarMensaje: false };

    const siguiente = {
      ...estado,
      estado: SIGUIENTE_PASO[estado.estado],
      pendienteSeveridad: null,
    };
    const respuesta = await continuar(chatId, paciente, siguiente);
    return { ...respuesta, editarMensaje: true };
  }

  async function elegirSeveridad(chatId, estado, datos) {
    const valor = Number(datos.valor);
    if (![1, 2, 3].includes(valor)) {
      return {
        texto: 'Esa intensidad no es válida. Elige leve, moderado o fuerte.',
        aviso: 'Opción inválida',
        editarMensaje: false,
      };
    }

    const indice = Number(datos.indice);
    if (estado.pendienteSeveridad === null || estado.pendienteSeveridad !== indice) {
      return noVigente();
    }

    const sintoma = estado.borrador.sintomas[indice];
    if (!sintoma) return noVigente();

    const { paciente, mensaje } = await contextoPaciente(chatId);
    if (!paciente) return { texto: mensaje, editarMensaje: false };

    const borrador = {
      ...estado.borrador,
      sintomas: estado.borrador.sintomas.map((previo, posicion) =>
        posicion === indice ? { ...previo, severidad: valor } : previo
      ),
    };

    const respuesta = await continuar(chatId, paciente, {
      ...estado,
      borrador,
      pendienteSeveridad: null,
    });
    return { ...respuesta, editarMensaje: true };
  }

  // -------------------------------------------------------------------------
  // API pública
  // -------------------------------------------------------------------------

  /** Arranca el flujo guiado (`/reportar`). */
  async function iniciar({ chatId } = {}) {
    const { paciente, mensaje } = await contextoPaciente(chatId);
    if (!paciente) return { texto: mensaje };

    const previo = leerEstado(chatId);
    const reinicio = previo && !estaVacio(previo.borrador);

    const estado = guardarEstado(chatId, estadoNuevo('guiado'));
    const pregunta = await preguntaDePaso(paciente, estado);

    return {
      texto: unir(
        reinicio
          ? 'Empezamos de nuevo; lo anterior no se guardó.'
          : 'Vamos a registrar cómo te sientes hoy.',
        pregunta.texto
      ),
      botones: pregunta.botones,
      opcionesRapidas: pregunta.opcionesRapidas,
    };
  }

  /** Texto libre. Puede contener medicación, mediciones y síntomas a la vez. */
  async function procesarMensaje({ chatId, texto } = {}) {
    const { paciente, mensaje } = await contextoPaciente(chatId);
    if (!paciente) return { texto: mensaje };

    const limpio = String(texto ?? '').trim();
    if (!limpio) {
      return { texto: 'No me llegó texto. Escríbeme lo que quieres registrar.' };
    }

    // "Nada que reportar" (escrito o tocado en la barra) salta el paso guiado.
    const enCurso = leerEstado(chatId);
    if (enCurso && esPasoDePregunta(enCurso.estado) && esOmitir(limpio)) {
      return { ...(await omitir(chatId, enCurso)), editarMensaje: false };
    }

    const anonimizado = anonimizar(limpio, { nombres: [paciente.alias] });
    const momento = new Date(relojMs());
    const contexto = leerContexto(chatId);

    let extraccion;
    try {
      extraccion = await extractor.extraer(anonimizado, {
        ahora: momento,
        zonaHoraria: zonaDe(paciente),
        contexto,
      });
    } catch (error) {
      registrarError('la extracción', error);
      return { texto: TEXTO_ERROR_EXTRACCION };
    }
    recordarMensaje(chatId, anonimizado);

    const { validos, rechazados } = validar(extraccion, { ahora: momento });
    const avisos = motivosDeRechazo(rechazados);
    const estado = leerEstado(chatId);

    if (contarValidos(validos) === 0) {
      // DK-205: pregunta médica sin datos que registrar -> no opina.
      if (parecePregunta(limpio)) return { texto: TEXTO_CONSULTA_MEDICA };

      if (estado && esPasoDePregunta(estado.estado)) {
        const pregunta = await preguntaDePaso(paciente, estado);
        return {
          texto: unir(avisos, TEXTO_NO_ENTENDI, pregunta.texto),
          botones: pregunta.botones,
          opcionesRapidas: pregunta.opcionesRapidas,
        };
      }
      return { texto: unir(avisos, TEXTO_NO_ENTENDI) };
    }

    const base = estado ?? estadoNuevo('libre');
    const corrigiendo = base.estado === ESTADOS.CORRIGIENDO;
    const borrador = fusionarBorrador(corrigiendo ? borradorVacio() : base.borrador, validos);

    const mensajesPrevios = corrigiendo ? [] : (base.mensajes ?? []);
    const siguiente = {
      ...base,
      borrador,
      mensajes: [...mensajesPrevios, anonimizado],
      pendienteSeveridad: null,
    };

    if (corrigiendo) {
      // Lo reescrito reemplaza lo anterior y va directo al resumen.
      siguiente.estado = ESTADOS.INACTIVO;
      siguiente.modo = 'libre';
    } else if (siguiente.modo === 'guiado' && SIGUIENTE_PASO[siguiente.estado]) {
      siguiente.estado = SIGUIENTE_PASO[siguiente.estado];
    }

    return continuar(chatId, paciente, siguiente, avisos);
  }

  /** Botones: `conv:ok`, `conv:no`, `conv:skip`, `sev`. */
  async function procesarCallback({ chatId, accion, token, indice, valor } = {}) {
    const estado = leerEstado(chatId);
    if (!estado) return noVigente();

    if (accion === 'ok') return confirmar(chatId, estado, { token });

    if (estado.token === null || estado.token !== String(token ?? '')) return noVigente();

    if (accion === 'no') return corregir(chatId, estado);
    if (accion === 'skip') return omitir(chatId, estado);
    if (accion === 'sev') return elegirSeveridad(chatId, estado, { indice, valor });

    return {
      texto: 'Esa opción no la reconozco. Escríbeme lo que quieres registrar.',
      aviso: 'Opción desconocida',
      editarMensaje: false,
    };
  }

  /** `/cancelar`: se descarta lo que había a medias y no se guarda nada. */
  async function cancelar({ chatId } = {}) {
    almacenEstado.limpiar(chatId);
    olvidarContexto(chatId);
    return {
      texto: 'Listo, cancelé lo que estábamos registrando. No guardé nada.',
      editarMensaje: false,
    };
  }

  return { iniciar, procesarMensaje, procesarCallback, cancelar };
}
