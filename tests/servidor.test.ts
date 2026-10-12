import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { crearServidor } from "../src/index.js";
import { VERSION } from "../src/constants.js";

const ESPERADAS = [
  "dgcp_ultimas_licitaciones", "dgcp_buscar_licitaciones", "dgcp_buscar_contratos", "dgcp_buscar_ofertas",
  "dgcp_buscar_proveedores", "dgcp_inteligencia_proceso", "dgcp_radiografia_proveedor", "dgcp_calculadora_legal",
  "dgcp_oportunidades_para_mi", "dgcp_precios_referencia", "dgcp_plan_compras", "dgcp_generador_propuesta_sncc",
  "dgcp_simulador_puntuacion", "dgcp_auditoria_colusion", "dgcp_scorecard_institucion", "dgcp_auditor_pliego_trampa",
  "dgcp_generador_recurso_impugnacion",
].sort();

let client: Client;

beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await crearServidor().connect(a);
  client = new Client({ name: "test", version: "1" });
  await client.connect(b);
});

afterAll(async () => client.close());

describe("Servidor MCP", () => {
  it("la version coincide con package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it("registra exactamente las 17 herramientas, documentadas y anotadas", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(ESPERADAS);
    for (const t of tools) {
      expect(t.description?.length ?? 0).toBeGreaterThan(80);
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("expone los parametros al modelo (no un esquema vacio)", async () => {
    const { tools } = await client.listTools();
    const lic = tools.find((t) => t.name === "dgcp_buscar_licitaciones")!;
    expect(Object.keys(lic.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(["termino", "estado", "orden", "institucion"]));
  });

  it("la calculadora legal funciona sin red", async () => {
    const r = await client.callTool({ name: "dgcp_calculadora_legal", arguments: { monto_estimado: 7_000_000 } });
    const txt = (r.content as Array<{ text: string }>)[0].text;
    expect(r.isError).toBeFalsy();
    expect(txt).toContain("Licitacion Publica");
    expect(txt).toContain("30 dias habiles");
  });

  it("el simulador valida la entrada y responde error estructurado", async () => {
    const r = await client.callTool({ name: "dgcp_simulador_puntuacion", arguments: { monto_referencial: -5, costo_total: 1 } });
    expect(r.isError).toBe(true);
  });
});
