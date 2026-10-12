// src/utils/texto.ts

/** Corrige acentos mal codificados (UTF-8 leido como Latin-1) que aparecen en registros historicos. */
export function fixEncoding(text: unknown): string {
  if (typeof text !== "string") return String(text ?? "");
  if (!/[ÃÂâ�]/.test(text)) return text;
  return text
    .replace(/Ã¡/g, "á").replace(/Ã©/g, "é").replace(/Ã­/g, "í")
    .replace(/Ã³/g, "ó").replace(/Ãº/g, "ú").replace(/Ã±/g, "ñ")
    .replace(/Ã\u0081/g, "Á").replace(/Ã\u0089/g, "É").replace(/Ã\u008D/g, "Í")
    .replace(/Ã\u0093/g, "Ó").replace(/Ã\u009A/g, "Ú").replace(/Ã\u0091/g, "Ñ")
    .replace(/Ã¼/g, "ü").replace(/Â/g, "")
    .replace(/â\u0080\u009C|â\u0080\u009D/g, '"')
    .replace(/â\u0080\u0099|â\u0080\u0098/g, "'")
    .replace(/â\u0080\u0093|â\u0080\u0094/g, "-")
    .replace(/�/g, "");
}

/** Minusculas, sin acentos, espacios colapsados. Base de toda comparacion de texto. */
export function normalizar(s: unknown): string {
  return fixEncoding(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Deja solo digitos (RNC, cedula, telefonos). */
export function soloDigitos(valor?: unknown): string {
  return String(valor ?? "").replace(/[^0-9]/g, "");
}

/** Alias historico usado por las pruebas y herramientas: limpia un RNC o cedula. */
export const limpiarRNC = soloDigitos;

/**
 * Separa una consulta en terminos alternativos. "software, licencias; laptop" -> 3 terminos.
 * Un registro coincide si contiene CUALQUIERA de ellos (OR).
 */
export function terminosAlternativos(consulta?: string): string[] {
  if (!consulta) return [];
  return consulta
    .split(/[,;|]/)
    .map((t) => normalizar(t))
    .filter((t) => t.length > 0);
}

/** true si alguno de los campos contiene alguno de los terminos (sin acentos ni mayusculas). */
export function contieneAlguno(campos: unknown[], terminos: string[]): boolean {
  if (terminos.length === 0) return true;
  const texto = campos.map((c) => normalizar(c)).join(" \u0001 ");
  return terminos.some((t) => texto.includes(t));
}

/** true si `palabra` aparece como palabra completa en `texto` (ambos se normalizan). */
export function contienePalabra(texto: unknown, palabra: string): boolean {
  const t = normalizar(texto);
  const p = normalizar(palabra).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!p) return false;
  return new RegExp(`(^|[^a-z0-9])${p}([^a-z0-9]|$)`).test(t);
}

export function formatMonto(monto?: unknown, moneda = "DOP"): string {
  if (monto === undefined || monto === null || monto === "") return "N/D";
  const n = typeof monto === "number" ? monto : parseFloat(String(monto));
  if (!Number.isFinite(n)) return "N/D";
  return `${moneda} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPct(valor: number, decimales = 1): string {
  return Number.isFinite(valor) ? `${valor.toFixed(decimales)}%` : "N/D";
}

export function numero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string" && valor.trim() !== "") {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Suma segura de un campo numerico. */
export function sumar<T>(items: T[], campo: (x: T) => unknown): number {
  let s = 0;
  for (const it of items) s += numero(campo(it)) ?? 0;
  return s;
}

/** Mediana y cuartiles de una lista (los valores no finitos se ignoran). */
export function estadisticos(valores: number[]): { n: number; min: number; p25: number; mediana: number; p75: number; max: number } | null {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const q = (p: number) => {
    const pos = (v.length - 1) * p;
    const base = Math.floor(pos);
    const resto = pos - base;
    return v[base + 1] !== undefined ? v[base] + resto * (v[base + 1] - v[base]) : v[base];
  };
  return { n: v.length, min: v[0], p25: q(0.25), mediana: q(0.5), p75: q(0.75), max: v[v.length - 1] };
}

/** Recorta texto largo dejando aviso. */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) +
    "\n\n*(Respuesta recortada por longitud. Reduce 'limite' o filtra por un termino mas especifico.)*";
}

export function recortar(texto: unknown, max: number): string {
  const s = fixEncoding(texto).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Escapa barras verticales para que el texto no rompa una tabla Markdown. */
export function celda(texto: unknown, max = 80): string {
  return recortar(texto, max).replace(/\|/g, "/");
}
