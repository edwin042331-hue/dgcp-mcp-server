import { describe, it, expect } from "vitest";
import {
  parseFechaDGCP, diasHasta, sigueAbierto, cuentaRegresiva, diasHabilesEntre, formatFechaHoraRD,
  ultimoCorteDW, proximoCorteDW, fechaISORD, sumarDias, formatEpochRD, notaFrescura,
} from "../src/utils/fechas.js";

const H = 3_600_000;
const D = 24 * H;
/** Lunes 12-oct-2026 16:44 hora RD (20:44 UTC). */
const AHORA = Date.parse("2026-10-12T16:44:00-04:00");

describe("parseFechaDGCP: la API rotula como UTC horas que son de RD", () => {
  it("interpreta el sufijo Z como hora de Republica Dominicana (UTC-4)", () => {
    // Portal: 12/10/2026 08:00:40 (UTC-04:00); API: "2026-10-12T08:00:40.03Z"
    expect(parseFechaDGCP("2026-10-12T08:00:40.03Z")).toBe(Date.parse("2026-10-12T08:00:40.030-04:00"));
  });

  it("acepta 7 decimales, sin Z, con espacio (CSV) y solo fecha", () => {
    expect(parseFechaDGCP("2026-10-09T16:04:02.6533333Z")).toBe(Date.parse("2026-10-09T16:04:02.653-04:00"));
    expect(parseFechaDGCP("2026-10-08 15:16:22.184")).toBe(Date.parse("2026-10-08T15:16:22.184-04:00"));
    expect(parseFechaDGCP("2026-10-08")).toBe(Date.parse("2026-10-08T00:00:00-04:00"));
  });

  it("devuelve null ante valores invalidos sin lanzar", () => {
    for (const v of [null, undefined, "", "fecha-invalida", 123, {}]) expect(parseFechaDGCP(v)).toBeNull();
  });

  it("formatea en hora RD", () => {
    expect(formatFechaHoraRD("2026-11-25T08:00:00Z")).toBe("2026-11-25 08:00");
    expect(formatFechaHoraRD(undefined)).toBe("N/D");
    expect(formatEpochRD(Date.parse("2026-10-13T03:30:00Z"))).toBe("2026-10-12 23:30");
  });
});

describe("Cierre de ofertas con la hora correcta", () => {
  it("un cierre a las 18:00 RD sigue ABIERTO a las 16:44 RD (antes se daba por cerrado a las 14:00)", () => {
    expect(sigueAbierto("2026-10-12T18:00:00Z", AHORA)).toBe(true);
    expect(cuentaRegresiva("2026-10-12T18:00:00Z", AHORA)).toBe("cierra en 1 h");
  });

  it("un cierre vencido hace minutos devuelve -1 dias, nunca 0 ni -0", () => {
    const d = diasHasta("2026-10-12T16:30:00Z", AHORA);
    expect(d).toBe(-1);
    expect(Object.is(d, -0)).toBe(false);
    expect(sigueAbierto("2026-10-12T16:30:00Z", AHORA)).toBe(false);
  });

  it("cuenta dias completos hacia adelante", () => {
    expect(diasHasta("2026-11-25T08:00:00Z", AHORA)).toBe(44);
    expect(cuentaRegresiva("2026-11-25T08:00:00Z", AHORA)).toBe("cierra en 43 dias");
    expect(cuentaRegresiva("2026-10-10T16:44:00Z", AHORA)).toBe("CERRADO hace 2 dias");
  });

  it("maneja nulos", () => {
    expect(diasHasta(null, AHORA)).toBeNull();
    expect(sigueAbierto(undefined, AHORA)).toBe(false);
    expect(cuentaRegresiva("", AHORA)).toBe("sin fecha de cierre");
  });
});

describe("Dias habiles (Art. 101 Ley 47-25)", () => {
  it("cuenta desde el dia siguiente a la publicacion, sin fines de semana", () => {
    // Publicado viernes 9-oct; cierre martes 13-oct: lunes 12 y martes 13 = 2 dias habiles.
    expect(diasHabilesEntre("2026-10-09T15:00:00Z", "2026-10-13T10:00:00Z")).toBe(2);
    // Mismo dia: 0.
    expect(diasHabilesEntre("2026-10-12T08:00:00Z", "2026-10-12T17:00:00Z")).toBe(0);
  });

  it("licitacion publicada el 12-oct y cerrada el 25-nov tiene mas de 30 dias habiles", () => {
    expect(diasHabilesEntre("2026-10-12T08:00:40Z", "2026-11-25T08:00:00Z")).toBe(32);
  });

  it("devuelve null si el cierre es anterior o faltan fechas", () => {
    expect(diasHabilesEntre("2026-10-12", "2026-10-01")).toBeNull();
    expect(diasHabilesEntre(undefined, "2026-10-01")).toBeNull();
  });
});

describe("Cortes del Data Warehouse DGCP (00, 07, 14, 21 hora RD)", () => {
  it("ubica el ultimo y el proximo corte", () => {
    expect(formatEpochRD(ultimoCorteDW(AHORA))).toBe("2026-10-12 14:00");
    expect(formatEpochRD(proximoCorteDW(AHORA))).toBe("2026-10-12 21:00");
    const noche = Date.parse("2026-10-12T22:15:00-04:00");
    expect(formatEpochRD(ultimoCorteDW(noche))).toBe("2026-10-12 21:00");
    expect(formatEpochRD(proximoCorteDW(noche))).toBe("2026-10-13 00:00");
    const madrugada = Date.parse("2026-10-13T03:00:00-04:00");
    expect(formatEpochRD(ultimoCorteDW(madrugada))).toBe("2026-10-13 00:00");
  });

  it("la nota de frescura menciona ambos cortes", () => {
    const n = notaFrescura(AHORA);
    expect(n).toContain("2026-10-12 14:00");
    expect(n).toContain("2026-10-12 21:00");
  });
});

describe("Aritmetica de fechas RD", () => {
  it("fechaISORD usa el dia de RD aunque en UTC ya sea manana", () => {
    expect(fechaISORD(Date.parse("2026-10-13T02:00:00Z"))).toBe("2026-10-12");
  });
  it("sumarDias cruza meses y anos", () => {
    expect(sumarDias("2026-12-30", 3)).toBe("2027-01-02");
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("no depende de D: sanity", () => expect(D).toBe(86_400_000));
});
