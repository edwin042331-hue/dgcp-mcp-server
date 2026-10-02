// src/tools/procesosTools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  dgcpGetVariasPaginas, formatMonto, truncate, fixEncoding,
  soloFecha, diasHasta, sigueAbierto, normalizar, DgcpApiError,
} from "../services/dgcpClient.js";
import { MAX_RESPONSE_CHARS, DEFAULT_PAGE_SIZE, PAGINAS_A_ESCANEAR, TAMANO_PAGINA_API } from "../constants.js";
import type { ProcesoReal } from "../types.js";

const Schema = z.object({
  termino: z.string().optional()
    .describe("Texto a buscar en titulo y descripcion. Ej: 'software', 'laptop', 'servidor'"),
  institucion: z.string().optional()
    .describe("Nombre (o parte) de la institucion. Ej: 'Impuestos Internos', 'Educacion'"),
  estado: z.enum(["abierto", "publicado", "adjudicado", "cerrado", "apertura", "todos"]).optional()
    .describe("'abierto' = publicado Y con fecha de cierre futura (lo que casi siempre se quiere)"),
  modalidad: z.string().optional()
    .describe("Texto de la modalidad. Ej: 'Licitacion Publica', 'Compras Menores'"),
  mipyme: z.boolean().optional().describe("Solo procesos dirigidos a MIPYMES"),
  mipyme_mujer: z.boolean().optional().describe("Solo procesos dirigidos a MIPYMES de mujeres"),
  monto_min: z.number().min(0).optional().describe("Monto minimo estimado en DOP"),
  monto_max: z.number().min(0).optional().describe("Monto maximo estimado en DOP"),
  paginas: z.number().int().min(1).max(20).optional()
    .describe(`Cuantas paginas de la API escanear (default ${PAGINAS_A_ESCANEAR}, 100 procesos c/u)`),
  limite: z.number().int().min(1).max(50).optional()
    .describe(`Cuantos resultados devolver (default ${DEFAULT_PAGE_SIZE})`),
}).strict();

type Input = z.infer<typeof Schema>;

function formatProceso(p: ProcesoReal, idx: number): string {
  const dias = diasHasta(p.fecha_fin_recepcion_ofertas);
  const cierre = soloFecha(p.fecha_fin_recepcion_ofertas);
  const aviso = dias === null ? "" : dias < 0 ? " (YA CERRO)" : dias === 0 ? " (CIERRA HOY)" : ` (faltan ${dias} dias)`;

  const lineas = [
    `**${idx}. ${fixEncoding(p.titulo)}**`,
    `   Codigo: ${p.codigo_proceso ?? "N/D"}`,
    `   Institucion: ${fixEncoding(p.unidad_compra)}`,
    `   Estado: ${fixEncoding(p.estado_proceso)}`,
    `   Modalidad: ${fixEncoding(p.modalidad)}`,
    `   Monto estimado: ${formatMonto(p.monto_estimado, String(p.divisa ?? "DOP"))}`,
    `   Cierre de ofertas: ${cierre}${aviso}`,
  ];
  if (p.fecha_publicacion) lineas.push(`   Publicado: ${soloFecha(p.fecha_publicacion)}`);
  if (p.objeto_proceso) lineas.push(`   Objeto: ${fixEncoding(p.objeto_proceso)}`);
  if (p.dirigido_mipymes === "Si") {
    lineas.push(`   MIPYME: si${p.dirigido_mipymes_mujeres === "Si" ? " (mujeres)" : ""}`);
  }
  if (p.url) lineas.push(`   Enlace: ${p.url}`);
  return lineas.join("\n");
}

export function registerProcesosTools(server: McpServer): void {
  server.registerTool("dgcp_buscar_licitaciones", {
    title: "Buscar licitaciones y procesos de compra (DGCP)",
    description: `Busca procesos de compra publica del Estado dominicano. Campos VERIFICADOS contra la API real.

IMPORTANTE - como funciona la API:
- La API NO filtra del lado del servidor. Siempre devuelve los procesos mas recientes primero.
- Esta herramienta descarga varias paginas (parametro 'paginas', default ${PAGINAS_A_ESCANEAR} = ${PAGINAS_A_ESCANEAR * TAMANO_PAGINA_API} procesos) y filtra localmente.
- Un termino generico deja fuera resultados. Para un tema, haz VARIAS llamadas con terminos distintos
  (ej. tecnologia: software, licencia, computadora, laptop, servidor, redes, impresora, sistema) y une los resultados.

Estado:
- 'abierto'    = estado "Proceso publicado" Y fecha de cierre aun futura. Es lo que se quiere el 90% de las veces.
- 'publicado'  = estado publicado sin importar la fecha
- 'adjudicado' = ya tiene ganador
- 'apertura'   = sobres abiertos
- 'cerrado'    = etapa cerrada
- 'todos'      = sin filtrar

Devuelve: codigo, institucion, estado, modalidad, monto, fecha de cierre con dias restantes, MIPYME y enlace al portal.`,
    inputSchema: Schema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: Input) => {
    try {
      const paginas = params.paginas ?? PAGINAS_A_ESCANEAR;
      const limite = params.limite ?? DEFAULT_PAGE_SIZE;

      const { items, total, paginasDescargadas, paginasFallidas, fechaConsulta } = await dgcpGetVariasPaginas<ProcesoReal>(
        "procesos", paginas, TAMANO_PAGINA_API
      );

      let res = items;

      if (params.termino) {
        const t = normalizar(fixEncoding(params.termino));
        res = res.filter((p) =>
          normalizar(fixEncoding(p.titulo)).includes(t) ||
          normalizar(fixEncoding(p.descripcion)).includes(t)
        );
      }
      if (params.institucion) {
        const i = normalizar(fixEncoding(params.institucion));
        res = res.filter((p) => normalizar(fixEncoding(p.unidad_compra)).includes(i));
      }
      if (params.modalidad) {
        const m = normalizar(fixEncoding(params.modalidad));
        res = res.filter((p) => normalizar(fixEncoding(p.modalidad)).includes(m));
      }
      const estado = params.estado ?? "todos";
      if (estado !== "todos") {
        res = res.filter((p) => {
          const e = normalizar(fixEncoding(p.estado_proceso));
          switch (estado) {
            case "abierto":    return e.includes("publicado") && sigueAbierto(p.fecha_fin_recepcion_ofertas);
            case "publicado":  return e.includes("publicado");
            case "adjudicado": return e.includes("adjudicado");
            case "apertura":   return e.includes("sobres");
            case "cerrado":    return e.includes("cerrada") || e.includes("cerrado");
            default:           return true;
          }
        });
      }
      if (params.mipyme) res = res.filter((p) => p.dirigido_mipymes === "Si");
      if (params.mipyme_mujer) res = res.filter((p) => p.dirigido_mipymes_mujeres === "Si");
      if (params.monto_min !== undefined) {
        res = res.filter((p) => typeof p.monto_estimado === "number" && p.monto_estimado >= params.monto_min!);
      }
      if (params.monto_max !== undefined) {
        res = res.filter((p) => typeof p.monto_estimado === "number" && p.monto_estimado <= params.monto_max!);
      }

      // Mas urgente primero
      res.sort((a, b) => {
        const fa = Date.parse(String(a.fecha_fin_recepcion_ofertas ?? "")) || Number.MAX_SAFE_INTEGER;
        const fb = Date.parse(String(b.fecha_fin_recepcion_ofertas ?? "")) || Number.MAX_SAFE_INTEGER;
        return fa - fb;
      });

      const avisoFallas = paginasFallidas.length > 0
        ? `\n⚠️ ADVERTENCIA: No se pudieron descargar ${paginasFallidas.length} páginas (${paginasFallidas.join(", ")}) debido a intermitencia en la API DGCP.`
        : "";

      if (res.length === 0) {
        return { content: [{ type: "text", text:
          `No se encontraron procesos con esos criterios dentro de la muestra de ${items.length} procesos más recientes ` +
          `(de ${total.toLocaleString()} registrados históricamente en DGCP).\n` +
          avisoFallas +
          `\n*Nota de Cobertura:* Esta búsqueda abarcó las últimas ${paginasDescargadas} páginas. El hecho de que no aparezca en esta muestra no implica inexistencia en procesos anteriores o no publicados.\n` +
          `Sugerencias: amplía el término, incrementa el parámetro 'paginas' (ej. 10 o 15), o quita el filtro de estado.` }] };
      }

      const mostrados = res.slice(0, limite);
      const suma = mostrados.reduce((s, p) => s + (typeof p.monto_estimado === "number" ? p.monto_estimado : 0), 0);

      const out = [
        `## Procesos de compra DGCP`,
        `Escaneados: ${items.length} procesos recientes (${paginasDescargadas} páginas descargadas) de ${total.toLocaleString()} históricos. [Consulta: ${soloFecha(fechaConsulta)}]`,
      ];
      if (avisoFallas) out.push(avisoFallas);
      out.push(
        `Coinciden: ${res.length}. Mostrando ${mostrados.length}, del cierre mas proximo al mas lejano.`,
        `Monto sumado de los mostrados: ${formatMonto(suma)}`,
        "",
      );
      mostrados.forEach((p, i) => { out.push(formatProceso(p, i + 1), ""); });
      if (res.length > mostrados.length) {
        out.push(`--- Hay ${res.length - mostrados.length} coincidencias mas. Sube 'limite' para verlas.`);
      }

      return { content: [{ type: "text", text: truncate(out.join("\n"), MAX_RESPONSE_CHARS) }] };
    } catch (err) {
      if (err instanceof DgcpApiError) {
        return { content: [{ type: "text", text: `Error consultando la DGCP: ${err.message}` }] };
      }
      throw err;
    }
  });
}
