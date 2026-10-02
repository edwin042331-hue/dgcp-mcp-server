// src/tools/proveedoresTools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  dgcpGetVariasPaginas, truncate, fixEncoding,
  normalizar, DgcpApiError,
} from "../services/dgcpClient.js";
import { MAX_RESPONSE_CHARS, DEFAULT_PAGE_SIZE, PAGINAS_A_ESCANEAR, TAMANO_PAGINA_API } from "../constants.js";
import type { ProveedorReal } from "../types.js";

const Schema = z.object({
  termino: z.string().optional()
    .describe("Texto a buscar en razon social, RNC, contacto, direccion o correo."),
  rnc: z.string().optional()
    .describe("Numero de RNC o identificacion del proveedor (numero_documento)."),
  rpe: z.union([z.string(), z.number()]).optional()
    .describe("Numero de Registro de Proveedores del Estado (RPE)."),
  mipyme: z.boolean().optional()
    .describe("true = solo proveedores clasificados como MIPYME."),
  rubro: z.string().optional()
    .describe("Rubro que provee: 'Bienes', 'Servicios', 'Obras'."),
  provincia: z.string().optional()
    .describe("Provincia del proveedor (ej. 'Distrito Nacional', 'Santiago', etc.)."),
  estado: z.string().optional()
    .describe("Estado en el RPE (ej. 'Activo', 'Inactivo')."),
  paginas: z.number().int().min(1).max(20).optional()
    .describe(`Cuantas paginas de la API escanear (default ${PAGINAS_A_ESCANEAR}, 100 proveedores c/u)`),
  limite: z.number().int().min(1).max(50).optional()
    .describe(`Cuantos resultados devolver (default ${DEFAULT_PAGE_SIZE})`),
}).strict();

type Input = z.infer<typeof Schema>;

function formatProveedor(p: ProveedorReal, idx: number): string {
  const lineas = [
    `**${idx}. ${fixEncoding(p.razon_social)}**`,
    `   RPE: ${p.rpe ?? "N/D"} | ${p.tipo_documento ?? "Doc"}: ${p.numero_documento ?? "N/D"}`,
    `   Estado RPE: ${fixEncoding(p.estado)} | Tipo: ${fixEncoding(p.tipo_persona)} (${fixEncoding(p.forma_juridica)})`,
    `   MIPYME: ${p.es_mipyme === "Si" ? "Si" : "No"}${p.certificacion_micm === "Si" ? " (Certificada MICM)" : ""}`,
    `   Rubro: ${fixEncoding(p.provee)}`,
    `   Ubicacion: ${fixEncoding(p.provincia ?? "N/D")}${p.municipio ? ", " + fixEncoding(p.municipio) : ""}`,
  ];
  if (p.direccion) lineas.push(`   Direccion: ${fixEncoding(p.direccion)}`);
  if (p.contacto || p.telefono_comercial || p.correo_comercial) {
    const cont = p.contacto ? `${fixEncoding(p.contacto).trim()} (${fixEncoding(p.posicion_contacto || "Contacto").trim()})` : "";
    const tel = p.telefono_comercial || p.telefono_contacto || "";
    const email = p.correo_comercial || p.correo_contacto || "";
    const datos = [cont, tel, email].filter(Boolean).join(" | ");
    if (datos) lineas.push(`   Contacto: ${datos}`);
  }
  if (p.url_certificacion) lineas.push(`   Constancia RPE: ${p.url_certificacion}`);
  return lineas.join("\n");
}

export function registerProveedoresTools(server: McpServer): void {
  server.registerTool("dgcp_buscar_proveedores", {
    title: "Buscar proveedores en el RPE (DGCP)",
    description: `Consulta empresas y personas físicas registradas en el Registro de Proveedores del Estado (RPE).
Campos VERIFICADOS contra la API real (/proveedores).

Permite verificar RPE, RNC, clasificación MIPYME, rubros que proveen (bienes, servicios), datos de contacto y constancia oficial.
La API descarga varias páginas y filtra localmente.

Args: termino, rnc, rpe, mipyme, rubro, provincia, estado, paginas, limite.`,
    inputSchema: Schema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: Input) => {
    try {
      const paginas = params.paginas ?? PAGINAS_A_ESCANEAR;
      const limite = params.limite ?? DEFAULT_PAGE_SIZE;

      const { items, total } = await dgcpGetVariasPaginas<ProveedorReal>(
        "proveedores", paginas, TAMANO_PAGINA_API
      );

      let res = items;

      if (params.termino) {
        const t = normalizar(fixEncoding(params.termino));
        res = res.filter((p) =>
          normalizar(fixEncoding(p.razon_social)).includes(t) ||
          normalizar(fixEncoding(p.numero_documento)).includes(t) ||
          normalizar(fixEncoding(p.contacto)).includes(t) ||
          normalizar(fixEncoding(p.correo_comercial)).includes(t) ||
          normalizar(fixEncoding(p.direccion)).includes(t)
        );
      }
      if (params.rnc) {
        const rnc = params.rnc.replace(/[^0-9]/g, "");
        res = res.filter((p) => String(p.numero_documento ?? "").replace(/[^0-9]/g, "").includes(rnc));
      }
      if (params.rpe !== undefined) {
        const rpeStr = String(params.rpe).trim();
        res = res.filter((p) => String(p.rpe ?? "").trim() === rpeStr);
      }
      if (params.mipyme) {
        res = res.filter((p) => p.es_mipyme === "Si");
      }
      if (params.rubro) {
        const rub = normalizar(params.rubro);
        res = res.filter((p) => normalizar(p.provee).includes(rub));
      }
      if (params.provincia) {
        const prov = normalizar(fixEncoding(params.provincia));
        res = res.filter((p) => normalizar(fixEncoding(p.provincia)).includes(prov));
      }
      if (params.estado) {
        const est = normalizar(params.estado);
        res = res.filter((p) => normalizar(p.estado).includes(est));
      }

      if (res.length === 0) {
        return { content: [{ type: "text", text:
          `No se encontraron proveedores con esos criterios dentro de los ${items.length} mas recientes ` +
          `(de ${total.toLocaleString()} en total en el RPE).\n\n` +
          `Sugerencias: sube 'paginas' (ej. 10 o 15), o verifica el RNC/nombre.` }] };
      }

      const mostrados = res.slice(0, limite);

      const out = [
        `## Proveedores del Estado (RPE) - DGCP`,
        `Escaneados: ${items.length} proveedores recientes (de ${total.toLocaleString()} en total).`,
        `Coinciden: ${res.length}. Mostrando ${mostrados.length}.`,
        "",
      ];
      mostrados.forEach((p, i) => { out.push(formatProveedor(p, i + 1), ""); });
      if (res.length > mostrados.length) {
        out.push(`--- Hay ${res.length - mostrados.length} coincidencias mas. Sube 'limite' para verlas.`);
      }

      return { content: [{ type: "text", text: truncate(out.join("\n"), MAX_RESPONSE_CHARS) }] };
    } catch (err) {
      if (err instanceof DgcpApiError) {
        return { content: [{ type: "text", text: `Error consultando proveedores DGCP: ${err.message}` }] };
      }
      throw err;
    }
  });
}
