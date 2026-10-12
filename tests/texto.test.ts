import { describe, it, expect } from "vitest";
import {
  fixEncoding, normalizar, limpiarRNC, terminosAlternativos, contieneAlguno, contienePalabra,
  formatMonto, estadisticos, truncate, celda, numero,
} from "../src/utils/texto.js";

describe("Texto: encoding y normalizacion", () => {
  it("corrige mojibake UTF-8 leido como Latin-1", () => {
    expect(fixEncoding("ContrataciÃ³n de software")).toBe("Contratación de software");
    expect(fixEncoding("TecnologÃ­a e InformaciÃ³n")).toBe("Tecnología e Información");
    expect(fixEncoding("DiseÃ±o")).toBe("Diseño");
  });

  it("no toca texto correcto", () => {
    expect(fixEncoding("Ministerio de Interior y Policía")).toBe("Ministerio de Interior y Policía");
  });

  it("normaliza acentos, mayusculas y espacios", () => {
    expect(normalizar("  INFORMACIÓN   Pública ")).toBe("informacion publica");
    expect(normalizar(null)).toBe("");
  });

  it("limpia RNC y cedulas", () => {
    expect(limpiarRNC("1-32-45678-9")).toBe("132456789");
    expect(limpiarRNC(" 402-1234567-8 ")).toBe("40212345678");
  });
});

describe("Busqueda multitermino", () => {
  it("separa alternativas por coma, punto y coma o barra", () => {
    expect(terminosAlternativos("Software, LAPTOP; servidor | ")).toEqual(["software", "laptop", "servidor"]);
    expect(terminosAlternativos(undefined)).toEqual([]);
  });

  it("coincide con cualquiera de los terminos (OR) sin acentos", () => {
    const t = terminosAlternativos("computadora, laptop");
    expect(contieneAlguno(["Adquisición de LAPTOPS"], t)).toBe(true);
    expect(contieneAlguno(["Compra de café"], t)).toBe(false);
    expect(contieneAlguno(["lo que sea"], [])).toBe(true);
  });

  it("detecta palabras completas: 'hp' no coincide dentro de otra palabra", () => {
    expect(contienePalabra("Impresora HP LaserJet", "hp")).toBe(true);
    expect(contienePalabra("Chapas de zinc", "hp")).toBe(false);
    expect(contienePalabra("equipos Dell.", "dell")).toBe(true);
    expect(contienePalabra("Switch Palo Alto PA-440", "palo alto")).toBe(true);
  });
});

describe("Formato y estadistica", () => {
  it("formatea montos de forma determinista", () => {
    expect(formatMonto(500000, "DOP")).toBe("DOP 500,000.00");
    expect(formatMonto(14758260.96)).toBe("DOP 14,758,260.96");
    expect(formatMonto(null)).toBe("N/D");
    expect(formatMonto("abc")).toBe("N/D");
  });

  it("calcula mediana y cuartiles con interpolacion", () => {
    const s = estadisticos([10, 20, 30, 40, 1000, NaN]);
    expect(s).toEqual({ n: 5, min: 10, p25: 20, mediana: 30, p75: 40, max: 1000 });
    expect(estadisticos([])).toBeNull();
  });

  it("recorta y protege tablas Markdown", () => {
    expect(truncate("abcdef", 3)).toMatch(/^abc\n\n\*\(Respuesta recortada/);
    expect(celda("a | b", 10)).toBe("a / b");
    expect(numero("12.5")).toBe(12.5);
    expect(numero("")).toBeNull();
  });
});
