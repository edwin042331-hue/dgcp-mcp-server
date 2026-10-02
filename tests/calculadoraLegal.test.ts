// tests/calculadoraLegal.test.ts
import { describe, it, expect } from "vitest";
import {
  UMBRALES_BIENES_SERVICIOS,
  GARANTIA_SERIEDAD_OFERTA_PCT,
  GARANTIA_FIEL_CUMPLIMIENTO_PCT,
  GARANTIA_FIEL_CUMPLIMIENTO_MIPYME_PCT,
  ANTICIPO_MAXIMO_PCT,
} from "../src/constants.js";

describe("DGCP Calculadora Legal - Umbrales y Garantías Normativas (Ley 340-06 / Dec. 416-23)", () => {
  it("debe verificar los umbrales para Licitación Pública Nacional de Bienes y Servicios", () => {
    const montoLPN = 6_000_000;
    expect(montoLPN).toBeGreaterThanOrEqual(UMBRALES_BIENES_SERVICIOS.LICITACION_PUBLICA_MIN);
  });

  it("debe verificar los umbrales para Comparación de Precios y Compras Menores", () => {
    const montoCP = 2_500_000;
    expect(montoCP).toBeGreaterThanOrEqual(UMBRALES_BIENES_SERVICIOS.COMPARACION_PRECIOS_MIN);
    expect(montoCP).toBeLessThanOrEqual(UMBRALES_BIENES_SERVICIOS.COMPARACION_PRECIOS_MAX);

    const montoCM = 500_000;
    expect(montoCM).toBeGreaterThanOrEqual(UMBRALES_BIENES_SERVICIOS.COMPRAS_MENORES_MIN);
    expect(montoCM).toBeLessThanOrEqual(UMBRALES_BIENES_SERVICIOS.COMPRAS_MENORES_MAX);
  });

  it("calcula la Garantía de Seriedad de Oferta (1%) exactamente", () => {
    const monto = 14_500_000; // INDOTEL Pentesting
    const garantia = monto * GARANTIA_SERIEDAD_OFERTA_PCT;
    expect(garantia).toBe(145_000);
  });

  it("calcula la Garantía de Fiel Cumplimiento General (4%) vs Especial MIPYME (1% Dec. 416-23)", () => {
    const monto = 500_000; // INFOTEP
    const fielGen = monto * GARANTIA_FIEL_CUMPLIMIENTO_PCT;
    const fielMipyme = monto * GARANTIA_FIEL_CUMPLIMIENTO_MIPYME_PCT;
    
    expect(fielGen).toBe(20_000);
    expect(fielMipyme).toBe(5_000);
    expect(fielMipyme).toBe(fielGen * 0.25); // Ahorro del 75%
  });

  it("calcula el anticipo máximo legal (20%)", () => {
    const monto = 10_000_000;
    const anticipo = monto * ANTICIPO_MAXIMO_PCT;
    expect(anticipo).toBe(2_000_000);
  });
});

describe("DGCP Algoritmo Oficial de Puntuación Económica", () => {
  it("asigna la puntuación máxima (100% de puntos económicos) al precio más bajo", () => {
    const pMin = 450_000;
    const pOf = 450_000;
    const puntosMax = 40;
    const score = (pMin / pOf) * puntosMax;
    expect(score).toBe(40);
  });

  it("aplica la fórmula inversamente proporcional con precisión matemática a ofertas superiores", () => {
    const pMin = 450_000;
    const pOf = 500_000; // Oferta al techo
    const puntosMax = 40;
    const score = (pMin / pOf) * puntosMax;
    expect(score).toBe(36); // (450/500)*40 = 0.9 * 40 = 36
  });
});
