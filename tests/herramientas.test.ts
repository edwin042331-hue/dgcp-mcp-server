import { describe, it, expect } from "vitest";
import { filtrarProcesos, ordenarProcesos, ESTADOS_API } from "../src/tools/procesosTools.js";
import { detectarVinculos, type Oferente } from "../src/tools/forenseTools.js";
import { simularEscenarios } from "../src/tools/propuestasTools.js";
import { diasDePago, hhi, sumarDiasHabiles, detectarMarcas } from "../src/tools/quirurgicoTools.js";
import { auditarPlazo } from "../src/tools/inteligenciaTools.js";
import { coincideUNSPSC, nivelUNSPSC } from "../src/tools/mercadoTools.js";
import { parsearCSV, interpretarInhabilitados } from "../src/services/catalogos.js";
import type { ProcesoReal, ProveedorReal } from "../src/types.js";

const AHORA = Date.parse("2026-10-12T16:44:00-04:00");

const proc = (p: Partial<ProcesoReal>): ProcesoReal => ({
  codigo_proceso: "X", titulo: "t", estado_proceso: ESTADOS_API.publicado, ...p,
});

describe("Bug reportado: 'dame la ultima licitacion' devolvia procesos viejos ya cerrados", () => {
  const items = [
    proc({ codigo_proceso: "VIEJO-CERRADO", fecha_publicacion: "2026-10-08T09:00:00Z", fecha_fin_recepcion_ofertas: "2026-10-08T15:00:00Z", estado_proceso: "Sobres abiertos o aperturados" }),
    proc({ codigo_proceso: "MIP-CCC-LPN-2026-0005", fecha_publicacion: "2026-10-12T08:00:40Z", fecha_fin_recepcion_ofertas: "2026-11-25T08:00:00Z" }),
    proc({ codigo_proceso: "MEDIO", fecha_publicacion: "2026-10-09T16:10:00Z", fecha_fin_recepcion_ofertas: "2026-10-14T10:00:00Z" }),
  ];

  it("orden 'recientes' pone primero lo ultimo publicado", () => {
    expect(ordenarProcesos(items, "recientes").map((p) => p.codigo_proceso))
      .toEqual(["MIP-CCC-LPN-2026-0005", "MEDIO", "VIEJO-CERRADO"]);
  });

  it("'abierto' excluye lo vencido y lo que ya no esta publicado", () => {
    const r = filtrarProcesos(items, { terminos: [], estado: "abierto" }, AHORA);
    expect(r.map((p) => p.codigo_proceso).sort()).toEqual(["MEDIO", "MIP-CCC-LPN-2026-0005"]);
  });

  it("excluye procesos marcados 'publicado' cuyo plazo ya vencio", () => {
    const vencido = proc({ fecha_fin_recepcion_ofertas: "2026-09-28T18:00:00Z" });
    expect(filtrarProcesos([vencido], { terminos: [], estado: "abierto" }, AHORA)).toHaveLength(0);
  });

  it("cierre_proximo ordena por vencimiento", () => {
    expect(ordenarProcesos(items, "cierre_proximo")[0].codigo_proceso).toBe("VIEJO-CERRADO");
  });

  it("filtra por terminos alternativos, modalidad y montos", () => {
    const xs = [
      proc({ codigo_proceso: "A", titulo: "Compra de LAPTOPS", modalidad: "Contratación Menor", monto_estimado: 500_000 }),
      proc({ codigo_proceso: "B", titulo: "Servicio de catering", modalidad: "Licitación Pública Nacional", monto_estimado: 10_000_000 }),
    ];
    expect(filtrarProcesos(xs, { terminos: ["computadora", "laptop"], estado: "todos" }).map((p) => p.codigo_proceso)).toEqual(["A"]);
    expect(filtrarProcesos(xs, { terminos: [], estado: "todos", modalidad: "licitacion" }).map((p) => p.codigo_proceso)).toEqual(["B"]);
    expect(filtrarProcesos(xs, { terminos: [], estado: "todos", monto_min: 1_000_000 }).map((p) => p.codigo_proceso)).toEqual(["B"]);
  });
});

describe("Auditoria del plazo de convocatoria", () => {
  it("marca una licitacion publica con menos de 30 dias habiles", () => {
    const a = auditarPlazo(proc({ modalidad: "Licitación Pública Nacional", fecha_publicacion: "2026-10-01T08:00:00Z", fecha_fin_recepcion_ofertas: "2026-10-20T08:00:00Z" }));
    expect(a).toMatchObject({ minimo: 30, incumple: true });
  });
  it("no audita procesos del regimen anterior ni compras por debajo del umbral", () => {
    expect(auditarPlazo(proc({ modalidad: "Licitación Pública Nacional", fecha_publicacion: "2025-11-01T08:00:00Z", fecha_fin_recepcion_ofertas: "2025-11-05T08:00:00Z" }))).toBeNull();
    expect(auditarPlazo(proc({ modalidad: "Compras por Debajo del Umbral", fecha_publicacion: "2026-10-01T08:00:00Z", fecha_fin_recepcion_ofertas: "2026-10-01T15:00:00Z" }))).toBeNull();
  });
});

describe("Forense: deteccion de vinculos entre oferentes", () => {
  const ficha = (f: Partial<ProveedorReal>): ProveedorReal => ({ estado: "Activo", ...f });
  const of = (rpe: string, nombre: string, valor: number, f: Partial<ProveedorReal> | null): Oferente => ({
    rpe, nombre, ofertas: [{ rpe, razon_social: nombre, valor_oferta: valor, estado_oferta: "Cargada" }],
    ficha: f ? ficha(f) : null, inhabilitaciones: [],
  });

  it("detecta telefono, correo, domicilio y contacto compartidos", () => {
    const h = detectarVinculos([
      of("1", "Alfa SRL", 100_000, { telefono_comercial: "809-555-1234", correo_comercial: "ventas@grupoxyz.com", direccion: "Calle Duarte 25, Gazcue, Santo Domingo", contacto: "Juan Perez" }),
      of("2", "Beta SRL", 130_000, { telefono_contacto: "(809) 555-1234", correo_contacto: "VENTAS@grupoxyz.com", direccion: "calle duarte 25, gazcue, santo domingo", contacto: "JUAN PEREZ" }),
    ]);
    const tipos = h.map((x) => x.tipo);
    expect(tipos).toEqual(expect.arrayContaining(["Telefono compartido", "Correo compartido", "Domicilio compartido", "Misma persona de contacto", "Dominio de correo corporativo compartido"]));
  });

  it("no marca dominios genericos como vinculo", () => {
    const h = detectarVinculos([
      of("1", "Alfa", 100, { correo_comercial: "a@gmail.com" }),
      of("2", "Beta", 200, { correo_comercial: "b@gmail.com" }),
    ]);
    expect(h.find((x) => x.tipo.includes("Dominio"))).toBeUndefined();
  });

  it("detecta ofertas identicas y casi identicas", () => {
    const h = detectarVinculos([of("1", "A", 100_000, null), of("2", "B", 100_000, null), of("3", "C", 100_400, null)]);
    expect(h.filter((x) => x.tipo === "Ofertas identicas")).toHaveLength(1);
    expect(h.filter((x) => x.tipo === "Ofertas casi identicas").length).toBeGreaterThanOrEqual(1);
  });

  it("sin vinculos no inventa hallazgos graves", () => {
    const h = detectarVinculos([
      of("1", "A", 100_000, { telefono_comercial: "8091111111", direccion: "Av. Lincoln 100, Piantini" }),
      of("2", "B", 150_000, { telefono_comercial: "8092222222", direccion: "Calle El Sol 5, Santiago centro" }),
    ]);
    expect(h.filter((x) => x.gravedad !== "info")).toHaveLength(0);
  });

  it("marca la empresa creada poco antes del proceso", () => {
    const h = detectarVinculos([of("1", "Nueva SRL", 1, { fecha_creacion_empresa: "2026-08-01T00:00:00Z" })], "2026-10-01T08:00:00Z");
    expect(h.map((x) => x.tipo)).toContain("Empresa de reciente creacion");
  });
});

describe("Simulador de puntuacion", () => {
  it("aplica (precio minimo / precio ofertado) x puntos y nunca supera el maximo", () => {
    const [e] = simularEscenarios({ referencial: 500_000, costo: 400_000, puntajeTecnico: 60, pesoEconomico: 40, preciosRivales: [450_000], porcentajes: [1] });
    expect(e.puntosEconomicos).toBeCloseTo(36, 10);
    const [mejor] = simularEscenarios({ referencial: 500_000, costo: 400_000, puntajeTecnico: 60, pesoEconomico: 40, preciosRivales: [450_000], porcentajes: [0.85] });
    expect(mejor.puntosEconomicos).toBe(40);
  });
});

describe("Scorecard y pliegos", () => {
  it("lee los plazos de pago reales de la API", () => {
    expect(diasDePago("60 días")).toBe(60);
    expect(diasDePago("No especificado")).toBeNull();
  });
  it("calcula el HHI", () => {
    expect(hhi([100])).toBe(10_000);
    expect(hhi([50, 50])).toBe(5_000);
    expect(hhi([])).toBe(0);
  });
  it("suma dias habiles saltando fines de semana", () => {
    expect(sumarDiasHabiles("2026-10-09", 10)).toBe("2026-10-23"); // viernes + 10 habiles
  });
  it("detecta marcas como palabra completa", () => {
    expect(detectarMarcas("Switch Cisco Catalyst y laptop HP")).toEqual(["cisco", "hp"]);
    expect(detectarMarcas("Chapas y planchas de acero")).toEqual([]);
  });
});

describe("UNSPSC", () => {
  it("reconoce el nivel del codigo y la pertenencia", () => {
    expect(nivelUNSPSC("43210000")).toBe("familia");
    expect(nivelUNSPSC("43211500")).toBe("clase");
    expect(nivelUNSPSC("43211507")).toBe("subclase");
    expect(coincideUNSPSC("43211507", "43210000")).toBe(true);
    expect(coincideUNSPSC("43211507", "43211500")).toBe(true);
    expect(coincideUNSPSC("43211507", "43211508")).toBe(false);
    expect(coincideUNSPSC(undefined, "43210000")).toBe(false);
  });
});

describe("Lista oficial de inhabilitados (CSV)", () => {
  const csv = '﻿RPE,MOTIVO_INHABILITACION,FECHA,FECHA_INHABILITACION,FECHA_HABILITACION,FECHA_FIRMA_RESOLUCION,OFICIO_INHABILITACION,URL_CERTIFICACION_RPE\r\n' +
    '10449,"Cancelación a solicitud del proveedor, en virtud de la comunicación EX-1.",2026-10-08 15:16:22.184,2026-10-08 00:00:00.000,,,,https://x/1\r\n' +
    '35665,"Inhabilitación permanente, por presentación de documentos ""falsos""\nen el procedimiento.",2026-09-03 12:15:05.853,2026-09-03 00:00:00.000,,,RIC-0196-2026 ,https://x/2\r\n' +
    '777,"Suspensión de oficio",2025-01-01,2025-01-01 00:00:00.000,2025-06-01 00:00:00.000,,,https://x/3\r\n';

  it("parsea comillas escapadas y saltos de linea dentro de campos", () => {
    const filas = parsearCSV(csv);
    expect(filas).toHaveLength(4);
    expect(filas[2][1]).toContain('"falsos"\nen');
  });

  it("separa sanciones de cancelaciones voluntarias y conserva la habilitacion", () => {
    const m = interpretarInhabilitados(csv);
    expect(m.get("10449")?.[0].es_sancion).toBe(false);
    expect(m.get("35665")?.[0].es_sancion).toBe(true);
    expect(m.get("777")?.[0].fecha_habilitacion).toBe("2025-06-01 00:00:00.000");
  });
});
