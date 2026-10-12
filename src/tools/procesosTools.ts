// src/tools/procesosTools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dgcpListar } from "../services/dgcpClient.js";
import { resolverInstitucion } from "../services/catalogos.js";
import { DEFAULT_PAGE_SIZE, VENTANA_DIAS_POR_DEFECTO } from "../constants.js";
import { formatMonto, normalizar, terminosAlternativos, contieneAlguno, sumar } from "../utils/texto.js";
import { fechaISORD, sumarDias, parseFechaDGCP, sigueAbierto } from "../utils/fechas.js";
import { texto, seguro, lineaCobertura, pie, formatProceso, SOLO_LECTURA } from "./comun.js";
import type { ProcesoReal, QueryParams } from "../types.js";

/** Valores exactos de estado_proceso en la API (el filtro del servidor es por igualdad exacta). */
export const ESTADOS_API = {
  publicado: "Proceso publicado",
  evaluacion: "Sobres abiertos o aperturados",
  abriendo: "Sobres estan abriendose",
  cerrado: "Proceso con etapa cerrada",
  adjudicado: "Proceso adjudicado y celebrado",
  desierto: "Proceso desierto",
  cancelado: "Cancelado",
  suspendido: "Suspendido",
} as const;

export const ESTADOS = ["abierto", "publicado", "evaluacion", "cerrado", "adjudicado", "desierto", "cancelado", "suspendido", "todos"] as const;
export type Estado = (typeof ESTADOS)[number];
export type Orden = "recientes" | "cierre_proximo" | "monto_mayor";

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD");

export interface FiltrosLocales {
  terminos: string[];
  institucion?: string;
  modalidad?: string;
  estado: Estado;
  monto_min?: number;
  monto_max?: number;
}

/** Filtros que la API no aplica del lado del servidor. Funcion pura (probada en tests). */
export function filtrarProcesos(items: ProcesoReal[], f: FiltrosLocales, ahora: number = Date.now()): ProcesoReal[] {
  const inst = f.institucion ? normalizar(f.institucion) : "";
  const mod = f.modalidad ? normalizar(f.modalidad) : "";
  return items.filter((p) => {
    if (!contieneAlguno([p.titulo, p.descripcion, p.codigo_proceso], f.terminos)) return false;
    if (inst && !normalizar(p.unidad_compra).includes(inst)) return false;
    if (mod && !normalizar(p.modalidad).includes(mod)) return false;
    if (f.estado === "abierto" && !(p.estado_proceso === ESTADOS_API.publicado && sigueAbierto(p.fecha_fin_recepcion_ofertas, ahora))) return false;
    if (f.estado === "evaluacion" && p.estado_proceso !== ESTADOS_API.evaluacion && p.estado_proceso !== ESTADOS_API.abriendo) return false;
    const monto = typeof p.monto_estimado === "number" ? p.monto_estimado : null;
    if (f.monto_min !== undefined && (monto === null || monto < f.monto_min)) return false;
    if (f.monto_max !== undefined && (monto === null || monto > f.monto_max)) return false;
    return true;
  });
}

/** Orden estable y determinista. "recientes" = fecha de publicacion descendente. */
export function ordenarProcesos(items: ProcesoReal[], orden: Orden): ProcesoReal[] {
  const pub = (p: ProcesoReal) => parseFechaDGCP(p.fecha_publicacion) ?? -Infinity;
  const cierre = (p: ProcesoReal) => parseFechaDGCP(p.fecha_fin_recepcion_ofertas) ?? Infinity;
  const copia = [...items];
  if (orden === "recientes") copia.sort((a, b) => pub(b) - pub(a));
  else if (orden === "cierre_proximo") copia.sort((a, b) => cierre(a) - cierre(b) || pub(b) - pub(a));
  else copia.sort((a, b) => (b.monto_estimado ?? -1) - (a.monto_estimado ?? -1) || pub(b) - pub(a));
  return copia;
}

interface ConsultaProcesos {
  codigo_proceso?: string;
  institucion?: string;
  estado: Estado;
  mipyme?: boolean;
  mipyme_mujer?: boolean;
  publicado_desde?: string;
  publicado_hasta?: string;
}

/** Arma los filtros del servidor y descarga. Devuelve tambien que ventana se uso. */
async function descargarProcesos(c: ConsultaProcesos) {
  const base: QueryParams = {};
  let ventana = "";
  let institucionResuelta: string | undefined;
  let codigosUC: number[] = [];

  if (c.codigo_proceso) base.proceso = c.codigo_proceso.trim();
  if (c.mipyme) base.mipyme = true;
  if (c.mipyme_mujer) base.mipyme_mujer = true;

  const estadoApi =
    c.estado === "abierto" || c.estado === "publicado" ? ESTADOS_API.publicado :
    c.estado === "evaluacion" || c.estado === "todos" ? undefined :
    ESTADOS_API[c.estado];
  if (estadoApi) base.estado = estadoApi;

  if (c.institucion) {
    const unidades = await resolverInstitucion(c.institucion);
    if (unidades.length > 0 && unidades.length <= 5) {
      codigosUC = unidades.map((u) => u.codigo_unidad_compra);
      institucionResuelta = unidades.map((u) => `${u.unidad_compra} (cod. ${u.codigo_unidad_compra})`).join("; ");
    }
  }

  // Sin un filtro acotado del servidor, la API devolveria 600k+ procesos: se aplica una ventana de fechas.
  const acotado = Boolean(base.proceso) || base.estado === ESTADOS_API.publicado || codigosUC.length > 0;
  let desde = c.publicado_desde;
  const hasta = c.publicado_hasta;
  if (!desde && !hasta && !acotado) {
    desde = sumarDias(fechaISORD(), -VENTANA_DIAS_POR_DEFECTO);
    ventana = `Ventana aplicada: publicados desde ${desde} (usa 'publicado_desde' para ampliarla).`;
  }
  if (desde) base.startdate = desde;
  // enddate es exclusivo en la API: se suma un dia para que el filtro sea inclusivo.
  if (hasta) base.enddate = sumarDias(hasta, 1);
  else if (desde) base.enddate = sumarDias(fechaISORD(), 1);

  if (codigosUC.length > 0) {
    const partes = await Promise.all(codigosUC.map((uc) => dgcpListar<ProcesoReal>("procesos", { ...base, unidad_compra: uc })));
    const vistos = new Set<string>();
    const items = partes.flatMap((p) => p.items).filter((p) => {
      const k = String(p.codigo_proceso);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
    return {
      listado: {
        items,
        total: partes.reduce((s, p) => s + p.total, 0),
        paginasTotales: partes.reduce((s, p) => s + p.paginasTotales, 0),
        paginasDescargadas: partes.reduce((s, p) => s + p.paginasDescargadas, 0),
        paginasFallidas: partes.flatMap((p) => p.paginasFallidas),
        completo: partes.every((p) => p.completo),
      },
      ventana,
      institucionResuelta,
      institucionEnServidor: true,
    };
  }
  return { listado: await dgcpListar<ProcesoReal>("procesos", base), ventana, institucionResuelta, institucionEnServidor: false };
}

const BuscarSchema = z.object({
  termino: z.string().optional()
    .describe("Palabras a buscar en titulo/descripcion. Separa alternativas con coma: 'software, licencias, laptop' (coincide cualquiera)."),
  codigo_proceso: z.string().optional().describe("Codigo exacto del proceso, ej. 'MIP-CCC-LPN-2026-0005'."),
  institucion: z.string().optional().describe("Nombre, acronimo o codigo de la institucion. Ej: 'MINERD', 'Impuestos Internos', '141'."),
  estado: z.enum(ESTADOS).optional()
    .describe("'abierto' (default) = publicado y con cierre futuro. 'evaluacion' = sobres abiertos. 'todos' = sin filtro."),
  modalidad: z.string().optional().describe("Texto de la modalidad: 'Licitacion Publica', 'Contratacion Menor', 'Comparacion de Precios', 'Excepcion'..."),
  mipyme: z.boolean().optional().describe("Solo procesos dirigidos a MIPYMES."),
  mipyme_mujer: z.boolean().optional().describe("Solo procesos dirigidos a MIPYMES de mujeres."),
  monto_min: z.number().min(0).optional().describe("Monto estimado minimo (DOP)."),
  monto_max: z.number().min(0).optional().describe("Monto estimado maximo (DOP)."),
  publicado_desde: FECHA.optional().describe("Fecha de publicacion desde (YYYY-MM-DD, hora RD)."),
  publicado_hasta: FECHA.optional().describe("Fecha de publicacion hasta, inclusive (YYYY-MM-DD)."),
  orden: z.enum(["recientes", "cierre_proximo", "monto_mayor"]).optional()
    .describe("'recientes' (default) = lo ultimo publicado primero. 'cierre_proximo' = lo que vence antes. 'monto_mayor'."),
  limite: z.number().int().min(1).max(50).optional().describe(`Resultados a mostrar (default ${DEFAULT_PAGE_SIZE}).`),
}).strict();

const UltimasSchema = z.object({
  dias: z.number().int().min(1).max(31).optional().describe("Cuantos dias hacia atras mirar (default 3)."),
  solo_abiertas: z.boolean().optional().describe("true (default) = solo las que aun reciben ofertas."),
  termino: z.string().optional().describe("Filtro opcional por palabras (alternativas separadas por coma)."),
  institucion: z.string().optional().describe("Filtro opcional por institucion (nombre, acronimo o codigo)."),
  mipyme: z.boolean().optional().describe("Solo procesos dirigidos a MIPYMES."),
  limite: z.number().int().min(1).max(50).optional().describe(`Resultados a mostrar (default ${DEFAULT_PAGE_SIZE}).`),
}).strict();

export function registerProcesosTools(server: McpServer): void {
  server.registerTool("dgcp_buscar_licitaciones", {
    title: "Buscar licitaciones y procesos de compra (DGCP)",
    description: `Busca procesos de compra publica del Estado dominicano usando los filtros del servidor de la API DGCP.

- estado 'abierto' (default) descarga el universo COMPLETO de procesos publicados (no una muestra) y deja solo los que aun reciben ofertas.
- 'institucion' se resuelve al codigo oficial de la unidad de compra (filtro exacto en el servidor).
- 'termino' acepta alternativas separadas por coma en una sola llamada: 'computadora, laptop, servidor'.
- Orden por defecto: lo mas reciente publicado primero. Usa orden='cierre_proximo' para ver lo que vence antes.
- Las horas se muestran en hora de Republica Dominicana.

Para "la ultima licitacion" o "lo nuevo de hoy" usa dgcp_ultimas_licitaciones.`,
    inputSchema: BuscarSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error buscando licitaciones", async (params: z.infer<typeof BuscarSchema>) => {
    const estado: Estado = params.estado ?? (params.codigo_proceso ? "todos" : "abierto");
    const orden: Orden = params.orden ?? "recientes";
    const limite = params.limite ?? DEFAULT_PAGE_SIZE;

    const { listado, ventana, institucionResuelta, institucionEnServidor } = await descargarProcesos({ ...params, estado });
    const res = ordenarProcesos(filtrarProcesos(listado.items, {
      terminos: terminosAlternativos(params.termino),
      institucion: institucionEnServidor ? undefined : params.institucion,
      modalidad: params.modalidad,
      estado,
      monto_min: params.monto_min,
      monto_max: params.monto_max,
    }), orden);

    const out = [`## Procesos de compra DGCP (${estado}, orden: ${orden})`, lineaCobertura(listado, "procesos del filtro")];
    if (ventana) out.push(ventana);
    if (institucionResuelta) out.push(`Institucion: ${institucionResuelta}`);
    if (estado === "abierto") {
      const vencidos = listado.items.filter((p) => p.estado_proceso === ESTADOS_API.publicado && !sigueAbierto(p.fecha_fin_recepcion_ofertas)).length;
      if (vencidos > 0) out.push(`Excluidos ${vencidos} procesos que siguen marcados "publicado" en la API pero cuyo plazo de ofertas ya vencio.`);
    }

    if (res.length === 0) {
      out.push("", "Sin coincidencias. Prueba terminos alternativos separados por coma, quita filtros o usa estado='todos'.");
      return texto(out.join("\n") + pie());
    }
    const mostrados = res.slice(0, limite);
    out.push(
      `Coinciden: ${res.length}. Mostrando ${mostrados.length}. Monto estimado de los mostrados: ${formatMonto(sumar(mostrados, (p) => p.monto_estimado))}`,
      "",
      ...mostrados.map((p, i) => formatProceso(p, i + 1) + "\n"),
    );
    if (res.length > mostrados.length) out.push(`--- ${res.length - mostrados.length} coincidencias mas: sube 'limite' o afina el filtro.`);
    return texto(out.join("\n") + pie());
  }));

  server.registerTool("dgcp_ultimas_licitaciones", {
    title: "Ultimas licitaciones publicadas (DGCP)",
    description: `Devuelve lo ULTIMO publicado en compras publicas de RD, del mas reciente al mas antiguo, con fecha y hora RD de publicacion y el tiempo que queda para ofertar.
Usala para "dame la ultima licitacion", "que salio hoy", "lo nuevo de esta semana".
Indica tambien el corte de datos de la DGCP: la API se actualiza a las 00:00, 07:00, 14:00 y 21:00, asi que lo publicado en el portal despues del ultimo corte aparece en el siguiente.`,
    inputSchema: UltimasSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error consultando las ultimas licitaciones", async (params: z.infer<typeof UltimasSchema>) => {
    const dias = params.dias ?? 3;
    const soloAbiertas = params.solo_abiertas ?? true;
    const limite = params.limite ?? DEFAULT_PAGE_SIZE;
    const desde = sumarDias(fechaISORD(), -dias);

    const { listado, institucionResuelta, institucionEnServidor } = await descargarProcesos({
      institucion: params.institucion,
      estado: "todos",
      mipyme: params.mipyme,
      publicado_desde: desde,
    });
    const res = ordenarProcesos(filtrarProcesos(listado.items, {
      terminos: terminosAlternativos(params.termino),
      institucion: institucionEnServidor ? undefined : params.institucion,
      estado: soloAbiertas ? "abierto" : "todos",
    }), "recientes");

    const out = [
      `## Ultimas licitaciones publicadas (desde ${desde}${soloAbiertas ? ", solo abiertas" : ""})`,
      lineaCobertura(listado, "procesos publicados en la ventana"),
    ];
    if (institucionResuelta) out.push(`Institucion: ${institucionResuelta}`);
    if (res.length === 0) {
      out.push("", soloAbiertas
        ? "No hay procesos abiertos publicados en esa ventana. Prueba dias mayor o solo_abiertas=false."
        : "No hay procesos publicados en esa ventana.");
      return texto(out.join("\n") + pie());
    }
    const mostrados = res.slice(0, limite);
    out.push(`Encontrados: ${res.length}. Mostrando ${mostrados.length}, del mas reciente al mas antiguo.`, "",
      ...mostrados.map((p, i) => formatProceso(p, i + 1) + "\n"));
    if (res.length > mostrados.length) out.push(`--- ${res.length - mostrados.length} mas: sube 'limite'.`);
    return texto(out.join("\n") + pie());
  }));
}
