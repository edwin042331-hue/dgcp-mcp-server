import { describe, it, expect, beforeEach } from "vitest";
import {
  __configurarParaPruebas, dgcpGet, dgcpListar, normalizePaginated, construirUrl, DgcpApiError,
  conPlazo, ejecutarConPresupuesto, clearCache,
} from "../src/services/dgcpClient.js";
import { CacheLRU } from "../src/services/cache.js";
import { LimitadorTasa } from "../src/services/limitador.js";

/** Reloj virtual: dormir avanza el tiempo al instante. */
function relojVirtual() {
  let t = 1_000_000;
  const esperas: number[] = [];
  return {
    esperas,
    ahora: () => t,
    dormir: async (ms: number) => { esperas.push(ms); t += ms; },
  };
}

function respuesta(status: number, cuerpo: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status, headers });
}

function pagina(content: unknown[] | null, totalResults?: number, pages?: number) {
  return { code: 200, hasError: false, payload: { content }, page: 1, limit: 1000, ...(totalResults !== undefined ? { totalResults, pages } : {}) };
}

let llamadas: string[];
let reloj: ReturnType<typeof relojVirtual>;

function usarFetch(manejador: (url: string, n: number) => Response | Promise<Response>) {
  llamadas = [];
  reloj = relojVirtual();
  __configurarParaPruebas({
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      llamadas.push(url);
      return manejador(url, llamadas.length);
    }) as typeof fetch,
    reloj,
    aleatorio: () => 0.5,
  });
}

beforeEach(() => clearCache());

describe("Cliente HTTP: reintentos y errores", () => {
  it("reintenta un 503 y luego devuelve el dato", async () => {
    usarFetch((_, n) => (n < 3 ? respuesta(503, "caido") : respuesta(200, pagina([{ id: 1 }], 1, 1))));
    const r = await dgcpGet<{ payload: { content: unknown[] } }>("procesos", { proceso: "X" });
    expect(r.payload.content).toHaveLength(1);
    expect(llamadas).toHaveLength(3);
  });

  it("en 429 respeta Retry-After pausando el limitador", async () => {
    usarFetch((_, n) => (n === 1 ? respuesta(429, "lento", { "retry-after": "7" }) : respuesta(200, pagina([], 0, 0))));
    await dgcpGet("procesos");
    expect(llamadas).toHaveLength(2);
    expect(reloj.esperas).toContain(7000);
  });

  it("pausa cuando la API avisa que quedan pocas peticiones (x-ratelimit-remaining)", async () => {
    usarFetch(() => respuesta(200, pagina([], 0, 0), { "x-ratelimit-remaining": "2", "x-ratelimit-reset": "40" }));
    await dgcpGet("procesos", { a: 1 });
    await dgcpGet("procesos", { a: 2 });
    expect(reloj.esperas).toContain(40_000);
  });

  it("no pausa mientras haya cupo", async () => {
    usarFetch(() => respuesta(200, pagina([], 0, 0), { "x-ratelimit-remaining": "48", "x-ratelimit-reset": "60" }));
    await dgcpGet("procesos", { a: 1 });
    await dgcpGet("procesos", { a: 2 });
    expect(reloj.esperas).toEqual([]);
  });

  it("no reintenta errores 4xx definitivos", async () => {
    usarFetch(() => respuesta(404, "Cannot GET"));
    await expect(dgcpGet("procesoz")).rejects.toBeInstanceOf(DgcpApiError);
    expect(llamadas).toHaveLength(1);
  });

  it("convierte hasError=true en error aunque el HTTP sea 200", async () => {
    usarFetch(() => respuesta(200, { hasError: true, message: "parametro invalido" }));
    await expect(dgcpGet("procesos")).rejects.toThrow(/parametro invalido/);
  });

  it("rechaza respuestas que no son JSON", async () => {
    usarFetch(() => respuesta(200, "<html>"));
    await expect(dgcpGet("procesos")).rejects.toThrow(/no JSON/);
  });

  it("reporta errores de red como DgcpApiError tras agotar reintentos", async () => {
    usarFetch(() => { throw new TypeError("fetch failed"); });
    await expect(dgcpGet("procesos")).rejects.toThrow(/Error de red/);
    expect(llamadas.length).toBeGreaterThan(1);
  });
});

describe("Cliente HTTP: cache y deduplicacion", () => {
  it("dos consultas identicas simultaneas generan una sola peticion", async () => {
    usarFetch(() => respuesta(200, pagina([{ id: 1 }], 1, 1)));
    await Promise.all([dgcpGet("procesos", { proceso: "A" }), dgcpGet("procesos", { proceso: "A" })]);
    expect(llamadas).toHaveLength(1);
  });

  it("la segunda consulta sale de cache", async () => {
    usarFetch(() => respuesta(200, pagina([{ id: 1 }], 1, 1)));
    await dgcpGet("procesos", { proceso: "A" });
    await dgcpGet("procesos", { proceso: "A" });
    expect(llamadas).toHaveLength(1);
  });

  it("la URL es canonica: el orden de los parametros no cambia la clave", () => {
    expect(construirUrl("procesos", { b: 2, a: 1, vacio: "", nada: undefined }))
      .toBe(construirUrl("procesos", { a: 1, b: 2 }));
  });
});

describe("dgcpListar: paginacion con filtros del servidor", () => {
  it("descarga todas las paginas y declara cobertura completa", async () => {
    usarFetch((url) => {
      const p = Number(new URL(url).searchParams.get("page"));
      return respuesta(200, pagina(p <= 3 ? [{ p }] : [], 3, 3));
    });
    const r = await dgcpListar<{ p: number }>("contratos", { rpe: 1 });
    expect(r.items.map((x) => x.p)).toEqual([1, 2, 3]);
    expect(r.completo).toBe(true);
    expect(llamadas.every((u) => u.includes("rpe=1") && u.includes("limit=1000"))).toBe(true);
  });

  it("respeta maxPaginas y marca la cobertura como parcial", async () => {
    usarFetch(() => respuesta(200, pagina([{}], 10, 10)));
    const r = await dgcpListar("procesos", {}, { maxPaginas: 2 });
    expect(r.paginasDescargadas).toBe(2);
    expect(r.completo).toBe(false);
  });

  it("si falla la primera pagina lanza error (nunca un vacio silencioso)", async () => {
    usarFetch(() => respuesta(500, "error"));
    await expect(dgcpListar("procesos")).rejects.toBeInstanceOf(DgcpApiError);
  });

  it("si falla una pagina posterior devuelve parcial y la reporta", async () => {
    usarFetch((url) => {
      const p = Number(new URL(url).searchParams.get("page"));
      return p === 2 ? respuesta(400, "mal") : respuesta(200, pagina([{ p }], 3, 3));
    });
    const r = await dgcpListar<{ p: number }>("procesos");
    expect(r.paginasFallidas).toEqual([2]);
    expect(r.completo).toBe(false);
    expect(r.items).toHaveLength(2);
  });

  it("content: null y sin totalResults equivale a cero resultados", async () => {
    usarFetch(() => respuesta(200, pagina(null)));
    const r = await dgcpListar("procesos", { startdate: "2026-10-11" });
    expect(r.items).toEqual([]);
    expect(r.completo).toBe(true);
  });
});

describe("normalizePaginated", () => {
  it("lee payload.content y el total de la API", () => {
    const n = normalizePaginated<{ id: number }>({ payload: { content: [{ id: 1 }, { id: 2 }] }, totalResults: 25, pages: 3 }, 1, 10);
    expect(n).toMatchObject({ total: 25, total_pages: 3, has_more: true });
    expect(n.items).toHaveLength(2);
  });
  it("acepta payload como arreglo directo", () => {
    expect(normalizePaginated({ payload: [{ a: 1 }] }, 1, 10).items).toHaveLength(1);
  });
});

describe("Presupuestos de tiempo", () => {
  it("conPlazo devuelve undefined si la promesa no llega a tiempo", async () => {
    const lenta = new Promise((r) => setTimeout(() => r("tarde"), 200));
    expect(await conPlazo(lenta, 10)).toBeUndefined();
    expect(await conPlazo(Promise.resolve("ya"), 10)).toBe("ya");
  });

  it("ejecutarConPresupuesto respeta la concurrencia y conserva el orden", async () => {
    let activas = 0, maximo = 0;
    const tareas = [30, 10, 20, 5].map((ms, i) => async () => {
      activas++; maximo = Math.max(maximo, activas);
      await new Promise((r) => setTimeout(r, ms));
      activas--;
      return i;
    });
    expect(await ejecutarConPresupuesto(tareas, 2, 5_000)).toEqual([0, 1, 2, 3]);
    expect(maximo).toBe(2);
  });
});

describe("LimitadorTasa", () => {
  it("nunca supera N salidas por ventana", async () => {
    const r = relojVirtual();
    const lim = new LimitadorTasa(3, 60_000, 10, r);
    const marcas: number[] = [];
    await Promise.all(Array.from({ length: 7 }, () => lim.ejecutar(async () => { marcas.push(r.ahora()); })));
    for (const m of marcas) {
      expect(marcas.filter((x) => x > m - 60_000 && x <= m).length).toBeLessThanOrEqual(3);
    }
    expect(marcas).toHaveLength(7);
  });
});

describe("CacheLRU", () => {
  it("expulsa lo menos usado al pasar el tope de bytes", () => {
    const c = new CacheLRU<string>(100, () => 0);
    c.set("a", "A", 1000, 40);
    c.set("b", "B", 1000, 40);
    c.get("a");
    c.set("c", "C", 1000, 40);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe("A");
    expect(c.bytes).toBe(80);
  });

  it("respeta el TTL", () => {
    let t = 0;
    const c = new CacheLRU<string>(100, () => t);
    c.set("a", "A", 50, 1);
    t = 49; expect(c.get("a")).toBe("A");
    t = 50; expect(c.get("a")).toBeUndefined();
  });
});
