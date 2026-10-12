import { describe, it, expect } from "vitest";
import {
  UMBRALES_2026, GARANTIAS, modalidadPorMonto, claveModalidad, modalidadInferiorALaLegal,
  plazoMinimoPorModalidad, regimenAplicable, exentaDeSeriedad, PLAZO_MAXIMO_PAGO_DIAS, PLAZO_RECURSO_DIAS_HABILES,
} from "../src/normativa.js";

describe("Umbrales 2026 (Resolucion PNP-03-2026)", () => {
  it("bienes y servicios: limites exactos", () => {
    expect(modalidadPorMonto(6_436_757.51, "bienes_servicios").clave).toBe("licitacion_publica");
    expect(modalidadPorMonto(6_436_757.50, "bienes_servicios").clave).toBe("contratacion_simplificada");
    expect(modalidadPorMonto(2_010_835.38, "bienes_servicios").clave).toBe("contratacion_simplificada");
    expect(modalidadPorMonto(2_010_835.37, "bienes_servicios").clave).toBe("contratacion_menor");
    expect(modalidadPorMonto(268_111.38, "bienes_servicios").clave).toBe("contratacion_menor");
    expect(modalidadPorMonto(268_111.37, "bienes_servicios").clave).toBe("directa_sujeta_umbral");
  });

  it("obras: limites exactos", () => {
    expect(modalidadPorMonto(406_713_345.70, "obras").clave).toBe("licitacion_publica");
    expect(modalidadPorMonto(406_713_345.69, "obras").clave).toBe("sorteo_obras");
    expect(modalidadPorMonto(201_083_538.48, "obras").clave).toBe("sorteo_obras");
    expect(modalidadPorMonto(201_083_538.47, "obras").clave).toBe("contratacion_simplificada");
    expect(modalidadPorMonto(53_622_276.93, "obras").clave).toBe("contratacion_simplificada");
    expect(modalidadPorMonto(53_622_276.92, "obras").clave).toBe("contratacion_menor");
  });

  it("los umbrales publicados no se alteran por accidente", () => {
    expect(UMBRALES_2026.bienes_servicios.LICITACION_PUBLICA_MIN).toBe(6_436_757.51);
    expect(UMBRALES_2026.obras.LICITACION_PUBLICA_MIN).toBe(406_713_345.70);
  });
});

describe("Plazos minimos de convocatoria (Art. 101 Ley 47-25)", () => {
  it.each([
    ["Licitación Pública Nacional", 30],
    ["Licitación Pública Abreviada", 15],
    ["Subasta Inversa", 5],
    ["Sorteo de Obras", 5],
    ["Comparación de Precios", 5],
    ["Contratación Menor", 3],
  ])("%s -> %i dias habiles", (modalidad, dias) => {
    expect(plazoMinimoPorModalidad(modalidad)?.dias).toBe(dias);
  });

  it("no aplica a compras por debajo del umbral ni a excepciones", () => {
    expect(plazoMinimoPorModalidad("Compras por Debajo del Umbral")).toBeNull();
    expect(plazoMinimoPorModalidad("Procesos de Excepción")).toBeNull();
  });
});

describe("Modalidades: nombres de la API y jerarquia", () => {
  it("reconoce los nombres reales del SECP (antiguos y nuevos)", () => {
    expect(claveModalidad("Compras por Debajo del Umbral")).toBe("directa_sujeta_umbral");
    expect(claveModalidad("Contratación Menor")).toBe("contratacion_menor");
    expect(claveModalidad("Compras Menores")).toBe("contratacion_menor");
    expect(claveModalidad("Comparación de Precios")).toBe("contratacion_simplificada");
    expect(claveModalidad("Licitación Pública Nacional")).toBe("licitacion_publica");
    expect(claveModalidad("Procesos de Excepción")).toBeNull();
  });

  it("detecta una modalidad inferior a la legal (indicio de fraccionamiento)", () => {
    const legal = modalidadPorMonto(3_000_000, "bienes_servicios");
    expect(modalidadInferiorALaLegal("Contratación Menor", legal)).toBe(true);
    expect(modalidadInferiorALaLegal("Comparación de Precios", legal)).toBe(false);
    expect(modalidadInferiorALaLegal("Licitación Pública Nacional", legal)).toBe(false);
    expect(modalidadInferiorALaLegal("Procesos de Excepción", legal)).toBeNull();
  });
});

describe("Regimen aplicable (Art. 245 transitorio)", () => {
  it("separa Ley 340-06, transicion y Ley 47-25", () => {
    expect(regimenAplicable("2025-12-15T09:00:00Z")).toBe("ley_340_06");
    expect(regimenAplicable("2026-01-26T09:00:00Z")).toBe("transicion");
    expect(regimenAplicable("2026-10-12T08:00:40Z")).toBe("ley_47_25");
  });
});

describe("Garantias y reglas MIPYME (Dec. 52-26 / Ley 47-25)", () => {
  it("porcentajes verificados contra el texto oficial", () => {
    expect(GARANTIAS.SERIEDAD_OFERTA_PCT).toBe(0.01);       // Art. 202 Dec. 52-26
    expect(GARANTIAS.FIEL_CUMPLIMIENTO_PCT).toBe(0.04);     // Art. 207
    expect(GARANTIAS.FIEL_CUMPLIMIENTO_MIPYME_PCT).toBe(0.01);
    expect(GARANTIAS.ANTICIPO_MIPYME_PCT).toBe(0.30);       // Art. 174 Ley 47-25
    expect(PLAZO_MAXIMO_PAGO_DIAS).toBe(30);                // Art. 148 P. III
    expect(PLAZO_RECURSO_DIAS_HABILES).toBe(10);            // Arts. 205 y 208
  });

  it("sorteo de obras y subasta inversa no exigen seriedad (Art. 201)", () => {
    expect(exentaDeSeriedad("Subasta Inversa")).toBe(true);
    expect(exentaDeSeriedad("Sorteo de Obras")).toBe(true);
    expect(exentaDeSeriedad("Licitación Pública Nacional")).toBe(false);
  });
});
