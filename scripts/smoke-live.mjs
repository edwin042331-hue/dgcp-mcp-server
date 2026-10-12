// Prueba de humo contra la API real: arranca el servidor por stdio y ejecuta cada herramienta.
// Uso: npm run build && node scripts/smoke-live.mjs [nombre_herramienta]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CASOS = [
  ["dgcp_ultimas_licitaciones", { limite: 3 }],
  ["dgcp_buscar_licitaciones", { termino: "computadora, laptop, servidor", limite: 3 }],
  ["dgcp_buscar_licitaciones", { institucion: "MINERD", estado: "todos", limite: 2 }],
  ["dgcp_buscar_contratos", { rpe: 109993, limite: 2 }],
  ["dgcp_buscar_ofertas", { codigo_proceso: "MINISTERIO HACIENDA-DAF-CD-2026-0200", orden: "precio_menor" }],
  ["dgcp_buscar_proveedores", { termino: "HOSPITRONICA" }],
  ["dgcp_inteligencia_proceso", { codigo_proceso: "MIP-CCC-LPN-2026-0005" }],
  ["dgcp_radiografia_proveedor", { termino: "109993" }],
  ["dgcp_calculadora_legal", { monto_estimado: 3_000_000, modalidad_planteada: "Contratacion Menor", es_mipyme: true }],
  ["dgcp_oportunidades_para_mi", { rpe_o_rnc: "109993", limite: 3 }],
  ["dgcp_precios_referencia", { codigo_unspsc: "43211507" }],
  ["dgcp_plan_compras", { institucion: "INFOTEP", limite: 5 }],
  ["dgcp_generador_propuesta_sncc", { codigo_proceso: "MIP-CCC-LPN-2026-0005", razon_social: "Demo SRL", rnc: "131000000", rpe: 1, representante_legal: "Juan Perez", cedula_representante: "00100000001", monto_ofertado_subtotal: 1_000_000, es_mipyme: true }],
  ["dgcp_simulador_puntuacion", { monto_referencial: 1_000_000, costo_total: 780_000, precios_competidores: [930_000, 960_000] }],
  ["dgcp_auditoria_colusion", { codigo_proceso: "MINISTERIO HACIENDA-DAF-CD-2026-0200" }],
  ["dgcp_scorecard_institucion", { institucion: "INFOTEP" }],
  ["dgcp_auditor_pliego_trampa", { codigo_proceso: "MIP-CCC-LPN-2026-0005", extracto_pliego: "Se requiere switch Cisco Catalyst 9300 y carta de distribuidor exclusivo" }],
  ["dgcp_generador_recurso_impugnacion", { codigo_proceso: "MIP-CCC-LPN-2026-0005", acto_impugnado: "Acta de adjudicacion", fecha_notificacion: "2026-10-01", hechos: "La oferta fue descalificada sin motivacion pese a cumplir la ficha tecnica.", incluir_medida_cautelar: true, empresa_recurrente: "Demo SRL", rnc_recurrente: "131000000", representante: "Juan Perez" }],
];

const solo = process.argv.slice(2);
const t = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], stderr: "inherit" });
const c = new Client({ name: "smoke", version: "1" });
await c.connect(t);
const { tools } = await c.listTools();
console.log(`${tools.length} herramientas registradas`);
let fallos = 0;
for (const [nombre, args] of CASOS) {
  if (solo.length && !solo.includes(nombre)) continue;
  const t0 = Date.now();
  let r;
  try {
    r = await c.callTool({ name: nombre, arguments: args }, undefined, { timeout: 60_000 });
  } catch (err) {
    r = { isError: true, content: [{ type: "text", text: `EXCEPCION: ${err.message}` }] };
  }
  const txt = r.content?.[0]?.text ?? "";
  const ok = !r.isError && txt.length > 0;
  if (!ok) fallos++;
  console.log(`\n===== ${ok ? "OK " : "ERR"} ${nombre} (${Date.now() - t0} ms, ${txt.length} chars)`);
  console.log(txt.slice(0, Number(process.env.SMOKE_CHARS ?? 900)));
}
await c.close();
console.log(`\nFallos: ${fallos}`);
process.exit(fallos ? 1 : 0);
