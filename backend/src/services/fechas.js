/**
 * Fechas en la zona horaria del paciente (DK-202).
 *
 * La BD guarda todo en UTC (decisión D7). Aquí se traduce entre "las 9 de la
 * noche de ayer en Guadalajara" y un instante UTC, sin librerías externas:
 * solo `Intl.DateTimeFormat`, que ya conoce las zonas IANA.
 */

const formatos = new Map();

function formatoDe(zona) {
  if (!formatos.has(zona)) {
    formatos.set(
      zona,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zona,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
    );
  }
  return formatos.get(zona);
}

/** ¿Es una zona IANA que el motor conoce? */
export function zonaValida(zona) {
  if (typeof zona !== 'string' || !zona) return false;
  try {
    formatoDe(zona);
    return true;
  } catch {
    return false;
  }
}

/**
 * Partes de la fecha local de un instante en una zona.
 * @returns {{ anio: number, mes: number, dia: number, hora: number, minuto: number }}
 */
export function partesEnZona(fecha, zona) {
  const partes = Object.fromEntries(
    formatoDe(zona)
      .formatToParts(new Date(fecha))
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)])
  );
  return {
    anio: partes.year,
    mes: partes.month,
    dia: partes.day,
    hora: partes.hour,
    minuto: partes.minute,
  };
}

/**
 * Instante UTC de una fecha y hora locales en `zona`. Tolera días u horas
 * fuera de rango (día 0 = último del mes anterior), como `Date.UTC`.
 *
 * @returns {Date}
 */
export function localAUtc({ anio, mes, dia, hora = 0, minuto = 0 }, zona) {
  const objetivo = Date.UTC(anio, mes - 1, dia, hora, minuto);
  let estimado = objetivo;
  // Dos pasadas bastan incluso en cambios de horario.
  for (let i = 0; i < 2; i += 1) {
    const p = partesEnZona(estimado, zona);
    const visto = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto);
    estimado += objetivo - visto;
  }
  return new Date(estimado);
}

/** "2026-11-10T21:30" en la zona indicada. */
export function formatoLocal(fecha, zona) {
  const p = partesEnZona(fecha, zona);
  const dos = (n) => String(n).padStart(2, '0');
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}T${dos(p.hora)}:${dos(p.minuto)}`;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

/**
 * Convierte "YYYY-MM-DDTHH:mm" (hora local del paciente) a ISO UTC.
 * Devuelve `null` si el texto no tiene ese formato o la fecha no existe.
 */
export function localTextoAIsoUtc(texto, zona) {
  const coincidencia = LOCAL_RE.exec(String(texto ?? '').trim());
  if (!coincidencia) return null;

  const [anio, mes, dia, hora, minuto] = coincidencia.slice(1).map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59) return null;

  // Rechaza fechas imposibles como 31 de febrero.
  const dePrueba = new Date(Date.UTC(anio, mes - 1, dia));
  if (dePrueba.getUTCMonth() !== mes - 1) return null;

  return localAUtc({ anio, mes, dia, hora, minuto }, zona).toISOString();
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Texto corto para el resumen: "hoy 16:00", "ayer 21:00" o "lun 2 nov, 9:00".
 */
export function describirMomento(fecha, ahora, zona) {
  const p = partesEnZona(fecha, zona);
  const hoy = partesEnZona(ahora, zona);
  const hora = `${p.hora}:${String(p.minuto).padStart(2, '0')}`;

  const diaDe = (x) => Date.UTC(x.anio, x.mes - 1, x.dia);
  const diferencia = Math.round((diaDe(hoy) - diaDe(p)) / 86_400_000);

  if (diferencia === 0) return `hoy ${hora}`;
  if (diferencia === 1) return `ayer ${hora}`;

  const diaSemana = DIAS[new Date(diaDe(p)).getUTCDay()];
  return `${diaSemana} ${p.dia} ${MESES[p.mes - 1]}, ${hora}`;
}
