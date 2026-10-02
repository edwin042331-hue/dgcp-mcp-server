// src/tools/ofertasTools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  dgcpGetVariasPaginas, formatMonto, truncate, fixEncoding,
  soloFecha, normalizar, DgcpApiError,
} from "../services/dgcpClient.js";
import { MAX_RESPONSE_CHARS, DEFAULT_PAGE_SIZE, PAGINAS_A_ESCANEAR, TAMANO_PAGINA_API } from "../constants.js";
import type { OfertaReal } from "../types.js";

const Schema = z.object({
  termino: z.string().optional()
    .describe("Texto a buscar en nombre de la oferta, codigo de proceso, oferente o institucion."),
  codigo_proceso: z.string().optional()
    .describe("Codigo del proceso de licitacion (ej. 'HLA-DAF-CD-2026-0129')."),
  proveedor: z.string().optional()
    .describe("Nombre o razon social del oferente participante."),
  rpe: z.union([z.string(), z.number()]).optional()
    .describe("Numero de RPE del oferente."),
  institucion: z.string().optional()
    .describe("Nombre de la institucion contratante."),
  estado_evaluacion: z.string().optional()
    .describe("Estado de evaluacion (ej. 'Pendiente', 'Adjudicada', 'Descalificada', etc.)."),
  monto_min: z.number().min(0).optional().describe("Monto minimo de la oferta en DOP"),
  monto_max: z.number().min(0).optional().describe("Monto maximo de la oferta en DOP"),
  paginas: z.number().int().min(1).max(20).optional()
    .describe(`Cuantas paginas de la API escanear (default ${PAGINAS_A_ESCANEAR}, 100 ofertas c/u)`),
  limite: z.number().int().min(1).max(50).optional()
    .describe(`Cuantos resultados devolver (default ${DEFAULT_PAGE_SIZE})`),
}).strict();

type Input = z.infer<typeof Schema>;

function formatOferta(o: OfertaReal, idx: number): string {
  const lineas = [
    `**${idx}. ${fixEncoding(o.nombre_oferta?.trim() || o.id_oferta)}**`,
    `   Oferta ID: ${o.id_oferta ?? "N/D"} | Proceso: ${o.codigo_proceso ?? "N/D"}`,
    `   Oferente: ${fixEncoding(o.razon_social)} (RPE: ${o.rpe ?? "N/D"})`,
    `   Institucion: ${fixEncoding(o.unidad_compra)}`,
    `   Valor ofertado: ${formatMonto(o.valor_oferta, "DOP")}`,
    `   Estado Oferta: ${fixEncoding(o.estado_oferta)} | Evaluacion: ${fixEncoding(o.estado_evaluacion)}`,
    `   Tipo Entrega: ${fixEncoding(o.tipo_oferta)}`,
  ];
  if (o.fecha_entrega_oferta) lineas.push(`   Fecha entrega: ${soloFecha(o.fecha_entrega_oferta)}`);
  if (o.fecha_evaluacion) lineas.push(`   Fecha evaluacion: ${soloFecha(o.fecha_evaluacion)}`);
  return lineas.join("\n");
}

export function registerOfertasTools(server: McpServer): void {
  server.registerTool("dgcp_buscar_ofertas", {
    title: "Buscar ofertas presentadas en licitaciones (DGCP)",
    description: `Consulta propuestas y ofertas presentadas por proveedores y competidores en procesos de compra del Estado.
Campos VERIFICADOS contra la API real (/ofertas).

Permite analizar montos ofertados por competidores, estados de evaluacion y que empresas participaron en cada licitacion.
La API descarga varias paginas y filtra localmente.

Args: termino, codigo_proceso, proveedor, rpe, institucion, estado_evaluacion, monto_min, monto_max, paginas, limite.`,
    inputSchema: Schema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: Input) => {
    try {
      const paginas = params.paginas ?? PAGINAS_A_ESCANEAR;
      const limite = params.limite ?? DEFAULT_PAGE_SIZE;

      const { items, total } = await dgcpGetVariasPaginas<OfertaReal>(
        "ofertas", paginas, TAMANO_PAGINA_API
      );

      let res = items;

      if (params.termino) {
        const t = normalizar(fixEncoding(params.termino));
        res = res.filter((o) =>
          normalizar(fixEncoding(o.nombre_oferta)).includes(t) ||
          normalizar(fixEncoding(o.codigo_proceso)).includes(t) ||
          normalizar(fixEncoding(o.razon_social)).includes(t) ||
          normalizar(fixEncoding(o.unidad_compra)).includes(t) ||
          normalizar(fixEncoding(o.id_oferta)).includes(t)
        );
      }
      if (params.codigo_proceso) {
        const cp = normalizar(params.codigo_proceso);
        res = res.filter((o) => normalizar(o.codigo_proceso).includes(cp));
      }
      if (params.proveedor) {
        const prov = normalizar(fixEncoding(params.proveedor));
        res = res.filter((o) => normalizar(fixEncoding(o.razon_social)).includes(prov));
      }
      if (params.rpe !== undefined) {
        const rpeStr = String(params.rpe).trim();
        res = res.filter((o) => String(o.rpe ?? "").trim() === rpeStr);
      }
      if (params.institucion) {
        const inst = normalizar(fixEncoding(params.institucion));
        res = res.filter((o) => normalizar(fixEncoding(o.unidad_compra)).includes(inst));
      }
      if (params.estado_evaluacion) {
        const ee = normalizar(params.estado_evaluacion);
        res = res.filter((o) => normalizar(o.estado_evaluacion).includes(ee));
      }
      if (params.monto_min !== undefined) {
        res = res.filter((o) => typeof o.valor_oferta === "number" && o.valor_oferta >= params.monto_min!);
      }
      if (params.monto_max !== undefined) {
        res = res.filter((o) => typeof o.valor_oferta === "number" && o.valor_oferta <= params.monto_max!);
      }

      if (res.length === 0) {
        return { content: [{ type: "text", text:
          `No se encontraron ofertas con esos criterios dentro de las ${items.length} mas recientes ` +
          `(de ${total.toLocaleString()} en total en la DGCP).\n\n` +
          `Sugerencias: sube 'paginas' (ej. 10 o 15), o verifica el codigo del proceso.` }] };
      }

      const mostrados = res.slice(0, limite);
      const suma = mostrados.reduce((s, o) => s + (typeof o.valor_oferta === "number" ? o.valor_oferta : 0), 0);

      const out = [
        `## Ofertas presentadas DGCP`,
        `Escaneadas: ${items.length} ofertas recientes (de ${total.toLocaleString()} en total).`,
        `Coinciden: ${res.length}. Mostrando ${mostrados.length}.`,
        `Monto sumado ofertado de los mostrados: ${formatMonto(suma)}`,
        "",
      ];
      mostrados.forEach((o, i) => { out.push(formatOferta(o, i + 1), ""); });
      if (res.length > mostrados.length) {
        out.push(`--- Hay ${res.length - mostrados.length} coincidencias mas. Sube 'limite' para verlas.`);
      }

      return { content: [{ type: "text", text: truncate(out.join("\n"), MAX_RESPONSE_CHARS) }] };
    } catch (err) {
      if (err instanceof DgcpApiError) {
        return { content: [{ type: "text", text: `Error consultando ofertas DGCP: ${err.message}` }] };
      }
      throw err;
    }
  });
}
