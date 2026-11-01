/**
 * Lógica de negocio del registro y del consentimiento.
 *
 * No conoce Telegraf ni sabe de botones: devuelve objetos simples que la capa
 * de canal se encarga de convertir en mensajes HTML y teclados.
 *
 * Forma de retorno de las funciones de flujo:
 *   { tipo: 'pregunta', paso, mensaje, opciones? }
 *   { tipo: 'resumen', paso: 'confirmar', mensaje }
 *   { tipo: 'error', mensaje, paso?, opciones? }
 *   { tipo: 'completado', mensaje, paciente }
 *   { tipo: 'ya_registrado', mensaje, paciente }
 *   { tipo: 'sin_sesion', mensaje }
 *   { tipo: 'requiere_consentimiento', mensaje }
 *
 * Los mensajes salen en texto plano (sin HTML): así un alias con `<` o `&`
 * nunca rompe el parseo de Telegram. El canal aplica HTML solo a sus textos fijos.
 */

import { patients, consentimiento, enfermedades, transaccion } from '../repositories/index.js';
import * as sesiones from './session.store.js';

export const VERSION_PRIVACIDAD = 'v1.0';

/** Reglas de validación del perfil (acordes a la recolección mínima de datos). */
export const EDAD_MINIMA = 1;
export const EDAD_MAXIMA = 110;
export const ALIAS_MIN = 2;
export const ALIAS_MAX = 100;

const PASOS = {
  ALIAS: 'alias',
  ANIO: 'anioNacimiento',
  ENFERMEDAD: 'enfermedad',
  CONFIRMAR: 'confirmar',
};

function chatIdNormalizado(telegramChatId) {
  if (telegramChatId === undefined || telegramChatId === null) return '';
  return String(telegramChatId);
}

export function anioActual() {
  return new Date().getFullYear();
}

// ---------------------------------------------------------------------------
// Registro del paciente y consentimiento
// ---------------------------------------------------------------------------

/** Primer contacto: crea el paciente si no existe y dice si falta consentimiento. */
export async function iniciar(telegramChatId) {
  const paciente = await patients.findOrCreate(chatIdNormalizado(telegramChatId));
  return {
    paciente,
    requiereConsentimiento: !paciente.consentimientoVigente,
  };
}

export async function registrarConsentimiento(telegramChatId, aceptado) {
  const paciente = await patients.findOrCreate(chatIdNormalizado(telegramChatId));
  await consentimiento.registrar({
    pacienteId: paciente.id,
    aceptado: Boolean(aceptado),
    versionPrivacidad: VERSION_PRIVACIDAD,
  });

  if (!aceptado) {
    // Si dijo que no, no queda nada a medias en memoria.
    sesiones.borrar(chatIdNormalizado(telegramChatId));
  }

  return patients.findById(paciente.id);
}

export async function aceptarConsentimiento(telegramChatId) {
  return registrarConsentimiento(telegramChatId, true);
}

export async function rechazarConsentimiento(telegramChatId) {
  return registrarConsentimiento(telegramChatId, false);
}

/**
 * Paciente con el que SÍ se puede operar: existe, está ACTIVO y tiene
 * consentimiento vigente. Sin esto, la regla del proyecto prohíbe guardar nada.
 */
export async function obtenerPacienteActivo(telegramChatId) {
  const paciente = await patients.findByTelegramChatId(chatIdNormalizado(telegramChatId));
  if (!paciente) return null;
  if (paciente.estado !== 'ACTIVO') return null;
  if (!paciente.consentimientoVigente) return null;
  return paciente;
}

export async function catalogoEnfermedades() {
  return enfermedades.listar();
}

/** Perfil completo para /perfil. Devuelve null si no hay paciente. */
export async function obtenerPerfil(telegramChatId) {
  const paciente = await patients.findByTelegramChatId(chatIdNormalizado(telegramChatId));
  if (!paciente) return null;

  const diagnosticadas = paciente.consentimientoVigente
    ? await enfermedades.listarPorPaciente(paciente.id)
    : [];

  return { paciente, enfermedades: diagnosticadas };
}

export function tieneRegistroEnCurso(telegramChatId) {
  return sesiones.existe(chatIdNormalizado(telegramChatId));
}

// ---------------------------------------------------------------------------
// Flujo guiado de registro
// ---------------------------------------------------------------------------

function siguientePaso(datos) {
  if (!datos.alias) return PASOS.ALIAS;
  if (!datos.anioNacimiento) return PASOS.ANIO;
  if (!datos.enfermedadId) return PASOS.ENFERMEDAD;
  return PASOS.CONFIRMAR;
}

async function preguntaDe(sesion) {
  const { paso } = sesion;

  if (paso === PASOS.ALIAS) {
    return {
      tipo: 'pregunta',
      paso,
      mensaje:
        '¿Cómo te llamas o cómo quieres que te llame? Un apodo está bien; no necesito tu nombre completo.',
    };
  }

  if (paso === PASOS.ANIO) {
    return {
      tipo: 'pregunta',
      paso,
      mensaje: `¿En qué año naciste? Escríbelo con 4 dígitos, por ejemplo ${anioActual() - 40}.`,
    };
  }

  if (paso === PASOS.ENFERMEDAD) {
    const opciones = await enfermedades.listar();
    return {
      tipo: 'pregunta',
      paso,
      mensaje: '¿Cuál de estas enfermedades crónicas te diagnosticaron?',
      opciones: opciones.map(({ id, nombre }) => ({ id, nombre })),
    };
  }

  return resumenDe(sesion);
}

async function resumenDe(sesion) {
  const { datos } = sesion;
  const catalogo = await enfermedades.listar();
  const enfermedad = catalogo.find((item) => item.id === datos.enfermedadId);
  const edad = anioActual() - datos.anioNacimiento;

  return {
    tipo: 'resumen',
    paso: PASOS.CONFIRMAR,
    mensaje: [
      'Revisa tus datos:',
      '',
      `Apodo: ${datos.alias}`,
      `Edad aproximada: ${edad} años`,
      `Enfermedad: ${enfermedad ? enfermedad.nombre : 'sin definir'}`,
      '',
      '¿Los guardo?',
    ].join('\n'),
  };
}

/**
 * Arranca (o retoma) el registro guiado.
 * Si ya tiene perfil completo, no vuelve a preguntar.
 */
export async function iniciarRegistro(telegramChatId) {
  const chatId = chatIdNormalizado(telegramChatId);
  const paciente = await obtenerPacienteActivo(chatId);
  if (!paciente) {
    return {
      tipo: 'requiere_consentimiento',
      mensaje: 'Primero necesito que aceptes el aviso de privacidad.',
    };
  }

  const yaRegistradas = await enfermedades.listarPorPaciente(paciente.id);
  if (paciente.alias && paciente.anioNacimiento && yaRegistradas.length > 0) {
    return {
      tipo: 'ya_registrado',
      mensaje: `Ya tengo tu registro, ${paciente.alias}. Escríbeme cuando quieras y seguimos.`,
      paciente,
    };
  }

  // Retoma lo que ya estaba guardado para no volver a preguntar todo.
  const previa = sesiones.obtener(chatId);
  const datos = {
    pacienteId: paciente.id,
    alias: previa?.datos?.alias ?? paciente.alias ?? null,
    anioNacimiento: previa?.datos?.anioNacimiento ?? paciente.anioNacimiento ?? null,
    enfermedadId: previa?.datos?.enfermedadId ?? yaRegistradas[0]?.id ?? null,
  };

  const sesion = sesiones.guardar(chatId, { paso: siguientePaso(datos), datos });
  return preguntaDe(sesion);
}

/**
 * Procesa un mensaje de texto mientras hay un registro en curso.
 * El paso `enfermedad` solo avanza con botones; el `confirmar`, con el botón.
 */
export async function procesarTexto(telegramChatId, texto) {
  const chatId = chatIdNormalizado(telegramChatId);
  const sesion = sesiones.obtener(chatId);
  if (!sesion) {
    return {
      tipo: 'sin_sesion',
      mensaje: 'No tengo un registro en curso. Escribe /registrar para empezar.',
    };
  }

  const limpio = String(texto ?? '').trim();

  if (sesion.paso === PASOS.ALIAS) {
    if (limpio.length < ALIAS_MIN || limpio.length > ALIAS_MAX) {
      return {
        tipo: 'error',
        paso: PASOS.ALIAS,
        mensaje: `Necesito entre ${ALIAS_MIN} y ${ALIAS_MAX} caracteres. ¿Cómo te llamo?`,
      };
    }
    if (/^\/\w+/.test(limpio)) {
      return {
        tipo: 'error',
        paso: PASOS.ALIAS,
        mensaje: 'Eso parece un comando. Escribe un apodo o usa /cancelar para salir.',
      };
    }
    sesion.datos.alias = limpio;
  } else if (sesion.paso === PASOS.ANIO) {
    const anio = Number.parseInt(limpio, 10);
    const minimo = anioActual() - EDAD_MAXIMA;
    const maximo = anioActual() - EDAD_MINIMA;

    if (!/^\d{4}$/.test(limpio) || Number.isNaN(anio) || anio < minimo || anio > maximo) {
      return {
        tipo: 'error',
        paso: PASOS.ANIO,
        mensaje: `Necesito un año de 4 dígitos entre ${minimo} y ${maximo}. Por ejemplo ${anioActual() - 40}.`,
      };
    }
    sesion.datos.anioNacimiento = anio;
  } else if (sesion.paso === PASOS.ENFERMEDAD) {
    const opciones = await enfermedades.listar();
    return {
      tipo: 'error',
      paso: PASOS.ENFERMEDAD,
      mensaje: 'Para este paso toca una de las opciones de abajo.',
      opciones: opciones.map(({ id, nombre }) => ({ id, nombre })),
    };
  } else {
    // Está en `confirmar`: solo avanza con el botón.
    return resumenDe(sesion);
  }

  sesion.paso = siguientePaso(sesion.datos);
  const actualizada = sesiones.guardar(chatId, sesion);
  return preguntaDe(actualizada);
}

/** Selección de enfermedad desde el teclado en línea (`enf:<uuid>`). */
export async function elegirEnfermedad(telegramChatId, enfermedadId) {
  const chatId = chatIdNormalizado(telegramChatId);
  const sesion = sesiones.obtener(chatId);
  if (!sesion) {
    return {
      tipo: 'sin_sesion',
      mensaje: 'No tengo un registro en curso. Escribe /registrar para empezar.',
    };
  }

  const catalogo = await enfermedades.listar();
  const enfermedad = catalogo.find((item) => item.id === String(enfermedadId ?? ''));
  if (!enfermedad) {
    return {
      tipo: 'error',
      paso: PASOS.ENFERMEDAD,
      mensaje: 'Esa opción ya no está disponible. Elige una de la lista.',
      opciones: catalogo.map(({ id, nombre }) => ({ id, nombre })),
    };
  }

  sesion.datos.enfermedadId = enfermedad.id;
  sesion.paso = PASOS.CONFIRMAR;
  const actualizada = sesiones.guardar(chatId, sesion);
  return resumenDe(actualizada);
}

/** Guarda el perfil. Este es el único punto donde se escribe en la BD. */
export async function confirmarRegistro(telegramChatId) {
  const chatId = chatIdNormalizado(telegramChatId);
  const sesion = sesiones.obtener(chatId);

  if (!sesion) {
    return {
      tipo: 'sin_sesion',
      mensaje: 'El registro expiró. Escribe /registrar para empezar de nuevo.',
    };
  }
  if (sesion.paso !== PASOS.CONFIRMAR || !sesion.datos.pacienteId) {
    return {
      tipo: 'error',
      mensaje: 'Todavía faltan datos. Escribe /registrar para retomarlo.',
    };
  }

  const paciente = await patients.findById(sesion.datos.pacienteId);
  if (!paciente || !paciente.consentimientoVigente) {
    sesiones.borrar(chatId);
    return {
      tipo: 'requiere_consentimiento',
      mensaje: 'Necesito tu consentimiento vigente antes de guardar. Envía /start.',
    };
  }

  // Perfil y enfermedad se guardan juntos o no se guarda nada.
  const actualizado = await transaccion(async () => {
    const perfil = await patients.updatePerfil(paciente.id, {
      alias: sesion.datos.alias,
      anioNacimiento: sesion.datos.anioNacimiento,
    });
    await enfermedades.asignar({
      pacienteId: paciente.id,
      enfermedadId: sesion.datos.enfermedadId,
      diagnosticadaEn: null,
    });
    return perfil;
  });

  sesiones.borrar(chatId);

  return {
    tipo: 'completado',
    mensaje: `Listo, ${actualizado.alias}. Ya quedó tu registro.`,
    paciente: actualizado,
  };
}

export async function cancelarRegistro(telegramChatId) {
  return sesiones.borrar(chatIdNormalizado(telegramChatId));
}
