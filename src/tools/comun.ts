// src/tools/comun.ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DgcpApiError, type ListadoResult } from "../services/dgcpClient.js";
import { MAX_RESPONSE_CHARS } from "../constants.js";
import { truncate, fixEncoding, formatMonto } from "../utils/texto.js";
import { formatFechaHoraRD, cuentaRegresiva, notaFrescura } from "../utils/fechas.js";
import type { ProcesoReal } from "../types.js";

export const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
export const CALCULO_LOCAL = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function texto(contenido: string): CallToolResult {
  return { content: [{ type: "text", text: truncate(contenido, MAX_RESPONSE_CHARS) }] };
}

/** Respuesta de error para el modelo: clara, accionable y marcada como error. */
export function errorHerramienta(contexto: string, err: unknown): CallToolResult {
  const detalle = err instanceof DgcpApiError
    ? err.message
    : err instanceof Error ? err.message : String(err);
  const sugerencia = err instanceof DgcpApiError && (err.statusCode === 429 || err.statusCode === 408 || (err.statusCode ?? 0) >= 500 || err.statusCode === 0)
    ? " La API de la DGCP esta lenta o saturada; reintenta en un minuto."
    : "";
  if (!(err instanceof DgcpApiError)) console.error(`[dgcp] ${contexto}:`, err);
  return { isError: true, content: [{ type: "text", text: `${contexto}: ${detalle}.${sugerencia}` }] };
}

/** Envuelve el manejador para que cualquier excepcion se convierta en respuesta de error. */
export function seguro<A>(contexto: string, fn: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      return errorHerramienta(contexto, err);
    }
  };
}

/** Linea de cobertura honesta: que porcion del universo filtrado se analizo. */
export function lineaCobertura(r: ListadoResult<unknown>, sustantivo: string): string {
  const base = r.completo
    ? `Cobertura: 100% (${r.items.length.toLocaleString("en-US")} de ${r.total.toLocaleString("en-US")} ${sustantivo}).`
    : `Cobertura parcial: ${r.items.length.toLocaleString("en-US")} de ${r.total.toLocaleString("en-US")} ${sustantivo} (los mas recientes).`;
  return r.paginasFallidas.length > 0
    ? `${base} Aviso: ${r.paginasFallidas.length} pagina(s) no se pudieron descargar tras reintentos.`
    : base;
}

export function pie(): string {
  return `\n---\n_${notaFrescura()}_`;
}

export function formatProceso(p: ProcesoReal, idx: number): string {
  const lineas = [
    `**${idx}. ${fixEncoding(p.titulo ?? p.descripcion ?? "Sin titulo").trim()}**`,
    `   Codigo: ${p.codigo_proceso ?? "N/D"} | ${fixEncoding(p.modalidad ?? "N/D")}`,
    `   Institucion: ${fixEncoding(p.unidad_compra ?? "N/D")}`,
    `   Monto estimado: ${formatMonto(p.monto_estimado, String(p.divisa ?? "DOP"))} | Estado: ${fixEncoding(p.estado_proceso ?? "N/D")}`,
    `   Publicado: ${formatFechaHoraRD(p.fecha_publicacion)} | Cierre: ${formatFechaHoraRD(p.fecha_fin_recepcion_ofertas)} (${cuentaRegresiva(p.fecha_fin_recepcion_ofertas)})`,
  ];
  const extras: string[] = [];
  if (p.objeto_proceso) extras.push(fixEncoding(p.objeto_proceso));
  if (p.dirigido_mipymes === "Si") extras.push(p.dirigido_mipymes_mujeres === "Si" ? "MIPYME mujeres" : "MIPYME");
  if (p.proceso_lotificado === "Si") extras.push("por lotes");
  if (extras.length) lineas.push(`   ${extras.join(" | ")}`);
  if (p.url) lineas.push(`   Portal: ${String(p.url).replace("//Public", "/Public")}`);
  return lineas.join("\n");
}
