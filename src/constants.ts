// src/constants.ts
/** Version del servidor. Un test la compara con package.json para que nunca diverjan. */
export const VERSION = "5.0.0";

function entero(nombre: string, porDefecto: number, min: number, max: number): number {
  const crudo = process.env[nombre];
  if (crudo === undefined || crudo.trim() === "") return porDefecto;
  const n = Number(crudo);
  return Number.isInteger(n) && n >= min && n <= max ? n : porDefecto;
}

export const BASE_URL = (process.env.DGCP_API_URL ?? "https://datosabiertos.dgcp.gob.do/api-dgcp/v1").replace(/\/+$/, "");
export const PORTAL_URL = "https://comunidad.comprasdominicana.gob.do";

/**
 * Tiempo maximo por intento HTTP. La API suele responder en 0.3-1.5 s, pero algunas consultas
 * poco frecuentes (p. ej. articulos de una familia UNSPSC rara) tardan ~25 s en frio.
 */
export const REQUEST_TIMEOUT_MS = entero("DGCP_TIMEOUT_MS", 35_000, 1_000, 120_000);

/** Un timeout se reintenta solo una vez: repetir una consulta lenta no la hace mas rapida. */
export const MAX_REINTENTOS_TIMEOUT = 1;

/** Presupuesto de tiempo de una herramienta que lanza muchas consultas en paralelo. */
export const PRESUPUESTO_HERRAMIENTA_MS = entero("DGCP_PRESUPUESTO_MS", 20_000, 2_000, 50_000);

/** Reintentos ante 429, 5xx, timeouts y errores de red (las consultas son GET idempotentes). */
export const MAX_REINTENTOS = entero("DGCP_REINTENTOS", 3, 0, 6);

/**
 * Tope propio de peticiones por minuto. La API anuncia x-ratelimit-limit: 60, pero el contador
 * es por nodo del balanceador (70 peticiones seguidas nunca bajaron de 48 restantes). El tope
 * fijo es una red de seguridad; el control fino lo da x-ratelimit-remaining (ver dgcpClient).
 */
export const PETICIONES_POR_MINUTO = entero("DGCP_PETICIONES_POR_MINUTO", 120, 1, 600);

/** Si la API informa que quedan estas peticiones o menos, se pausa hasta x-ratelimit-reset. */
export const RESERVA_RATELIMIT = 3;

/** Peticiones simultaneas en vuelo como maximo. */
export const CONCURRENCIA_MAXIMA = entero("DGCP_CONCURRENCIA", 6, 1, 16);

/** Registros por pagina. /procesos documenta un maximo de 1000; el resto lo acepta igual. */
export const LIMITE_API = 1000;

/**
 * Cache en memoria. El Data Warehouse de la DGCP solo cambia 4 veces al dia, asi que
 * 10 minutos no agregan atraso perceptible y evitan repetir descargas en una misma conversacion.
 */
export const CACHE_TTL_MS = entero("DGCP_CACHE_TTL_MS", 10 * 60_000, 0, 6 * 3_600_000);
export const CACHE_CATALOGOS_TTL_MS = 6 * 3_600_000;
export const CACHE_MAX_BYTES = entero("DGCP_CACHE_MAX_MB", 96, 8, 1024) * 1024 * 1024;

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_RESPONSE_CHARS = 24_000;

/** Ventana por defecto (dias) cuando una busqueda no trae ningun filtro que la API pueda aplicar. */
export const VENTANA_DIAS_POR_DEFECTO = 30;

/** Paginas de 1000 registros que una sola herramienta puede descargar como maximo. */
export const MAX_PAGINAS_POR_CONSULTA = entero("DGCP_MAX_PAGINAS", 6, 1, 40);
