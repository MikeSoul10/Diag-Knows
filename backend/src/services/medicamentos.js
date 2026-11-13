/**
 * Medicamentos del paciente y sus horarios (DK-302).
 *
 * El propio paciente da de alta su medicamento con un flujo guiado:
 *   nombre → dosis → hora(s) → resumen → «Sí, guardar» / «Corregir»
 * Nada se guarda hasta que confirma. Los horarios son hora LOCAL del paciente
 * y de ahí salen los recordatorios (`services/recordatorios.js`).
 *
 * No conoce Telegraf: devuelve `{ texto, botones?, editarMensaje?, aviso?,
 * mostrarMenu? }` con el texto en HTML de Telegram (datos del paciente escapados).
 */

import {
  patients,
  medicamentos as medicamentosRepo,
  horarios as horariosRepo,
  transaccion,
} from '../repositories/index.js';

/** Máximo de horas por medicamento (cuatro tomas al día). */
export const MAX_HORARIOS = 4;

/** Un alta abandonada se descarta sola. */
export const TTL_ALTA_MINUTOS = 15;

const PASOS = Object.freeze({
  NOMBRE: 'nombre',
  DOSIS: 'dosis',
  HORAS: 'horas',
  CONFIRMAR: 'confirmar',
});

const SIN_DOSIS = 'sin dosis';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function escapar(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** "08:00", "08:00 y 20:00", "08:00, 14:00 y 20:00". */
export function listarHoras(horas) {
  if (horas.length <= 1) return horas.join('');
  return `${horas.slice(0, -1).join(', ')} y ${horas.at(-1)}`;
}

const HORA_RE =
  /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.? ?m\.?|p\.? ?m\.?|de la manana|de la tarde|de la noche|de la madrugada)?$/;

function parsearHora(pieza) {
  const limpio = pieza
    .replace(/^(?:a las|a la|las|la)\s+/, '')
    .replace(/\s*(?:hrs?|horas?|h)\.?$/, '')
    .trim();

  if (limpio === 'mediodia') return '12:00';
  if (limpio === 'medianoche') return '00:00';

  const coincidencia = HORA_RE.exec(limpio);
  if (!coincidencia) return null;

  let hora = Number(coincidencia[1]);
  const minuto = Number(coincidencia[2] ?? 0);
  const sufijo = (coincidencia[3] ?? '').replace(/[.\s]/g, '');
  if (hora > 23 || minuto > 59) return null;

  const esTarde = ['pm', 'delatarde', 'delanoche'].includes(sufijo);
  const esManana = ['am', 'delamanana', 'delamadrugada'].includes(sufijo);
  if (sufijo && hora > 12) return null; // "15 pm" no tiene sentido
  if (esTarde && hora < 12) hora += 12;
  if (esManana && hora === 12) hora = 0;

  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
}

/**
 * Lee una o varias horas: "8", "08:00", "8 am", "8:30 pm", "8 de la noche",
 * "mediodía", "8 y 20", "8:00, 14:00 y 20:00".
 *
 * @returns {string[]|null} horas "HH:MM" únicas y ordenadas, o null si algo no se entiende.
 */
export function parsearHoras(texto) {
  const limpio = normalizar(texto);
  if (!limpio) return null;

  const piezas = limpio.split(/\s*(?:,|;|\/|\by\b|\be\b)\s*/).filter(Boolean);
  if (piezas.length === 0) return null;

  const horas = [];
  for (const pieza of piezas) {
    const hora = parsearHora(pieza);
    if (!hora) return null;
    if (!horas.includes(hora)) horas.push(hora);
  }
  return horas.sort();
}

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

/**
 * @param {object} [dependencias]
 * @param {object} [dependencias.repos] `{ patients, medicamentos, horarios, transaccion }`
 * @param {() => Date} [dependencias.ahora] Reloj inyectable (caducidad del alta).
 */
export function crearServicioMedicamentos({
  repos = { patients, medicamentos: medicamentosRepo, horarios: horariosRepo, transaccion },
  ahora = () => new Date(),
} = {}) {
  /** @type {Map<string, { paso: string, datos: object, actualizadoEn: number }>} */
  const altas = new Map();
  const relojMs = () => new Date(ahora()).getTime();
  const clave = (chatId) => String(chatId ?? '');

  function leerAlta(chatId) {
    const alta = altas.get(clave(chatId));
    if (!alta) return null;
    if (relojMs() - alta.actualizadoEn > TTL_ALTA_MINUTOS * 60 * 1000) {
      altas.delete(clave(chatId));
      return null;
    }
    return alta;
  }

  function guardarAlta(chatId, alta) {
    altas.set(clave(chatId), { ...alta, actualizadoEn: relojMs() });
  }

  async function pacienteActivo(chatId) {
    const paciente = await repos.patients.findByTelegramChatId(clave(chatId));
    if (!paciente || paciente.estado !== 'ACTIVO' || !paciente.consentimientoVigente) return null;
    return paciente;
  }

  function resumen(datos) {
    const dosis = datos.dosis === SIN_DOSIS ? 'sin especificar' : escapar(datos.dosis);
    return {
      texto: [
        '<b>Revisa tu medicamento:</b>',
        '',
        `Medicamento: <b>${escapar(datos.nombre)}</b>`,
        `Dosis: ${dosis}`,
        `Recordatorio: todos los días a las ${listarHoras(datos.horas)}`,
        '',
        '¿Lo guardo?',
      ].join('\n'),
      botones: [
        [{ texto: '✅ Sí, guardar', callback: 'med:ok' }],
        [{ texto: '✏️ Corregir', callback: 'med:no' }],
      ],
    };
  }

  // -------------------------------------------------------------------------
  // API pública
  // -------------------------------------------------------------------------

  /** «Mis medicamentos»: lo registrado y el botón para agregar otro. */
  async function listar({ chatId } = {}) {
    const paciente = await pacienteActivo(chatId);
    if (!paciente) return { sinConsentimiento: true };

    const [meds, horarios] = await Promise.all([
      repos.medicamentos.listarPorPaciente(paciente.id),
      repos.horarios.listarPorPaciente(paciente.id),
    ]);

    const botones = [[{ texto: '➕ Agregar medicamento', callback: 'med:nuevo' }]];
    if (meds.length === 0) {
      return {
        texto:
          'Todavía no tienes medicamentos registrados. Agrega uno y te aviso a la hora de tomarlo.',
        botones,
      };
    }

    const lineas = meds.map((med) => {
      const horas = horarios
        .filter((horario) => horario.medicamentoId === med.id)
        .map((horario) => horario.horaProgramada);
      const dosis = med.dosis && med.dosis !== SIN_DOSIS ? ` ${escapar(med.dosis)}` : '';
      const cuando = horas.length > 0 ? `⏰ ${listarHoras(horas)}` : 'sin recordatorio';
      return `• <b>${escapar(med.nombre)}</b>${dosis} — ${cuando}`;
    });

    return {
      texto: [
        '<b>Tus medicamentos</b>',
        '',
        ...lineas,
        '',
        'A esas horas te mando un recordatorio para que me digas si lo tomaste.',
      ].join('\n'),
      botones,
    };
  }

  async function iniciarAlta({ chatId } = {}) {
    const paciente = await pacienteActivo(chatId);
    if (!paciente) return { sinConsentimiento: true };

    guardarAlta(chatId, { paso: PASOS.NOMBRE, datos: { pacienteId: paciente.id } });
    return {
      texto: 'Vamos a agregar un medicamento. ¿Cómo se llama? Por ejemplo: <i>Metformina</i>.',
      // Desde el botón de la lista: se manda aparte y la lista se queda.
      editarMensaje: false,
    };
  }

  function tieneAltaEnCurso(chatId) {
    return leerAlta(chatId) !== null;
  }

  async function procesarTexto({ chatId, texto } = {}) {
    const alta = leerAlta(chatId);
    if (!alta) return { texto: 'No tengo un alta de medicamento en curso.' };

    const limpio = String(texto ?? '').trim();

    if (alta.paso === PASOS.NOMBRE) {
      if (limpio.length < 2 || limpio.length > 60 || !/\p{L}/u.test(limpio)) {
        return { texto: 'Escribe solo el nombre del medicamento, por ejemplo: Metformina.' };
      }
      guardarAlta(chatId, { paso: PASOS.DOSIS, datos: { ...alta.datos, nombre: limpio } });
      return {
        texto: `¿Qué dosis tomas de <b>${escapar(limpio)}</b>? Por ejemplo: <i>850 mg</i> o <i>1 tableta</i>. Si no sabes, escribe «no sé».`,
      };
    }

    if (alta.paso === PASOS.DOSIS) {
      if (!limpio || limpio.length > 60) {
        return { texto: 'Escribe la dosis en pocas palabras, por ejemplo: 850 mg.' };
      }
      const sinDosis = /^(no se|no lo se|no recuerdo|ninguna|nada)$/.test(normalizar(limpio));
      guardarAlta(chatId, {
        paso: PASOS.HORAS,
        datos: { ...alta.datos, dosis: sinDosis ? SIN_DOSIS : limpio },
      });
      return {
        texto:
          '¿A qué hora te toca? Por ejemplo: <i>08:00</i>, <i>8 de la noche</i> o, si son varias, <i>8:00 y 20:00</i>.',
      };
    }

    if (alta.paso === PASOS.HORAS) {
      const horas = parsearHoras(limpio);
      if (!horas) {
        return {
          texto:
            'No entendí la hora. Escríbela como <i>08:00</i>, <i>8 pm</i> o <i>8:00 y 20:00</i>.',
        };
      }
      if (horas.length > MAX_HORARIOS) {
        return {
          texto: `Puedo recordarte hasta ${MAX_HORARIOS} veces al día. Escribe menos horas.`,
        };
      }
      const datos = { ...alta.datos, horas };
      guardarAlta(chatId, { paso: PASOS.CONFIRMAR, datos });
      return resumen(datos);
    }

    // CONFIRMAR: el paciente escribió en vez de tocar un botón.
    return {
      ...resumen(alta.datos),
      texto: `Toca un botón para continuar.\n\n${resumen(alta.datos).texto}`,
    };
  }

  /** «Sí, guardar»: el único punto donde se escribe en la BD. */
  async function confirmar({ chatId } = {}) {
    const alta = leerAlta(chatId);
    if (!alta || alta.paso !== PASOS.CONFIRMAR) {
      return {
        texto: 'Ese alta ya no está vigente. Toca «Mis medicamentos» para empezar de nuevo.',
        aviso: 'Ya no está vigente',
        editarMensaje: false,
      };
    }

    const { pacienteId, nombre, dosis, horas } = alta.datos;
    // Se consume antes de guardar: un segundo clic no duplica el medicamento.
    altas.delete(clave(chatId));

    try {
      await repos.transaccion(async () => {
        const med = await repos.medicamentos.crear({
          pacienteId,
          nombre,
          dosis,
          frecuencia: `Diario ${horas.join(', ')}`,
        });
        for (const hora of horas) {
          await repos.horarios.crear({ medicamentoId: med.id, horaProgramada: hora });
        }
      });
    } catch (error) {
      guardarAlta(chatId, alta); // se puede reintentar con el mismo botón
      throw error;
    }

    return {
      texto: `✅ Listo, guardé <b>${escapar(nombre)}</b>. Te recordaré todos los días a las ${listarHoras(horas)}.`,
      editarMensaje: true,
      aviso: 'Guardado',
      mostrarMenu: true,
    };
  }

  /** «Corregir»: empieza de nuevo sin guardar nada. */
  async function corregir({ chatId } = {}) {
    const alta = leerAlta(chatId);
    if (!alta) {
      return {
        texto: 'Ese alta ya no está vigente.',
        aviso: 'Ya no está vigente',
        editarMensaje: false,
      };
    }
    guardarAlta(chatId, { paso: PASOS.NOMBRE, datos: { pacienteId: alta.datos.pacienteId } });
    return {
      texto: 'Está bien, no guardé nada. Empecemos de nuevo: ¿cómo se llama tu medicamento?',
      editarMensaje: true,
    };
  }

  /** Descarta el alta a medias. Devuelve true si había una. */
  function cancelar({ chatId } = {}) {
    return altas.delete(clave(chatId));
  }

  return { listar, iniciarAlta, tieneAltaEnCurso, procesarTexto, confirmar, corregir, cancelar };
}

/** Instancia que usa el bot. */
export const servicioMedicamentos = crearServicioMedicamentos();
