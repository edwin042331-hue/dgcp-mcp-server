// src/constants.ts
export const BASE_URL = "https://datosabiertos.dgcp.gob.do/api-dgcp/v1";
export const DEFAULT_PAGE_SIZE = 10;
export const REQUEST_TIMEOUT_MS = 35_000;
export const MAX_RESPONSE_CHARS = 18_000;

// Cuantas paginas de la API se descargan para filtrar localmente.
export const PAGINAS_A_ESCANEAR = 5;
export const TAMANO_PAGINA_API = 100;

// Concurrencia de descarga paralela de paginas
export const CONCURRENCIA_DESCARGA = 4;

// Cache en memoria (TTL en milisegundos = 5 minutos)
export const CACHE_TTL_MS = 5 * 60 * 1000;

// ============================================================================
// UMBRALES OFICIALES DGCP (Marco Normativo Ley 340-06 y Resoluciones de la DGCP)
// ============================================================================
export const UMBRALES_BIENES_SERVICIOS = {
  LICITACION_PUBLICA_MIN: 5_564_754.00,
  COMPARACION_PRECIOS_MIN: 1_669_426.00,
  COMPARACION_PRECIOS_MAX: 5_564_753.99,
  COMPRAS_MENORES_MIN: 222_590.00,
  COMPRAS_MENORES_MAX: 1_669_425.99,
  DEBAJO_UMBRAL_MAX: 222_589.99,
};

export const UMBRALES_OBRAS = {
  LICITACION_PUBLICA_MIN: 400_000_000.00,
  SORTEO_OBRAS_MAX: 300_000_000.00,
  COMPARACION_PRECIOS_MIN: 40_000_000.00,
  COMPARACION_PRECIOS_MAX: 399_999_999.99,
  COMPRAS_MENORES_MAX: 40_000_000.00,
};

// Porcentajes de Garantías Legales
export const GARANTIA_SERIEDAD_OFERTA_PCT = 0.01;        // 1% del monto de la oferta (LPN y CP)
export const GARANTIA_FIEL_CUMPLIMIENTO_PCT = 0.04;      // 4% del monto del contrato (General)
export const GARANTIA_FIEL_CUMPLIMIENTO_MIPYME_PCT = 0.01; // 1% para MIPYMES (Decreto 416-23)
export const ANTICIPO_MAXIMO_PCT = 0.20;                 // 20% maximo anticipo de ley
