// src/tools/genericosTools.ts
//
// Herramientas para /contratos, /ofertas y /proveedores.
// Sus campos AUN NO estan mapeados, asi que en vez de inventar nombres
// (lo que produce "N/D" en todo) se imprimen las claves que la API
// devuelve de verdad. Funcionan desde ya y ademas revelan el esquema.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  dgcpGetVariasPaginas, formatRegistroGenerico, registroContiene,
  truncate, DgcpApiError,
} from "../services/dgcpClient.js";
import { MAX_RESPONSE_CHARS, DEFAULT_PAGE_SIZE, PAGINAS_A_ESCANEAR, TAMANO_PAGINA_API } from "../constants.js";
import type { RegistroGenerico } from "../types.js";

const Schema = z.object({
  termino: z.string().optional()
    .describe("Texto a buscar en cualquier campo del registro (institucion, proveedor, objeto, RNC...)"),
  paginas: z.number().int().min(1).max(20).optional()
    .describe(`Paginas de la API a escanear (default ${PAGINAS_A_ESCANEAR}, 100 registros c/u)`),
  limite: z.number().int().min(1).max(50).optional()
    .describe(`Resultados a devolver (default ${DEFAULT_PAGE_SIZE})`),
  mostrar_campos: z.boolean().optional()
    .describe("true = devuelve solo la lista de campos que expone el endpoint, util para mapearlo"),
}).strict();

type Input = z.infer<typeof Schema>;

interface Def {
  tool: string;
  endpoint: string;
  titulo: string;
  que: string;
}

const DEFINICIONES: Def[] = [
  {
    tool: "dgcp_buscar_contratos",
    endpoint: "contratos",
    titulo: "Buscar contratos publicos (DGCP)",
    que: "contratos firmados entre instituciones del Estado dominicano y proveedores",
  },
  {
    tool: "dgcp_buscar_ofertas",
    endpoint: "ofertas",
    titulo: "Buscar ofertas presentadas (DGCP)",
    que: "ofertas que las empresas presentaron en procesos de licitacion",
  },
  {
    tool: "dgcp_buscar_proveedores",
    endpoint: "proveedores",
    titulo: "Buscar proveedores del Estado / RPE (DGCP)",
    que: "empresas y personas inscritas en el Registro de Proveedores del Estado",
  },
];

export function registerGenericosTools(server: McpServer): void {
  for (const def of DEFINICIONES) {
    server.registerTool(def.tool, {
      title: def.titulo,
      description: `Consulta ${def.que}, desde el endpoint /${def.endpoint} de la API DGCP.

AVISO: los campos de este endpoint todavia NO estan mapeados. La herramienta imprime
los nombres de campo tal como los devuelve la API, sin interpretarlos. Son datos reales,
solo que sin formato bonito. Usa mostrar_campos=true para ver el esquema del endpoint.

La API no filtra del lado del servidor: se descargan varias paginas y se filtra localmente
con 'termino', que busca en todos los campos de texto del registro.

Args: termino, paginas (default ${PAGINAS_A_ESCANEAR}), limite (default ${DEFAULT_PAGE_SIZE}), mostrar_campos.`,
      inputSchema: Schema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async (params: Input) => {
      try {
        const paginas = params.mostrar_campos ? 1 : (params.paginas ?? PAGINAS_A_ESCANEAR);
        const limite = params.limite ?? DEFAULT_PAGE_SIZE;

        const { items, total } = await dgcpGetVariasPaginas<RegistroGenerico>(
          def.endpoint, paginas, params.mostrar_campos ? 1 : TAMANO_PAGINA_API
        );

        if (items.length === 0) {
          return { content: [{ type: "text", text: `El endpoint /${def.endpoint} no devolvio registros.` }] };
        }

        if (params.mostrar_campos) {
          const campos = Object.entries(items[0]).map(
            ([k, v]) => `  ${k}: ${v === null ? "null" : typeof v} = ${JSON.stringify(v)?.slice(0, 80)}`
          );
          return { content: [{ type: "text", text:
            `## Esquema de /${def.endpoint}\nTotal de registros en la API: ${total.toLocaleString()}\n\n` +
            `Campos del primer registro:\n${campos.join("\n")}` }] };
        }

        const res = params.termino
          ? items.filter((r) => registroContiene(r, params.termino!))
          : items;

        if (res.length === 0) {
          return { content: [{ type: "text", text:
            `Sin coincidencias para "${params.termino}" dentro de los ${items.length} registros mas recientes ` +
            `de /${def.endpoint} (${total.toLocaleString()} en total). Sube 'paginas' o cambia el termino.` }] };
        }

        const mostrados = res.slice(0, limite);
        const out = [
          `## /${def.endpoint} - DGCP`,
          `Escaneados: ${items.length} registros recientes (de ${total.toLocaleString()} en total). Coinciden: ${res.length}.`,
          `Campos sin mapear: se muestran con el nombre original de la API.`,
          "",
        ];
        mostrados.forEach((r, i) => { out.push(formatRegistroGenerico(r, i + 1), ""); });
        if (res.length > mostrados.length) {
          out.push(`--- ${res.length - mostrados.length} coincidencias mas. Sube 'limite'.`);
        }

        return { content: [{ type: "text", text: truncate(out.join("\n"), MAX_RESPONSE_CHARS) }] };
      } catch (err) {
        if (err instanceof DgcpApiError) {
          return { content: [{ type: "text", text: `Error consultando /${def.endpoint}: ${err.message}` }] };
        }
        throw err;
      }
    });
  }
}
