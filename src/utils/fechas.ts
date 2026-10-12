// src/utils/fechas.ts
//
// La API DGCP entrega las fechas con sufijo "Z", pero los valores son hora local de
// Republica Dominicana (UTC-04:00, sin horario de verano). Verificado contra el portal
// transaccional: el proceso MIP-CCC-LPN-2026-0005 figura publicado el 12/10/2026
// 08:00:40 (UTC-04:00) y la API lo entrega como "2026-10-12T08:00:40.03Z".
// Interpretar esas fechas como UTC desplaza cada cierre 4 horas antes de tiempo.

export const OFFSET_RD_MS = -4 * 3_600_000;
const DIA_MS = 86_400_000;

/** Cortes diarios del Data Warehouse de la DGCP (hora RD), segun la documentacion oficial de la API. */
export const CORTES_DW_HORAS_RD = [0, 7, 14, 21] as const;

const RE_FECHA_API = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?Z?$/;

/** Convierte una fecha de la API DGCP (hora RD rotulada como UTC) a epoch en milisegundos. */
export function parseFechaDGCP(valor: unknown): number | null {
  if (typeof valor !== "string" || !valor) return null;
  const s = valor.trim();
  const m = RE_FECHA_API.exec(s);
  if (m) {
    const fraccion = m[3] ? m[3].slice(0, 4).padEnd(4, "0") : "";
    const t = Date.parse(`${m[1]}T${m[2]}${fraccion}-04:00`);
    return Number.isNaN(t) ? null : t;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(`${s}T00:00:00-04:00`);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Partes de calendario de un instante, vistas en hora de Republica Dominicana. */
function partesRD(epochMs: number): { y: number; m: number; d: number; h: number; min: number; dow: number } {
  const local = new Date(epochMs + OFFSET_RD_MS);
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    h: local.getUTCHours(),
    min: local.getUTCMinutes(),
    dow: local.getUTCDay(),
  };
}

const dos = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" del instante dado, en hora RD. */
export function fechaISORD(epochMs: number = Date.now()): string {
  const p = partesRD(epochMs);
  return `${p.y}-${dos(p.m)}-${dos(p.d)}`;
}

/** Suma dias de calendario a una fecha "YYYY-MM-DD". */
export function sumarDias(fechaISO: string, dias: number): string {
  const t = Date.parse(`${fechaISO}T00:00:00Z`) + dias * DIA_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** Instante (epoch ms) en hora RD legible: "2026-10-12 08:00". */
export function formatEpochRD(epochMs: number): string {
  const p = partesRD(epochMs);
  return `${p.y}-${dos(p.m)}-${dos(p.d)} ${dos(p.h)}:${dos(p.min)}`;
}

/** Fecha de la API en hora RD legible: "2026-10-12 08:00". "N/D" si no hay fecha valida. */
export function formatFechaHoraRD(valor: unknown): string {
  const t = parseFechaDGCP(valor);
  return t === null ? "N/D" : formatEpochRD(t);
}

/** Solo la fecha RD: "2026-10-12". */
export function soloFecha(valor: unknown): string {
  const t = parseFechaDGCP(valor);
  return t === null ? "N/D" : fechaISORD(t);
}

/** Milisegundos que faltan para la fecha (negativo si ya paso). null si no hay fecha. */
export function msHasta(valor: unknown, ahora: number = Date.now()): number | null {
  const t = parseFechaDGCP(valor);
  return t === null ? null : t - ahora;
}

/**
 * Dias que faltan para una fecha. Negativo si ya paso.
 * Un cierre vencido hace minutos devuelve -1 (nunca 0 ni -0); uno que vence en horas devuelve 1.
 */
export function diasHasta(valor: unknown, ahora: number = Date.now()): number | null {
  const diff = msHasta(valor, ahora);
  if (diff === null) return null;
  return diff <= 0 ? Math.floor(diff / DIA_MS) : Math.ceil(diff / DIA_MS);
}

/** true si la fecha todavia no ha llegado. */
export function sigueAbierto(valor: unknown, ahora: number = Date.now()): boolean {
  const diff = msHasta(valor, ahora);
  return diff !== null && diff > 0;
}

/** Texto de cuenta regresiva: "cierra en 3 dias", "cierra en 5 h", "CERRADO hace 2 dias". */
export function cuentaRegresiva(valor: unknown, ahora: number = Date.now()): string {
  const diff = msHasta(valor, ahora);
  if (diff === null) return "sin fecha de cierre";
  const horas = Math.abs(diff) / 3_600_000;
  if (diff > 0) {
    if (horas < 1) return "CIERRA EN MENOS DE 1 HORA";
    if (horas < 48) return `cierra en ${Math.floor(horas)} h`;
    return `cierra en ${Math.floor(horas / 24)} dias`;
  }
  if (horas < 48) return `CERRADO hace ${Math.max(1, Math.floor(horas))} h`;
  return `CERRADO hace ${Math.floor(horas / 24)} dias`;
}

/**
 * Dias habiles (lunes a viernes) transcurridos entre dos instantes, contando desde el dia
 * siguiente a la publicacion hasta el dia del cierre inclusive (regla del Art. 101 Ley 47-25
 * y circular DGCP44-PNP-2026-0003: "contados a partir del dia siguiente de la publicacion").
 *
 * No descuenta feriados: el resultado es una cota SUPERIOR. Si aun asi queda por debajo del
 * minimo legal, el incumplimiento es cierto; si queda por encima, un feriado podria anularlo.
 */
export function diasHabilesEntre(desde: unknown, hasta: unknown): number | null {
  const a = parseFechaDGCP(desde);
  const b = parseFechaDGCP(hasta);
  if (a === null || b === null || b < a) return null;
  let dia = sumarDias(fechaISORD(a), 1);
  const fin = fechaISORD(b);
  let habiles = 0;
  // Tope defensivo: ningun procedimiento dura mas de 3 anos entre convocatoria y cierre.
  for (let i = 0; dia <= fin && i < 1100; i++) {
    const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) habiles++;
    dia = sumarDias(dia, 1);
  }
  return habiles;
}

/** Ultimo corte del Data Warehouse DGCP anterior o igual a `ahora`, como epoch ms. */
export function ultimoCorteDW(ahora: number = Date.now()): number {
  const p = partesRD(ahora);
  const hoy = `${p.y}-${dos(p.m)}-${dos(p.d)}`;
  const hora = [...CORTES_DW_HORAS_RD].reverse().find((h) => h <= p.h) ?? 0;
  return Date.parse(`${hoy}T${dos(hora)}:00:00-04:00`);
}

/** Proximo corte del Data Warehouse DGCP posterior a `ahora`, como epoch ms. */
export function proximoCorteDW(ahora: number = Date.now()): number {
  const p = partesRD(ahora);
  const hoy = `${p.y}-${dos(p.m)}-${dos(p.d)}`;
  const hora = CORTES_DW_HORAS_RD.find((h) => h > p.h);
  if (hora !== undefined) return Date.parse(`${hoy}T${dos(hora)}:00:00-04:00`);
  return Date.parse(`${sumarDias(hoy, 1)}T00:00:00-04:00`);
}

/** Linea de frescura de datos para incluir en cada respuesta. */
export function notaFrescura(ahora: number = Date.now()): string {
  return (
    `Datos DGCP al corte de ${formatEpochRD(ultimoCorteDW(ahora))} (hora RD). ` +
    `La API se actualiza a las 00:00, 07:00, 14:00 y 21:00; proximo corte: ${formatEpochRD(proximoCorteDW(ahora))}. ` +
    `Lo publicado en el portal despues del ultimo corte aun no aparece aqui.`
  );
}
