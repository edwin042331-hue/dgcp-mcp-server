// src/tools/mercadoTools.ts
// Inteligencia de mercado: oportunidades por rubro UNSPSC, precios historicos adjudicados y
// plan anual de compras (PACC).
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dgcpGet, dgcpListar, normalizePaginated } from "../services/dgcpClient.js";
import { resolverProveedor, resolverInstitucion } from "../services/catalogos.js";
import { ESTADOS_API } from "./procesosTools.js";
import { DEFAULT_PAGE_SIZE, LIMITE_API } from "../constants.js";
import {
  formatMonto, formatPct, fixEncoding, normalizar, terminosAlternativos, contieneAlguno, estadisticos, recortar, celda, soloDigitos, sumar,
} from "../utils/texto.js";
import { formatFechaHoraRD, formatEpochRD, cuentaRegresiva, sigueAbierto, parseFechaDGCP, fechaISORD, soloFecha } from "../utils/fechas.js";
import { texto, seguro, pie, lineaCobertura, SOLO_LECTURA } from "./comun.js";
import type { ProcesoReal, ArticuloProceso, ArticuloContrato, RubroProveedor, AdquisicionPacc } from "../types.js";

const CODIGO_UNSPSC = z.string().regex(/^\d{8}$/, "Codigo UNSPSC de 8 digitos, ej. 43211500");

/** Nivel UNSPSC de un codigo de 8 digitos: familia (XXXX0000), clase (XXXXXX00) o subclase. */
export function nivelUNSPSC(codigo: string): "familia" | "clase" | "subclase" {
  if (codigo.endsWith("0000")) return "familia";
  if (codigo.endsWith("00")) return "clase";
  return "subclase";
}

const MAX_CODIGOS = 200;
const DIAS_ARTICULOS_POR_DEFECTO = 14;
/** Tope de paginas de 1000 articulos (cada pagina cubre ~1 dia habil de publicaciones). */
const MAX_PAGINAS_ARTICULOS = 20;

/** true si la subclase de un articulo pertenece al codigo UNSPSC (familia, clase o subclase). */
export function coincideUNSPSC(subclaseArticulo: unknown, codigo: string): boolean {
  const s = String(subclaseArticulo ?? "");
  if (s.length !== 8) return false;
  const nivel = nivelUNSPSC(codigo);
  const prefijo = nivel === "familia" ? 4 : nivel === "clase" ? 6 : 8;
  return s.slice(0, prefijo) === codigo.slice(0, prefijo);
}

/** Pagina /procesos/articulos (orden por fecha descendente) hasta cubrir `desdeMs` o el tope de paginas. */
async function articulosRecientes(desdeMs: number): Promise<{ items: ArticuloProceso[]; desde: number; paginas: number }> {
  const items: ArticuloProceso[] = [];
  let masAntigua = Date.now();
  let pagina = 0;
  const LOTE = 3;
  while (pagina < MAX_PAGINAS_ARTICULOS && masAntigua > desdeMs) {
    const lote = Array.from({ length: Math.min(LOTE, MAX_PAGINAS_ARTICULOS - pagina) }, (_, i) => pagina + i + 1);
    const respuestas = await Promise.all(lote.map((n) => dgcpGet<unknown>("procesos/articulos", { page: n, limit: LIMITE_API })));
    pagina += lote.length;
    let vacia = false;
    for (const [i, raw] of respuestas.entries()) {
      const pag = normalizePaginated<ArticuloProceso>(raw, lote[i], LIMITE_API).items;
      if (pag.length === 0) vacia = true;
      items.push(...pag);
      for (const a of pag) {
        const t = parseFechaDGCP(a.fecha_publicacion);
        if (t !== null && t < masAntigua) masAntigua = t;
      }
    }
    if (vacia) break;
  }
  return { items, desde: Math.max(masAntigua, desdeMs), paginas: pagina };
}

const OportunidadesSchema = z.object({
  rpe_o_rnc: z.string().optional().describe("RPE o RNC de tu empresa: se usan sus rubros UNSPSC registrados en el RPE."),
  codigos_unspsc: z.array(CODIGO_UNSPSC).max(MAX_CODIGOS).optional()
    .describe("Familias/clases/subclases UNSPSC a vigilar (alternativa o complemento al RPE). Ej: ['43210000','81110000']."),
  termino: z.string().optional().describe("Filtro adicional por palabras (alternativas separadas por coma)."),
  mipyme: z.boolean().optional().describe("Solo procesos dirigidos a MIPYMES."),
  dias_atras: z.number().int().min(1).max(30).optional().describe(`Antiguedad maxima de publicacion a revisar (default ${DIAS_ARTICULOS_POR_DEFECTO} dias).`),
  limite: z.number().int().min(1).max(50).optional(),
}).strict();

const PreciosSchema = z.object({
  codigo_unspsc: CODIGO_UNSPSC.describe("Subclase (recomendado), clase o familia UNSPSC del articulo. Sale en dgcp_inteligencia_proceso."),
  termino: z.string().optional().describe("Filtra por descripcion del articulo (alternativas separadas por coma), ej. 'toner, cartucho'."),
  unidad_medida: z.string().optional().describe("Solo esta unidad de medida, ej. 'Unidad', 'Caja', 'Galon'."),
}).strict();

const PaccSchema = z.object({
  institucion: z.string().min(2).describe("Nombre, acronimo o codigo de la institucion."),
  anio: z.number().int().min(2018).max(2100).optional().describe("Ano del plan (default: el actual)."),
  termino: z.string().optional().describe("Filtra por descripcion (alternativas separadas por coma)."),
  limite: z.number().int().min(1).max(50).optional(),
}).strict();

export function registerMercadoTools(server: McpServer): void {
  server.registerTool("dgcp_oportunidades_para_mi", {
    title: "Oportunidades abiertas para mi empresa (por rubro UNSPSC)",
    description: `Responde "que licitaciones ABIERTAS ahora mismo puedo ofertar". Toma TODOS los rubros UNSPSC registrados de tu empresa en el RPE (o los codigos que indiques) y los cruza con los articulos de los procesos publicados recientemente que siguen recibiendo ofertas.
Es exacto por codigo de producto: encuentra oportunidades que una busqueda por palabras pierde. Ordena por cierre mas proximo e informa que porcentaje de los procesos abiertos cubrio.`,
    inputSchema: OportunidadesSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error buscando oportunidades", async (p: z.infer<typeof OportunidadesSchema>) => {
    const out = ["# Oportunidades abiertas por rubro"];
    const codigos = new Set<string>(p.codigos_unspsc ?? []);
    if (p.rpe_o_rnc) {
      const r = await resolverProveedor(p.rpe_o_rnc);
      if (!r.proveedor) return texto(`No se encontro el proveedor "${p.rpe_o_rnc}". Usa el RPE o RNC exacto, o pasa codigos_unspsc.`);
      const rubros = await dgcpListar<RubroProveedor>("proveedores/rubro", { rpe: Number(soloDigitos(r.proveedor.rpe)) }, { maxPaginas: 1 });
      rubros.items.forEach((x) => x.familia_unspsc && codigos.add(String(x.familia_unspsc)));
      out.push(`Empresa: ${fixEncoding(r.proveedor.razon_social ?? "")} (RPE ${r.proveedor.rpe}), ${rubros.items.length} rubros registrados.`);
    }
    if (codigos.size === 0) return texto("Indica rpe_o_rnc (con rubros registrados en el RPE) o codigos_unspsc.");
    const lista = [...codigos];
    const dias = p.dias_atras ?? DIAS_ARTICULOS_POR_DEFECTO;
    const desde = Date.now() - dias * 86_400_000;

    // Estrategia liviana para la API: paginar los articulos mas recientes (consulta por indice de
    // fecha, ~0.4 s por pagina) y cruzar los rubros localmente. Filtrar por familia en el servidor
    // es una consulta pesada que la API procesa en 20+ s y degrada las consultas siguientes.
    const [abiertos, recientes] = await Promise.all([
      dgcpListar<ProcesoReal>("procesos", { estado: ESTADOS_API.publicado, ...(p.mipyme ? { mipyme: true } : {}) }),
      articulosRecientes(desde),
    ]);
    const vigentes = new Map(abiertos.items.filter((x) => sigueAbierto(x.fecha_fin_recepcion_ofertas)).map((x) => [normalizar(x.codigo_proceso), x]));
    const cubiertos = [...vigentes.values()].filter((x) => (parseFechaDGCP(x.fecha_publicacion) ?? 0) >= recientes.desde).length;
    const coincidencias = new Map<string, { proceso: ProcesoReal; articulos: ArticuloProceso[] }>();
    for (const a of recientes.items) {
      if (!lista.some((c) => coincideUNSPSC(a.subclase_unspsc, c))) continue;
      const proc = vigentes.get(normalizar(a.codigo_proceso));
      if (!proc) continue;
      const e = coincidencias.get(normalizar(a.codigo_proceso)) ?? { proceso: proc, articulos: [] };
      e.articulos.push(a);
      coincidencias.set(normalizar(a.codigo_proceso), e);
    }
    const terminos = terminosAlternativos(p.termino);
    const res = [...coincidencias.values()]
      .filter((x) => contieneAlguno([x.proceso.titulo, x.proceso.descripcion, ...x.articulos.map((a) => a.descripcion_usuario)], terminos))
      .sort((a, b) => (parseFechaDGCP(a.proceso.fecha_fin_recepcion_ofertas) ?? Infinity) - (parseFechaDGCP(b.proceso.fecha_fin_recepcion_ofertas) ?? Infinity));

    out.push(
      `Rubros vigilados (${lista.length}): ${lista.slice(0, 20).join(", ")}${lista.length > 20 ? ` (+${lista.length - 20})` : ""}`,
      `Cobertura: articulos de los procesos publicados desde ${formatEpochRD(recientes.desde)} (${recientes.paginas} paginas). ` +
      `Eso abarca ${cubiertos} de ${vigentes.size} procesos abiertos (${formatPct(vigentes.size ? (cubiertos / vigentes.size) * 100 : 0)}); ` +
      `sube 'dias_atras' para ir mas atras o usa dgcp_buscar_licitaciones con palabras clave.`, "");
    if (res.length === 0) {
      out.push("No hay procesos abiertos que pidan articulos de esos rubros en este momento.");
      return texto(out.join("\n") + pie());
    }
    const m = res.slice(0, p.limite ?? DEFAULT_PAGE_SIZE);
    out.push(`**${res.length} oportunidades abiertas**, mostrando ${m.length} (cierre mas proximo primero):`, "");
    m.forEach(({ proceso: x, articulos }, i) => {
      out.push(
        `**${i + 1}. ${fixEncoding(x.titulo ?? "").trim()}**`,
        `   ${x.codigo_proceso} | ${fixEncoding(x.unidad_compra ?? "")} | ${fixEncoding(x.modalidad ?? "")} | ${formatMonto(x.monto_estimado)}`,
        `   Cierre: ${formatFechaHoraRD(x.fecha_fin_recepcion_ofertas)} (${cuentaRegresiva(x.fecha_fin_recepcion_ofertas)})${x.dirigido_mipymes === "Si" ? " | MIPYME" : ""}`,
        `   Articulos de tu rubro: ${articulos.slice(0, 4).map((a) => `${recortar(a.descripcion_usuario || a.descripcion_articulo, 50)} (${a.cantidad ?? "?"} ${a.unidad_medida ?? ""}, est. ${formatMonto(a.precio_unitario_estimado)} c/u)`).join("; ")}${articulos.length > 4 ? ` (+${articulos.length - 4})` : ""}`,
        x.url ? `   Portal: ${String(x.url).replace("//Public", "/Public")}` : "",
        "");
    });
    return texto(out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") + pie());
  }));

  server.registerTool("dgcp_precios_referencia", {
    title: "Precios historicos adjudicados por articulo (UNSPSC)",
    description: `A que precio unitario el Estado ha contratado realmente un articulo: estadisticas (minimo, percentil 25, mediana, percentil 75, maximo) por unidad de medida sobre los contratos mas recientes de ese codigo UNSPSC, con ejemplos (institucion, proveedor, fecha).
Sirve para fijar el precio de una oferta o detectar sobreprecios. Los codigos UNSPSC de cada articulo salen en dgcp_inteligencia_proceso.`,
    inputSchema: PreciosSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error calculando precios de referencia", async (p: z.infer<typeof PreciosSchema>) => {
    const nivel = nivelUNSPSC(p.codigo_unspsc);
    const listado = await dgcpListar<ArticuloContrato>("contratos/articulos", { [nivel]: Number(p.codigo_unspsc) }, { maxPaginas: 1 });
    const terminos = terminosAlternativos(p.termino);
    const um = p.unidad_medida ? normalizar(p.unidad_medida) : "";
    const filas = listado.items.filter((a) =>
      typeof a.precio_unitario === "number" && a.precio_unitario > 0 &&
      contieneAlguno([a.descripcion_usuario, a.descripcion_articulo], terminos) &&
      (!um || normalizar(a.unidad_medida) === um));

    const out = [`# Precios adjudicados: UNSPSC ${p.codigo_unspsc} (${nivel})`, lineaCobertura(listado, "articulos contratados")];
    if (filas.length === 0) {
      out.push("", "Sin articulos contratados con esos filtros. Prueba la clase o familia (ej. 43211500 o 43210000) o quita 'termino'.");
      return texto(out.join("\n") + pie());
    }
    const fechas = filas.map((a) => parseFechaDGCP(a.fecha_creacion_contrato)).filter((x): x is number => x !== null).sort((a, b) => a - b);
    if (fechas.length) out.push(`Periodo: ${fechaISORD(fechas[0])} a ${fechaISORD(fechas[fechas.length - 1])}. Articulos: ${filas.length}. Precios unitarios sin ITBIS segun el contrato.`);

    const porUnidad = new Map<string, ArticuloContrato[]>();
    filas.forEach((a) => {
      const k = fixEncoding(a.unidad_medida ?? "N/D").trim() || "N/D";
      porUnidad.set(k, [...(porUnidad.get(k) ?? []), a]);
    });
    out.push("", "| Unidad | N | Minimo | P25 | Mediana | P75 | Maximo |", "|---|---|---|---|---|---|---|");
    const grupos = [...porUnidad.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
    for (const [unidad, items] of grupos) {
      const s = estadisticos(items.map((a) => a.precio_unitario!));
      if (s) out.push(`| ${celda(unidad, 20)} | ${s.n} | ${formatMonto(s.min)} | ${formatMonto(s.p25)} | ${formatMonto(s.mediana)} | ${formatMonto(s.p75)} | ${formatMonto(s.max)} |`);
    }
    out.push("", "Usa la mediana y el rango P25-P75 como referencia; los extremos suelen ser compras atipicas (por paquete, por servicio global, etc.).",
      "", "## Ejemplos recientes");
    [...filas].sort((a, b) => (parseFechaDGCP(b.fecha_creacion_contrato) ?? 0) - (parseFechaDGCP(a.fecha_creacion_contrato) ?? 0)).slice(0, 12)
      .forEach((a) => out.push(`- ${soloFecha(a.fecha_creacion_contrato)} | ${recortar(a.descripcion_usuario || a.descripcion_articulo, 70)} | ${a.cantidad ?? "?"} ${fixEncoding(a.unidad_medida ?? "")} a ${formatMonto(a.precio_unitario)} | ${a.codigo_proceso}`));
    return texto(out.join("\n") + pie());
  }));

  server.registerTool("dgcp_plan_compras", {
    title: "Plan Anual de Compras (PACC) de una institucion",
    description: `Lo que una institucion PLANEA comprar en el ano segun su Plan Anual de Compras y Contrataciones (PACC) publicado: descripcion, monto presupuestado, modalidad prevista, fecha estimada de inicio y si esta reservado a MIPYMES.
Permite anticiparse a las licitaciones antes de que se publiquen.`,
    inputSchema: PaccSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error consultando el plan de compras", async (p: z.infer<typeof PaccSchema>) => {
    const unidades = await resolverInstitucion(p.institucion);
    if (unidades.length === 0) return texto(`No se encontro la institucion "${p.institucion}".`);
    if (unidades.length > 1) {
      return texto(`"${p.institucion}" coincide con ${unidades.length} unidades de compra. Repite con el codigo:\n` +
        unidades.slice(0, 20).map((u) => `- ${u.codigo_unidad_compra}: ${u.unidad_compra}`).join("\n"));
    }
    const u = unidades[0];
    const anio = p.anio ?? Number(fechaISORD().slice(0, 4));
    const listado = await dgcpListar<AdquisicionPacc>("pacc/adquisiciones", { unidad_compra: u.codigo_unidad_compra, "año": anio }, { maxPaginas: 4 });
    const terminos = terminosAlternativos(p.termino);
    const filas = listado.items.filter((a) => contieneAlguno([a.descripcion, a.finalidad, a.objeto_adquisicion], terminos));
    const hoy = Date.now();
    const proximas = filas.filter((a) => (parseFechaDGCP(a.fecha_inicio_proceso_compra) ?? 0) >= hoy - 30 * 86_400_000)
      .sort((a, b) => (parseFechaDGCP(a.fecha_inicio_proceso_compra) ?? 0) - (parseFechaDGCP(b.fecha_inicio_proceso_compra) ?? 0));

    const out = [
      `# PACC ${anio}: ${fixEncoding(u.unidad_compra ?? "")} (cod. ${u.codigo_unidad_compra})`,
      lineaCobertura(listado, "adquisiciones planificadas"),
      `Coinciden: ${filas.length} por ${formatMonto(sumar(filas, (a) => a.valor_presupuestado))}.`,
    ];
    const porMod = new Map<string, number>();
    filas.forEach((a) => porMod.set(fixEncoding(a.modalidad_adquisicion ?? "N/D"), (porMod.get(fixEncoding(a.modalidad_adquisicion ?? "N/D")) ?? 0) + (a.valor_presupuestado ?? 0)));
    if (porMod.size) out.push(`Por modalidad: ${[...porMod.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${formatMonto(v)}`).join("; ")}.`);
    const mostrar = (proximas.length ? proximas : filas).slice(0, p.limite ?? 15);
    out.push("", proximas.length ? "## Proximas adquisiciones (desde hace 30 dias en adelante)" : "## Adquisiciones planificadas",
      "| Inicio previsto | Descripcion | Objeto | Modalidad | Presupuesto | MIPYME |", "|---|---|---|---|---|---|",
      ...mostrar.map((a) => `| ${soloFecha(a.fecha_inicio_proceso_compra)} | ${celda(a.descripcion, 70)} | ${celda(a.objeto_adquisicion, 12)} | ${celda(a.modalidad_adquisicion, 30)} | ${formatMonto(a.valor_presupuestado)} | ${a.dirigido_mipymes === "Si" ? "Si" : "No"} |`));
    return texto(out.join("\n") + pie());
  }));
}
