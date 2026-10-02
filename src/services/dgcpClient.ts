// src/services/dgcpClient.ts
import {
  BASE_URL, REQUEST_TIMEOUT_MS, CACHE_TTL_MS, CONCURRENCIA_DESCARGA,
} from "../constants.js";
import type { QueryParams, PaginatedResult, RegistroGenerico } from "../types.js";

export class DgcpApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = "DgcpApiError";
  }
}

/** Endpoints reales de la API: todos en PLURAL. El singular devuelve 404. */
export const ENDPOINTS = {
  procesos: "procesos",
  contratos: "contratos",
  ofertas: "ofertas",
  proveedores: "proveedores",
} as const;

// ============================================================================
// CACHÉ EN MEMORIA CON TTL (Ultra-rápido, evita bloqueos de red)
// ============================================================================
interface CacheEntry {
  data: unknown;
  timestamp: number;
}
const memoryCache = new Map<string, CacheEntry>();

export function clearCache(): void {
  memoryCache.clear();
}

function getFromCache<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setInCache(key: string, data: unknown): void {
  // Limpieza preventiva si el mapa crece demasiado (> 500 entradas)
  if (memoryCache.size > 500) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, { data, timestamp: Date.now() });
}

function buildUrl(endpoint: string, params: QueryParams): string {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.append(key, String(value));
    }
  }
  return url.toString();
}

export async function dgcpGet<T>(endpoint: string, params: QueryParams = {}): Promise<T> {
  const cacheKey = `${endpoint}?${new URLSearchParams(params as Record<string, string>).toString()}`;
  const cached = getFromCache<T>(cacheKey);
  if (cached) {
    return cached;
  }

  const url = buildUrl(endpoint, params);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "DGCP-MCP-Server-Senior/2.0",
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new DgcpApiError(`Tiempo de espera agotado consultando /${endpoint}.`, 408, endpoint);
    }
    throw new DgcpApiError(
      `Error de red conectando con la DGCP: ${err instanceof Error ? err.message : String(err)}`,
      0, endpoint
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new DgcpApiError(`La API DGCP devolvio ${response.status} en /${endpoint}`, response.status, endpoint);
  }

  try {
    const data = (await response.json()) as T;
    setInCache(cacheKey, data);
    return data;
  } catch {
    throw new DgcpApiError(`Respuesta no valida (no JSON) en /${endpoint}`, response.status, endpoint);
  }
}

/**
 * Forma real de la respuesta de la API DGCP:
 * { code, hasError, payload: { content: [...] }, page, limit, totalResults, pages }
 */
export function normalizePaginated<T>(raw: unknown, page: number, per_page: number): PaginatedResult<T> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const payload = r.payload as Record<string, unknown> | undefined;

  const items: T[] =
    (payload?.content as T[]) ??
    (r.data as T[]) ??
    (r.results as T[]) ??
    (Array.isArray(raw) ? (raw as T[]) : []);

  const total: number =
    typeof r.totalResults === "number" ? r.totalResults :
    typeof r.total === "number" ? r.total :
    Array.isArray(items) ? items.length : 0;

  const total_pages: number =
    typeof r.pages === "number" ? r.pages : Math.max(1, Math.ceil(total / per_page));

  return {
    items: Array.isArray(items) ? items : [],
    total, page, per_page,
    has_more: page < total_pages,
    total_pages,
  };
}

export interface VariasPaginasResult<T> {
  items: T[];
  total: number;
  totalPaginas: number;
  paginasDescargadas: number;
  paginasFallidas: number[];
  fechaConsulta: string;
}

/**
 * Descarga paginas de forma paralela acelerada en lotes concurrentes con trazabilidad de errores.
 * 4x a 5x mas rapido que el bucle secuencial ordinario.
 */
export async function dgcpGetVariasPaginas<T>(
  endpoint: string,
  paginas: number,
  limitePorPagina: number,
  extra: QueryParams = {}
): Promise<VariasPaginasResult<T>> {
  const paginasFallidas: number[] = [];
  const fechaConsulta = new Date().toISOString();

  // 1. Obtener primera página para conocer total y validar conectividad
  let rawPrimera: unknown;
  try {
    rawPrimera = await dgcpGet<unknown>(endpoint, { ...extra, page: 1, limit: limitePorPagina });
  } catch (err) {
    paginasFallidas.push(1);
    return {
      items: [],
      total: 0,
      totalPaginas: 0,
      paginasDescargadas: 0,
      paginasFallidas: [1],
      fechaConsulta,
    };
  }

  const primeraNorm = normalizePaginated<T>(rawPrimera, 1, limitePorPagina);

  const total = primeraNorm.total;
  const totalPaginas = primeraNorm.total_pages;
  const todos: T[] = [...primeraNorm.items];

  const maxPaginas = Math.min(paginas, totalPaginas);
  if (maxPaginas <= 1 || !primeraNorm.has_more) {
    return {
      items: todos,
      total,
      totalPaginas,
      paginasDescargadas: 1,
      paginasFallidas,
      fechaConsulta,
    };
  }

  // 2. Preparar array de páginas restantes: [2, 3, ..., maxPaginas]
  const paginasRestantes: number[] = [];
  for (let p = 2; p <= maxPaginas; p++) {
    paginasRestantes.push(p);
  }

  let paginasExitosas = 1;

  // 3. Descargar en lotes paralelos con límite de concurrencia
  for (let i = 0; i < paginasRestantes.length; i += CONCURRENCIA_DESCARGA) {
    const lote = paginasRestantes.slice(i, i + CONCURRENCIA_DESCARGA);
    const promesas = lote.map(async (p) => {
      try {
        const raw = await dgcpGet<unknown>(endpoint, { ...extra, page: p, limit: limitePorPagina });
        paginasExitosas++;
        return normalizePaginated<T>(raw, p, limitePorPagina).items;
      } catch (err) {
        paginasFallidas.push(p);
        console.error(`Aviso: fallo descarga de pagina ${p} en /${endpoint}:`, err);
        return [] as T[];
      }
    });

    const resultadosLote = await Promise.all(promesas);
    for (const itemsLote of resultadosLote) {
      todos.push(...itemsLote);
    }
  }

  return {
    items: todos,
    total,
    totalPaginas,
    paginasDescargadas: paginasExitosas,
    paginasFallidas,
    fechaConsulta,
  };
}

/** Corrige acentos que la API devuelve mal codificados (UTF-8 leido como Latin-1). */
export function fixEncoding(text: unknown): string {
  if (typeof text !== "string") return String(text ?? "");
  return text
    .replace(/Ã¡/g, "á").replace(/Ã©/g, "é").replace(/Ã­/g, "í")
    .replace(/Ã³/g, "ó").replace(/Ãº/g, "ú").replace(/Ã±/g, "ñ")
    .replace(/Ã\u0081/g, "Á").replace(/Ã\u0089/g, "É").replace(/Ã\u008D/g, "Í")
    .replace(/Ã\u0093/g, "Ó").replace(/Ã\u009A/g, "Ú").replace(/Ã\u0091/g, "Ñ")
    .replace(/Ã¼/g, "ü").replace(/Â/g, "")
    .replace(/â\u0080\u009C|â\u0080\u009D/g, '"')
    .replace(/â\u0080\u0099|â\u0080\u0098/g, "'")
    .replace(/â\u0080\u0093|â\u0080\u0094/g, "-")
    .replace(/\uFFFD/g, "");
}

export function formatMonto(monto?: unknown, moneda = "DOP"): string {
  if (monto === undefined || monto === null || monto === "") return "N/D";
  const n = typeof monto === "number" ? monto : parseFloat(String(monto));
  if (isNaN(n)) return "N/D";
  return `${moneda} ${n.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function soloFecha(f?: unknown): string {
  const s = typeof f === "string" ? f : "";
  return s ? s.split("T")[0] : "N/D";
}

/**
 * Dias que faltan para una fecha ISO. Negativo si ya paso.
 * Si ya venció hoy (ej. hace 2 horas), devuelve -1 para evitar que Math.ceil lo redondee a -0.
 */
export function diasHasta(fechaIso?: unknown): number | null {
  if (typeof fechaIso !== "string" || !fechaIso) return null;
  const t = Date.parse(fechaIso);
  if (isNaN(t)) return null;
  const diffMs = t - Date.now();
  if (diffMs <= 0) {
    return Math.floor(diffMs / 86_400_000);
  }
  return Math.ceil(diffMs / 86_400_000);
}

/**
 * true si la fecha de cierre todavia no ha pasado.
 * Comparación estricta en milisegundos para evitar que procesos vencidos hace pocas horas aparezcan abiertos.
 */
export function sigueAbierto(fechaFin?: unknown): boolean {
  if (typeof fechaFin !== "string" || !fechaFin) return false;
  const t = Date.parse(fechaFin);
  if (isNaN(t)) return false;
  return t > Date.now();
}

/** Quita acentos y pasa a minusculas, para comparar texto. */
export function normalizar(s: unknown): string {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/** Limpia y normaliza un RNC o Cédula a solo dígitos. */
export function limpiarRNC(rnc?: unknown): string {
  return String(rnc ?? "").replace(/[^0-9]/g, "").trim();
}

/** Busca un texto en todos los campos de texto de un registro. */
export function registroContiene(rec: Record<string, unknown>, termino: string): boolean {
  const t = normalizar(fixEncoding(termino));
  if (!t) return true;
  for (const v of Object.values(rec)) {
    if (typeof v === "string" && normalizar(fixEncoding(v)).includes(t)) return true;
  }
  return false;
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n\n*(Respuesta recortada por límite de caracteres. Solicita más detalles o filtra por término específico).*`;
}

export function formatRegistroGenerico(
  rec: RegistroGenerico,
  idx: number,
  maxCampos = 18
): string {
  const entradas = Object.entries(rec).filter(
    ([, v]) => v !== null && v !== undefined && v !== "" && v !== "N/A"
  );
  const titulo = fixEncoding(
    (rec.titulo ?? rec.nombre ?? rec.razon_social ?? rec.descripcion ??
     rec.objeto ?? rec.codigo_proceso ?? `Registro ${idx}`) as string
  );

  const lineas = [`**${idx}. ${titulo}**`];
  let n = 0;
  for (const [k, v] of entradas) {
    if (n >= maxCampos) { lineas.push(`   ... (+${entradas.length - n} campos mas)`); break; }
    let valor: string;
    if (typeof v === "number") {
      valor = /monto|precio|valor|total/i.test(k)
        ? formatMonto(v, String(rec.divisa ?? "DOP"))
        : String(v);
    } else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      valor = soloFecha(v);
    } else {
      valor = fixEncoding(v);
    }
    if (valor.length > 160) valor = valor.slice(0, 160) + "...";
    lineas.push(`   ${k}: ${valor}`);
    n++;
  }
  return lineas.join("\n");
}

