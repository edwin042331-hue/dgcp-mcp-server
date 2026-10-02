// tests/dgcpClient.test.ts
import { describe, it, expect } from "vitest";
import {
  sigueAbierto,
  diasHasta,
  fixEncoding,
  formatMonto,
  limpiarRNC,
  normalizar,
  normalizePaginated,
} from "../src/services/dgcpClient.js";

describe("DGCP Client - Auditoría de Fechas y Límites de Tiempo (Bug Fix Codex)", () => {
  it("debe retornar FALSE para un proceso cerrado hace 2 horas (evitar Math.ceil redondeando -0.04 a -0)", () => {
    const haceDosHoras = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    expect(sigueAbierto(haceDosHoras)).toBe(false);
    
    const dias = diasHasta(haceDosHoras);
    expect(dias).not.toBeNull();
    expect(dias).toBeLessThan(0); // Debe ser negativo (-1), nunca 0 ni -0
  });

  it("debe retornar FALSE para un proceso cerrado ayer", () => {
    const ayer = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    expect(sigueAbierto(ayer)).toBe(false);
    const dias = diasHasta(ayer);
    expect(dias).toBeLessThan(0);
  });

  it("debe retornar TRUE para un proceso que cierra en 2 horas hoy", () => {
    const enDosHoras = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    expect(sigueAbierto(enDosHoras)).toBe(true);
    const dias = diasHasta(enDosHoras);
    expect(dias).toBe(1); // Cierra hoy
  });

  it("debe retornar TRUE para un proceso que cierra en 5 días", () => {
    const enCincoDias = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
    expect(sigueAbierto(enCincoDias)).toBe(true);
    const dias = diasHasta(enCincoDias);
    expect(dias).toBe(5);
  });

  it("debe manejar fechas inválidas o nulas de forma segura sin excepciones", () => {
    expect(sigueAbierto(null)).toBe(false);
    expect(sigueAbierto(undefined)).toBe(false);
    expect(sigueAbierto("fecha-invalida")).toBe(false);
    expect(diasHasta(null)).toBeNull();
    expect(diasHasta("")).toBeNull();
  });
});

describe("DGCP Client - Sanitización de Encoding y Normalización", () => {
  it("corrige caracteres mal codificados de la API DGCP (UTF-8 leído como Latin-1)", () => {
    expect(fixEncoding("ContrataciÃ³n de software")).toBe("Contratación de software");
    expect(fixEncoding("TecnologÃ­a e InformaciÃ³n")).toBe("Tecnología e Información");
    expect(fixEncoding("DiseÃ±o y ejecuciÃ³n")).toBe("Diseño y ejecución");
  });

  it("normaliza texto para comparaciones inmunes a mayúsculas y diacríticos", () => {
    expect(normalizar("  INFORMACIÓN  ")).toBe("informacion");
    expect(normalizar("Licitación Pública")).toBe("licitacion publica");
  });

  it("limpia RNC o Cédulas eliminando guiones y caracteres extraños", () => {
    expect(limpiarRNC("1-32-45678-9")).toBe("132456789");
    expect(limpiarRNC(" 402-1234567-8 ")).toBe("40212345678");
  });

  it("formatea montos en pesos dominicanos con centavos y separadores de miles", () => {
    expect(formatMonto(500000, "DOP")).toBe("DOP 500,000.00");
    expect(formatMonto(14758260.96, "DOP")).toBe("DOP 14,758,260.96");
    expect(formatMonto(null)).toBe("N/D");
  });
});

describe("DGCP Client - Normalizador de Paginación", () => {
  it("extrae items desde payload.content con cálculo exacto de páginas", () => {
    const rawApi = {
      code: 200,
      payload: {
        content: [{ id: 1 }, { id: 2 }, { id: 3 }],
      },
      totalResults: 25,
      pages: 3,
    };
    const norm = normalizePaginated<{ id: number }>(rawApi, 1, 10);
    expect(norm.items.length).toBe(3);
    expect(norm.total).toBe(25);
    expect(norm.total_pages).toBe(3);
    expect(norm.has_more).toBe(true);
  });
});
