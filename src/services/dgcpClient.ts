// src/services/dgcpClient.ts
//
// Cliente HTTP de la API de datos abiertos de la DGCP.
// - Respeta el limite de tasa de la API: tope propio de ventana deslizante + concurrencia acotada,
//   y pausa adaptativa segun x-ratelimit-remaining / x-ratelimit-reset.
// - Reintenta 429 / 5xx / timeouts / errores de red con backoff exponencial y jitter,
//   honrando Retry-After y x-ratelimit-reset.
// - Deduplica peticiones identicas en vuelo y cachea respuestas (LRU acotada por bytes).
// - Usa los filtros del lado del servidor que la API documenta (proceso, rpe, unidad_compra,
//   estado, fechas...), en vez de descargar paginas a ciegas y filtrar localmente.
import {
  BASE_URL, REQUEST_TIMEOUT_MS, MAX_REINTENTOS, PETICIONES_POR_MINUTO, CONCURRENCIA_MAXIMA,
  CACHE_TTL_MS, CACHE_MAX_BYTES, LIMITE_API, MAX_PAGINAS_POR_CONSULTA, VERSION, MAX_REINTENTOS_TIMEOUT, RESERVA_RATELIMIT,
} from "../constants.js";
import { CacheLRU } from "./cache.js";
import { LimitadorTasa, relojReal, type Reloj } from "./limitador.js";
import type { QueryParams, PaginatedResult } from "../types.js";

export class DgcpApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
  ) {
    super(message);
    this.name = "DgcpApiError";
  }
}

const ESTADOS_REINTENTABLES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

interface Dependencias {
  fetch: typeof fetch;
  reloj: Reloj;
  aleatorio: () => number;
}

let deps: Dependencias = { fetch: (input, init) => fetch(input, init), reloj: relojReal, aleatorio: Math.random };
let limitador = new LimitadorTasa(PETICIONES_POR_MINUTO, 60_000, CONCURRENCIA_MAXIMA, deps.reloj);
const cache = new CacheLRU<unknown>(CACHE_MAX_BYTES);
const enVuelo = new Map<string, Promise<unknown>>();

/** Solo para pruebas: inyecta fetch/reloj y reinicia limitador, cache y peticiones en vuelo. */
export function __configurarParaPruebas(parcial: Partial<Dependencias> & { peticionesPorMinuto?: number }): void {
  deps = { ...deps, ...parcial };
  limitador = new LimitadorTasa(parcial.peticionesPorMinuto ?? PETICIONES_POR_MINUTO, 60_000, CONCURRENCIA_MAXIMA, deps.reloj);
  clearCache();
}

export function clearCache(): void {
  cache.limpiar();
  enVuelo.clear();
}

export function construirUrl(endpoint: string, params: QueryParams = {}): string {
  const url = new URL(`${BASE_URL}/${endpoint.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.append(k, String(v));
  }
  return url.toString();
}

function esperaSugerida(res: Response, ahora: number): number | null {
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) {
    const s = Number(retryAfter);
    if (Number.isFinite(s)) return Math.max(0, s * 1000);
    const fecha = Date.parse(retryAfter);
    if (!Number.isNaN(fecha)) return Math.max(0, fecha - ahora);
  }
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (res.status === 429 && Number.isFinite(reset) && reset > 0) return Math.min(reset, 60) * 1000;
  return null;
}

function backoff(intento: number): number {
  const base = Math.min(8_000, 400 * 2 ** intento);
  return base / 2 + deps.aleatorio() * (base / 2);
}

export interface OpcionesPeticion {
  /** Timeout por intento (default REQUEST_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Reintentos maximos (default MAX_REINTENTOS). */
  reintentos?: number;
}

async function unIntento(url: string, endpoint: string, como: "json" | "texto", timeoutMs: number): Promise<{ valor: unknown; bytes: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await deps.fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: como === "json" ? "application/json" : "text/csv, text/plain, */*",
        "User-Agent": `dgcp-mcp-server/${VERSION} (+https://github.com/edwin042331-hue/dgcp-mcp-server)`,
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const abortado = err instanceof Error && err.name === "AbortError";
    throw new DgcpApiError(
      abortado
        ? `La API DGCP no respondio en ${Math.round(timeoutMs / 1000)} s (/${endpoint}).`
        : `Error de red con la API DGCP (/${endpoint}): ${err instanceof Error ? err.message : String(err)}`,
      abortado ? 408 : 0,
      endpoint,
    );
  }

  try {
    if (!res.ok) {
      const espera = esperaSugerida(res, deps.reloj.ahora());
      if (res.status === 429) limitador.pausarHasta(deps.reloj.ahora() + (espera ?? 60_000));
      const err = new DgcpApiError(`La API DGCP respondio HTTP ${res.status} en /${endpoint}.`, res.status, endpoint);
      (err as DgcpApiError & { esperaMs?: number }).esperaMs = espera ?? undefined;
      throw err;
    }
    // Control adaptativo: si la API avisa que quedan pocas peticiones, pausar hasta el reinicio.
    const restantes = Number(res.headers.get("x-ratelimit-remaining"));
    const reinicio = Number(res.headers.get("x-ratelimit-reset"));
    if (res.headers.has("x-ratelimit-remaining") && Number.isFinite(restantes) && restantes <= RESERVA_RATELIMIT) {
      limitador.pausarHasta(deps.reloj.ahora() + (Number.isFinite(reinicio) && reinicio > 0 ? Math.min(reinicio, 60) : 60) * 1000);
    }
    const cuerpo = await res.text();
    if (como === "texto") return { valor: cuerpo, bytes: cuerpo.length };
    let json: unknown;
    try {
      json = JSON.parse(cuerpo);
    } catch {
      throw new DgcpApiError(`Respuesta no JSON en /${endpoint}.`, res.status, endpoint);
    }
    const r = json as { hasError?: unknown; message?: unknown };
    if (r && r.hasError === true) {
      throw new DgcpApiError(`La API DGCP reporto un error en /${endpoint}: ${String(r.message ?? "sin detalle")}`, res.status, endpoint);
    }
    return { valor: json, bytes: cuerpo.length };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new DgcpApiError(`La API DGCP no termino de responder en ${Math.round(timeoutMs / 1000)} s (/${endpoint}).`, 408, endpoint);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function conReintentos(url: string, endpoint: string, como: "json" | "texto", op: OpcionesPeticion): Promise<{ valor: unknown; bytes: number }> {
  const maxReintentos = op.reintentos ?? MAX_REINTENTOS;
  const timeoutMs = op.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let ultimo: unknown;
  for (let intento = 0; intento <= maxReintentos; intento++) {
    try {
      return await limitador.ejecutar(() => unIntento(url, endpoint, como, timeoutMs));
    } catch (err) {
      ultimo = err;
      const status = err instanceof DgcpApiError ? err.statusCode ?? 0 : 0;
      const reintentable = status === 0 || ESTADOS_REINTENTABLES.has(status);
      const tope = status === 408 ? Math.min(maxReintentos, MAX_REINTENTOS_TIMEOUT) : maxReintentos;
      if (!reintentable || intento >= tope) break;
      const sugerida = (err as { esperaMs?: number }).esperaMs;
      // En 429 el limitador ya quedo pausado; aqui solo se espera el backoff.
      await deps.reloj.dormir(status === 429 ? 0 : Math.max(sugerida ?? 0, backoff(intento)));
    }
  }
  throw ultimo;
}

async function obtener(endpoint: string, params: QueryParams, como: "json" | "texto", ttlMs: number, op: OpcionesPeticion = {}): Promise<unknown> {
  const url = construirUrl(endpoint, params);
  const enCache = cache.get(url);
  if (enCache !== undefined) return enCache;
  const pendiente = enVuelo.get(url);
  if (pendiente) return pendiente;

  const promesa = conReintentos(url, endpoint, como, op)
    .then(({ valor, bytes }) => {
      cache.set(url, valor, ttlMs, bytes);
      return valor;
    })
    .finally(() => enVuelo.delete(url));
  enVuelo.set(url, promesa);
  return promesa;
}

/**
 * Espera una promesa como maximo `ms`. Si vence, devuelve `undefined` sin cancelarla: la
 * descarga sigue en segundo plano y queda en cache para la siguiente consulta.
 */
export async function conPlazo<T>(promesa: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const vencido = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); });
  promesa.catch(() => undefined);
  try {
    return await Promise.race([promesa, vencido]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ejecuta tareas con concurrencia acotada y un presupuesto total de tiempo. Devuelve el resultado
 * de cada tarea en su posicion, o `undefined` si no termino a tiempo o fallo. Acotar la
 * concurrencia evita que una herramienta pesada acapare los cupos y bloquee a las demas.
 */
export async function ejecutarConPresupuesto<T>(
  tareas: Array<(restanteMs: number) => Promise<T>>,
  concurrencia: number,
  presupuestoMs: number,
): Promise<Array<T | undefined>> {
  const resultados: Array<T | undefined> = new Array(tareas.length).fill(undefined);
  const limite = Date.now() + presupuestoMs;
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < tareas.length) {
      const restante = limite - Date.now();
      if (restante <= 0) return;
      const k = siguiente++;
      resultados[k] = await conPlazo(tareas[k](restante).catch(() => undefined), restante);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrencia, tareas.length)) }, trabajador));
  return resultados;
}

/** GET JSON con cache, reintentos y limite de tasa. */
export async function dgcpGet<T>(endpoint: string, params: QueryParams = {}, ttlMs: number = CACHE_TTL_MS, op: OpcionesPeticion = {}): Promise<T> {
  return (await obtener(endpoint, params, "json", ttlMs, op)) as T;
}

/** GET de texto plano (archivos CSV de /tablas). */
export async function dgcpGetTexto(endpoint: string, params: QueryParams = {}, ttlMs: number = CACHE_TTL_MS): Promise<string> {
  return (await obtener(endpoint, params, "texto", ttlMs)) as string;
}

/**
 * Forma real de la respuesta paginada:
 * { code, hasError, payload: { content: [...] | null }, page, limit, totalResults, pages }
 * Cuando no hay resultados, la API omite totalResults y devuelve content: null.
 */
export function normalizePaginated<T>(raw: unknown, page: number, per_page: number): PaginatedResult<T> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const payload = r.payload as Record<string, unknown> | unknown[] | undefined;

  const candidato =
    (Array.isArray(payload) ? payload : (payload as Record<string, unknown> | undefined)?.content) ??
    r.data ?? r.results ?? (Array.isArray(raw) ? raw : []);
  const items = (Array.isArray(candidato) ? candidato : []) as T[];

  const total =
    typeof r.totalResults === "number" ? r.totalResults :
    typeof r.total === "number" ? r.total :
    items.length;

  const total_pages =
    typeof r.pages === "number" ? r.pages : Math.max(1, Math.ceil(total / per_page));

  return { items, total, page, per_page, has_more: page < total_pages, total_pages };
}

export interface ListadoResult<T> {
  items: T[];
  /** Total de registros que la API reporta para ese filtro. */
  total: number;
  paginasTotales: number;
  paginasDescargadas: number;
  /** Paginas que fallaron tras agotar reintentos (el resultado es parcial si hay alguna). */
  paginasFallidas: number[];
  /** true si se descargo el universo completo del filtro. */
  completo: boolean;
}

/**
 * Descarga todos los registros de un filtro del lado del servidor, en paginas de 1000,
 * hasta `maxPaginas`. Si la primera pagina falla, lanza error (nunca devuelve un vacio
 * silencioso que la herramienta confundiria con "no hay resultados").
 */
export async function dgcpListar<T>(
  endpoint: string,
  filtros: QueryParams = {},
  opciones: { maxPaginas?: number; limite?: number; ttlMs?: number } & OpcionesPeticion = {},
): Promise<ListadoResult<T>> {
  const op: OpcionesPeticion = { timeoutMs: opciones.timeoutMs, reintentos: opciones.reintentos };
  const limite = opciones.limite ?? LIMITE_API;
  const maxPaginas = Math.max(1, opciones.maxPaginas ?? MAX_PAGINAS_POR_CONSULTA);

  const primera = normalizePaginated<T>(await dgcpGet(endpoint, { ...filtros, page: 1, limit: limite }, opciones.ttlMs, op), 1, limite);
  const paginasTotales = primera.items.length === 0 ? 0 : primera.total_pages;
  const hasta = Math.min(paginasTotales, maxPaginas);

  const paginasFallidas: number[] = [];
  const restantes: Promise<T[]>[] = [];
  for (let p = 2; p <= hasta; p++) {
    restantes.push(
      dgcpGet(endpoint, { ...filtros, page: p, limit: limite }, opciones.ttlMs, op)
        .then((raw) => normalizePaginated<T>(raw, p, limite).items)
        .catch((err: unknown) => {
          paginasFallidas.push(p);
          console.error(`[dgcp] pagina ${p} de /${endpoint} fallo tras reintentos:`, err instanceof Error ? err.message : err);
          return [] as T[];
        }),
    );
  }
  const resto = await Promise.all(restantes);
  paginasFallidas.sort((a, b) => a - b);

  const items = primera.items.concat(...resto);
  return {
    items,
    total: Math.max(primera.total, items.length),
    paginasTotales,
    paginasDescargadas: hasta - paginasFallidas.length,
    paginasFallidas,
    completo: hasta >= paginasTotales && paginasFallidas.length === 0,
  };
}
