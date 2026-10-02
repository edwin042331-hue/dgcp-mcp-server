// src/tools/contratosTools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  dgcpGetVariasPaginas, formatMonto, truncate, fixEncoding,
  soloFecha, normalizar, DgcpApiError,
} from "../services/dgcpClient.js";
import { MAX_RESPONSE_CHARS, DEFAULT_PAGE_SIZE, PAGINAS_A_ESCANEAR, TAMANO_PAGINA_API } from "../constants.js";
import type { ContratoReal } from "../types.js";

const Schema = z.object({
  termino: z.string().optional()
    .describe("Texto a buscar en descripcion, codigo de contrato o proceso, proveedor o institucion."),
  codigo_proceso: z.string().optional()
    .describe("Codigo del proceso de licitacion asociado (ej. 'HLA-DAF-CD-2026-0121')."),
  institucion: z.string().optional()
    .describe("Nombre o parte del nombre de la institucion (unidad de compra)."),
  proveedor: z.string().optional()
    .describe("Nombre o razon social de la empresa adjudicataria."),
  rpe: z.union([z.string(), z.number()]).optional()
    .describe("Numero de Registro de Proveedores del Estado (RPE) del adjudicatario."),
  estado_contrato: z.string().optional()
    .describe("Estado del contrato (ej. 'Activo', 'Cerrado', etc.)."),
  monto_min: z.number().min(0).optional().describe("Monto minimo contratado en DOP"),
  monto_max: z.number().min(0).optional().describe("Monto maximo contratado en DOP"),
  paginas: z.number().int().min(1).max(20).optional()
    .describe(`Cuantas paginas de la API escanear (default ${PAGINAS_A_ESCANEAR}, 100 contratos c/u)`),
  limite: z.number().int().min(1).max(50).optional()
    .describe(`Cuantos resultados devolver (default ${DEFAULT_PAGE_SIZE})`),
}).strict();

type Input = z.infer<typeof Schema>;

function formatContrato(c: ContratoReal, idx: number): string {
  const lineas = [
    `**${idx}. ${fixEncoding(c.descripcion?.trim() || c.codigo_contrato)}**`,
    `   Codigo Contrato: ${c.codigo_contrato ?? "N/D"}`,
    `   Codigo Proceso: ${c.codigo_proceso ?? "N/D"}`,
    `   Adjudicatario: ${fixEncoding(c.razon_social)} (RPE: ${c.rpe ?? "N/D"})`,
    `   Institucion: ${fixEncoding(c.unidad_compra)}`,
    `   Monto contratado: ${formatMonto(c.valor_contratado, String(c.divisa ?? "DOP"))}`,
    `   Estado Contrato: ${fixEncoding(c.estado_contrato)} | Adjudicacion: ${fixEncoding(c.estado_adjudicacion)}`,
  ];
  if (c.fecha_adjudicacion) lineas.push(`   Fecha adjudicacion: ${soloFecha(c.fecha_adjudicacion)}`);
  if (c.fecha_creacion_contrato) lineas.push(`   Fecha contrato: ${soloFecha(c.fecha_creacion_contrato)}`);
  if (c.metodo_pago || c.plazo_pago_factura) {
    lineas.push(`   Pago: ${fixEncoding(c.metodo_pago ?? "N/D")} (Plazo: ${fixEncoding(c.plazo_pago_factura ?? "N/D")})`);
  }
  if (c.url_contrato) lineas.push(`   Enlace: ${c.url_contrato}`);
  return lineas.join("\n");
}

export function registerContratosTools(server: McpServer): void {
  server.registerTool("dgcp_buscar_contratos", {
    title: "Buscar contratos adjudicados y firmados (DGCP)",
    description: `Consulta contratos firmados y adjudicados por instituciones del Estado dominicano con proveedores.
Campos VERIFICADOS contra la API real (/contratos).

Permite saber quien gano licitaciones anteriores, los montos adjudicados, formas de pago y fechas de firma.
La API descarga varias paginas y filtra localmente por termino, codigo de proceso, institucion o proveedor.

Args: termino, codigo_proceso, institucion, proveedor, rpe, estado_contrato, monto_min, monto_max, paginas, limite.`,
    inputSchema: Schema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: Input) => {
    try {
      const paginas = params.paginas ?? PAGINAS_A_ESCANEAR;
      const limite = params.limite ?? DEFAULT_PAGE_SIZE;

      const { items, total } = await dgcpGetVariasPaginas<ContratoReal>(
        "contratos", paginas, TAMANO_PAGINA_API
      );

      let res = items;

      if (params.termino) {
        const t = normalizar(fixEncoding(params.termino));
        res = res.filter((c) =>
          normalizar(fixEncoding(c.descripcion)).includes(t) ||
          normalizar(fixEncoding(c.codigo_contrato)).includes(t) ||
          normalizar(fixEncoding(c.codigo_proceso)).includes(t) ||
          normalizar(fixEncoding(c.razon_social)).includes(t) ||
          normalizar(fixEncoding(c.unidad_compra)).includes(t)
        );
      }
      if (params.codigo_proceso) {
        const cp = normalizar(params.codigo_proceso);
        res = res.filter((c) => normalizar(c.codigo_proceso).includes(cp));
      }
      if (params.institucion) {
        const i = normalizar(fixEncoding(params.institucion));
        res = res.filter((c) => normalizar(fixEncoding(c.unidad_compra)).includes(i));
      }
      if (params.proveedor) {
        const prov = normalizar(fixEncoding(params.proveedor));
        res = res.filter((c) => normalizar(fixEncoding(c.razon_social)).includes(prov));
      }
      if (params.rpe !== undefined) {
        const rpeStr = String(params.rpe).trim();
        res = res.filter((c) => String(c.rpe ?? "").trim() === rpeStr);
      }
      if (params.estado_contrato) {
        const ec = normalizar(params.estado_contrato);
        res = res.filter((c) => normalizar(c.estado_contrato).includes(ec));
      }
      if (params.monto_min !== undefined) {
        res = res.filter((c) => typeof c.valor_contratado === "number" && c.valor_contratado >= params.monto_min!);
      }
      if (params.monto_max !== undefined) {
        res = res.filter((c) => typeof c.valor_contratado === "number" && c.valor_contratado <= params.monto_max!);
      }

      if (res.length === 0) {
        return { content: [{ type: "text", text:
          `No se encontraron contratos con esos criterios dentro de los ${items.length} mas recientes ` +
          `(de ${total.toLocaleString()} en total en la DGCP).\n\n` +
          `Sugerencias: sube 'paginas' (ej. 10 o 15), o amplía el termino de busqueda.` }] };
      }

      const mostrados = res.slice(0, limite);
      const suma = mostrados.reduce((s, c) => s + (typeof c.valor_contratado === "number" ? c.valor_contratado : 0), 0);

      const out = [
        `## Contratos adjudicados DGCP`,
        `Escaneados: ${items.length} contratos recientes (de ${total.toLocaleString()} en total).`,
        `Coinciden: ${res.length}. Mostrando ${mostrados.length}.`,
        `Monto sumado de los mostrados: ${formatMonto(suma)}`,
        "",
      ];
      mostrados.forEach((c, i) => { out.push(formatContrato(c, i + 1), ""); });
      if (res.length > mostrados.length) {
        out.push(`--- Hay ${res.length - mostrados.length} coincidencias mas. Sube 'limite' para verlas.`);
      }

      return { content: [{ type: "text", text: truncate(out.join("\n"), MAX_RESPONSE_CHARS) }] };
    } catch (err) {
      if (err instanceof DgcpApiError) {
        return { content: [{ type: "text", text: `Error consultando contratos DGCP: ${err.message}` }] };
      }
      throw err;
    }
  });
}
