// src/normativa.ts
//
// Fuente unica de verdad normativa. Cada cifra esta atada al articulo que la establece,
// verificado contra los textos oficiales:
//  - Ley num. 47-25 de Contrataciones Publicas (G. O. 11204, 29-jul-2025). Deroga la Ley 340-06,
//    la Ley 449-06, la Ley 6-21 y el Decreto 416-23 (Art. 247). Vigencia: 180 dias despues de su
//    promulgacion y publicacion (Art. 248).
//  - Decreto num. 52-26, Reglamento de Aplicacion de la Ley 47-25 (G. O. 11231, 31-ene-2026).
//  - Resolucion DGCP num. PNP-03-2026 (25-mar-2026): umbrales 2026, vigentes desde el 1-abr-2026.
//  - Circular DGCP44-PNP-2026-0003 (8-jun-2026): plazos en el SECP.
//
// Regimen transitorio (Art. 245 Ley 47-25): los procedimientos iniciados antes de la entrada en
// vigencia siguen las leyes vigentes al momento de su convocatoria (Ley 340-06 y Dec. 416-23).

import { parseFechaDGCP } from "./utils/fechas.js";
import { normalizar } from "./utils/texto.js";

export const FUENTES = {
  ley: "Ley num. 47-25 de Contrataciones Publicas (G. O. 11204)",
  reglamento: "Decreto num. 52-26, Reglamento de Aplicacion de la Ley 47-25 (G. O. 11231)",
  umbrales: "Resolucion DGCP num. PNP-03-2026 (umbrales 2026, vigentes desde el 1-abr-2026)",
  leyAnterior: "Ley num. 340-06 y su Reglamento (Decreto 416-23), para procedimientos convocados antes de la Ley 47-25",
} as const;

/**
 * Las fuentes oficiales difieren en el dia exacto de entrada en vigencia (24 a 29 de enero de 2026,
 * segun se cuente desde la promulgacion o la publicacion). Antes de INICIO_TRANSICION el regimen es
 * con certeza la Ley 340-06; desde FIN_TRANSICION, con certeza la Ley 47-25; en medio se indica revisar.
 */
export const INICIO_TRANSICION = "2026-01-24";
export const FIN_TRANSICION = "2026-01-30";

export type Regimen = "ley_47_25" | "ley_340_06" | "transicion";

export function regimenAplicable(fechaConvocatoria: unknown): Regimen {
  const t = parseFechaDGCP(fechaConvocatoria);
  if (t === null) return "ley_47_25";
  if (t < Date.parse(`${INICIO_TRANSICION}T00:00:00-04:00`)) return "ley_340_06";
  if (t < Date.parse(`${FIN_TRANSICION}T00:00:00-04:00`)) return "transicion";
  return "ley_47_25";
}

export function describirRegimen(r: Regimen): string {
  switch (r) {
    case "ley_47_25": return "Ley 47-25 y Reglamento Dec. 52-26";
    case "ley_340_06": return "Ley 340-06 y Dec. 416-23 (regimen transitorio, Art. 245 Ley 47-25)";
    case "transicion": return "Convocado en la semana de entrada en vigencia de la Ley 47-25: verificar en el pliego si aplica la Ley 47-25 o la 340-06";
  }
}

// ============================================================================
// UMBRALES 2026 (Resolucion PNP-03-2026). Montos en DOP.
// ============================================================================
export const UMBRALES_2026 = {
  bienes_servicios: {
    LICITACION_PUBLICA_MIN: 6_436_757.51,
    CONTRATACION_SIMPLIFICADA_MIN: 2_010_835.38,
    CONTRATACION_MENOR_MIN: 268_111.38,
    DIRECTA_SUJETA_UMBRAL_MAX: 268_111.37,
  },
  obras: {
    LICITACION_PUBLICA_MIN: 406_713_345.70,
    SORTEO_OBRAS_MIN: 201_083_538.48,
    CONTRATACION_SIMPLIFICADA_MIN: 53_622_276.93,
    CONTRATACION_MENOR_MAX: 53_622_276.92,
  },
} as const;

export type TipoObjeto = "bienes_servicios" | "obras";

export interface ModalidadLegal {
  clave: "licitacion_publica" | "sorteo_obras" | "contratacion_simplificada" | "contratacion_menor" | "directa_sujeta_umbral";
  nombre: string;
  /** Minimo de dias habiles entre convocatoria y recepcion de ofertas (Art. 101 Ley 47-25). */
  plazoMinimoDiasHabiles: number;
  nota?: string;
}

/**
 * Modalidad que corresponde al monto (Art. 59 P. I: la del umbral inmediatamente inferior al
 * presupuesto). El Art. 59 P. II permite usar una modalidad de umbral superior, nunca una inferior.
 */
export function modalidadPorMonto(monto: number, tipo: TipoObjeto): ModalidadLegal {
  if (tipo === "bienes_servicios") {
    const u = UMBRALES_2026.bienes_servicios;
    if (monto >= u.LICITACION_PUBLICA_MIN) {
      return {
        clave: "licitacion_publica",
        nombre: "Licitacion Publica",
        plazoMinimoDiasHabiles: 30,
        nota: "Para bienes y servicios comunes y estandarizados puede usarse Licitacion Publica Abreviada (Art. 62), con minimo de 15 dias habiles (Art. 101.2).",
      };
    }
    if (monto >= u.CONTRATACION_SIMPLIFICADA_MIN) {
      return {
        clave: "contratacion_simplificada",
        nombre: "Contratacion Simplificada (antes Comparacion de Precios)",
        plazoMinimoDiasHabiles: 5,
        nota: "5 dias habiles para bienes y servicios comunes y estandarizados; 10 si no lo son (Art. 101.5).",
      };
    }
    if (monto >= u.CONTRATACION_MENOR_MIN) {
      return { clave: "contratacion_menor", nombre: "Contratacion Menor", plazoMinimoDiasHabiles: 3 };
    }
    return {
      clave: "directa_sujeta_umbral",
      nombre: "Contratacion Directa Sujeta al Umbral (antes Compras por Debajo del Umbral)",
      plazoMinimoDiasHabiles: 0,
      nota: "Sin plazo minimo entre publicacion y adjudicacion (Art. 101, parrafo).",
    };
  }
  const u = UMBRALES_2026.obras;
  if (monto >= u.LICITACION_PUBLICA_MIN) {
    return { clave: "licitacion_publica", nombre: "Licitacion Publica de Obras", plazoMinimoDiasHabiles: 30 };
  }
  if (monto >= u.SORTEO_OBRAS_MIN) {
    return {
      clave: "sorteo_obras",
      nombre: "Sorteo de Obras",
      plazoMinimoDiasHabiles: 5,
      nota: "Aplica a obras no complejas y reparaciones menores; las obras complejas van por licitacion publica.",
    };
  }
  if (monto >= u.CONTRATACION_SIMPLIFICADA_MIN) {
    return {
      clave: "contratacion_simplificada",
      nombre: "Contratacion Simplificada de Obras",
      plazoMinimoDiasHabiles: 5,
      nota: "Obras no complejas y reparaciones menores (Art. 101.5.a).",
    };
  }
  return { clave: "contratacion_menor", nombre: "Contratacion Menor de Obras", plazoMinimoDiasHabiles: 3 };
}

/** Rango de jerarquia: mayor numero = modalidad mas exigente. */
const RANGO: Record<ModalidadLegal["clave"], number> = {
  directa_sujeta_umbral: 0,
  contratacion_menor: 1,
  contratacion_simplificada: 2,
  sorteo_obras: 3,
  licitacion_publica: 4,
};

/**
 * Reconoce la modalidad tal como la escribe la API o el usuario (nombres del SECP antiguos y nuevos).
 * Devuelve null para excepciones o textos no reconocibles.
 */
export function claveModalidad(texto: unknown): ModalidadLegal["clave"] | null {
  const t = normalizar(texto);
  if (!t) return null;
  if (t.includes("excepcion") || t.includes("emergencia") || t.includes("urgencia")) return null;
  if (t.includes("licitacion")) return "licitacion_publica";
  if (t.includes("sorteo")) return "sorteo_obras";
  if (t.includes("simplificada") || t.includes("comparacion")) return "contratacion_simplificada";
  if (t.includes("debajo") || t.includes("directa")) return "directa_sujeta_umbral";
  if (t.includes("menor")) return "contratacion_menor";
  return null;
}

/** true si la modalidad usada es MENOS exigente que la que corresponde por monto (indicio del Art. 81). */
export function modalidadInferiorALaLegal(modalidadUsada: unknown, legal: ModalidadLegal): boolean | null {
  const usada = claveModalidad(modalidadUsada);
  if (usada === null) return null;
  return RANGO[usada] < RANGO[legal.clave];
}

/**
 * Plazo minimo legal entre convocatoria y cierre segun la modalidad registrada en la API
 * (Art. 101 Ley 47-25; excepciones: Art. 152.4 Dec. 52-26). null si no aplica o no es determinable.
 */
export function plazoMinimoPorModalidad(modalidadApi: unknown): { dias: number; base: string } | null {
  const t = normalizar(modalidadApi);
  if (t.includes("abreviada")) return { dias: 15, base: "Art. 101.2 Ley 47-25" };
  if (t.includes("licitacion")) return { dias: 30, base: "Art. 101.1 Ley 47-25" };
  if (t.includes("subasta")) return { dias: 5, base: "Art. 101.3 Ley 47-25" };
  if (t.includes("sorteo")) return { dias: 5, base: "Art. 101.4 Ley 47-25" };
  if (t.includes("comparacion") || t.includes("simplificada")) return { dias: 5, base: "Art. 101.5 Ley 47-25 (minimo de 5; 10 si no son bienes/servicios comunes)" };
  if (t.includes("debajo") || t.includes("directa")) return null;
  if (t.includes("menor")) return { dias: 3, base: "Art. 101.6 Ley 47-25" };
  return null;
}

// ============================================================================
// GARANTIAS (Dec. 52-26, Arts. 201-210) y reglas MIPYME (Ley 47-25, Arts. 174-175)
// ============================================================================
export const GARANTIAS = {
  /** Art. 202 Dec. 52-26: 1% del monto de la oferta, dentro del Sobre B. */
  SERIEDAD_OFERTA_PCT: 0.01,
  /** Art. 207 Dec. 52-26: 4% del monto adjudicado. */
  FIEL_CUMPLIMIENTO_PCT: 0.04,
  /** Art. 207 parrafo Dec. 52-26: 1% para MIPYMES. */
  FIEL_CUMPLIMIENTO_MIPYME_PCT: 0.01,
  /** Art. 205 Dec. 52-26: obligatoria si el contrato excede el equivalente a US$10,000. */
  FIEL_CUMPLIMIENTO_UMBRAL_USD: 10_000,
  /** Art. 174 Ley 47-25: anticipo obligatorio del 30% a MIPYMES, sin factura. */
  ANTICIPO_MIPYME_PCT: 0.30,
} as const;

/** Modalidades en que no se exige garantia de seriedad (Art. 201 parrafo Dec. 52-26). */
export function exentaDeSeriedad(modalidad: unknown): boolean {
  const t = normalizar(modalidad);
  return t.includes("sorteo") || t.includes("subasta");
}

/**
 * Reserva MIPYME (Art. 172 Ley 47-25): minimo 30% de las partidas de contratacion para
 * procedimientos EXCLUSIVOS de MIPYMES: 20% general y 10% para MIPYMES dirigidas por mujeres.
 */
export const RESERVA_MIPYME = { TOTAL_PCT: 30, GENERAL_PCT: 20, MUJERES_PCT: 10 } as const;

/** Plazo maximo de pago de la institucion: 30 dias (Art. 148 parrafo III Ley 47-25). */
export const PLAZO_MAXIMO_PAGO_DIAS = 30;

/** Plazo de recursos administrativos: 10 dias habiles (Arts. 205 y 208 Ley 47-25). */
export const PLAZO_RECURSO_DIAS_HABILES = 10;

/** Aclaraciones al pliego: hasta el 50% del plazo de presentacion de ofertas (Art. 102 Ley 47-25). */
export const ACLARACIONES_PCT_PLAZO = 0.5;

export const AVISO_LEGAL =
  "Analisis tecnico automatizado con datos publicos de la DGCP y normativa verificada " +
  `(${FUENTES.ley}; ${FUENTES.reglamento}; ${FUENTES.umbrales}). ` +
  "No sustituye la lectura del pliego de condiciones ni la asesoria de un abogado.";
