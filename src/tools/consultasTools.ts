// src/tools/consultasTools.ts
// Consultas directas a /contratos, /ofertas y /proveedores con los filtros del servidor.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dgcpListar, type ListadoResult } from "../services/dgcpClient.js";
import { resolverInstitucion, resolverProveedor, inhabilitacionesVigentes } from "../services/catalogos.js";
import { DEFAULT_PAGE_SIZE } from "../constants.js";
import { formatMonto, fixEncoding, normalizar, terminosAlternativos, contieneAlguno, sumar, soloDigitos, recortar } from "../utils/texto.js";
import { formatFechaHoraRD, soloFecha, parseFechaDGCP } from "../utils/fechas.js";
import { texto, seguro, lineaCobertura, pie, SOLO_LECTURA } from "./comun.js";
import type { ContratoReal, OfertaReal, ProveedorReal, QueryParams } from "../types.js";

const RPE = z.union([z.string(), z.number()]);

/** Filtros de servidor comunes a contratos y ofertas. Si hay institucion ambigua, la reporta. */
async function filtrosServidor(p: { codigo_proceso?: string; rpe?: string | number; institucion?: string }) {
  const filtros: QueryParams = {};
  const notas: string[] = [];
  if (p.codigo_proceso) filtros.proceso = p.codigo_proceso.trim();
  if (p.rpe !== undefined && soloDigitos(p.rpe)) filtros.rpe = Number(soloDigitos(p.rpe));
  let institucionLocal: string | undefined;
  if (p.institucion) {
    const u = await resolverInstitucion(p.institucion);
    if (u.length === 1) {
      filtros.unidad_compra = u[0].codigo_unidad_compra;
      notas.push(`Institucion: ${u[0].unidad_compra} (cod. ${u[0].codigo_unidad_compra})`);
    } else {
      institucionLocal = p.institucion;
      if (u.length > 1) notas.push(`"${p.institucion}" coincide con ${u.length} instituciones; se filtra por nombre. Opciones: ${u.slice(0, 6).map((x) => `${x.unidad_compra} (${x.codigo_unidad_compra})`).join("; ")}`);
    }
  }
  const acotado = Object.keys(filtros).length > 0;
  return { filtros, notas, institucionLocal, acotado };
}

function ordenarPorFecha<T>(items: T[], fecha: (x: T) => unknown): T[] {
  return [...items].sort((a, b) => (parseFechaDGCP(fecha(b)) ?? 0) - (parseFechaDGCP(fecha(a)) ?? 0));
}

function formatContrato(c: ContratoReal, i: number): string {
  const l = [
    `**${i}. ${fixEncoding(c.descripcion?.trim() || c.codigo_contrato || "Contrato")}**`,
    `   Contrato: ${c.codigo_contrato ?? "N/D"} | Proceso: ${c.codigo_proceso ?? "N/D"}`,
    `   Adjudicatario: ${fixEncoding(c.razon_social ?? "N/D")} (RPE ${c.rpe ?? "N/D"})`,
    `   Institucion: ${fixEncoding(c.unidad_compra ?? "N/D")}`,
    `   Monto: ${formatMonto(c.valor_contratado, String(c.divisa ?? "DOP"))} | Estado: ${fixEncoding(c.estado_contrato ?? "N/D")}`,
    `   Adjudicado: ${formatFechaHoraRD(c.fecha_adjudicacion)} | Pago: ${fixEncoding(c.metodo_pago ?? "N/D")}, ${fixEncoding(c.plazo_pago_factura ?? "N/D")}`,
  ];
  if (c.url_contrato) l.push(`   Portal: ${c.url_contrato}`);
  return l.join("\n");
}

function formatOferta(o: OfertaReal, i: number): string {
  return [
    `**${i}. ${fixEncoding(o.razon_social ?? "N/D")}** (RPE ${o.rpe ?? "N/D"})`,
    `   Proceso: ${o.codigo_proceso ?? "N/D"} | Oferta: ${o.id_oferta ?? "N/D"} (${fixEncoding(o.nombre_oferta ?? "").trim() || "sin nombre"})`,
    `   Institucion: ${fixEncoding(o.unidad_compra ?? "N/D")}`,
    `   Valor: ${formatMonto(o.valor_oferta)} | ${fixEncoding(o.tipo_oferta ?? "N/D")} | Estado: ${fixEncoding(o.estado_oferta ?? "N/D")}`,
    `   Entregada: ${formatFechaHoraRD(o.fecha_creacion)}`,
  ].join("\n");
}

export function formatProveedor(p: ProveedorReal, i?: number): string {
  const cab = i === undefined ? `**${fixEncoding(p.razon_social ?? "N/D")}**` : `**${i}. ${fixEncoding(p.razon_social ?? "N/D")}**`;
  const l = [
    cab,
    `   RPE: ${p.rpe ?? "N/D"} | ${p.tipo_documento ?? "Documento"}: ${p.numero_documento ?? "N/D"} | Estado RPE: ${fixEncoding(p.estado ?? "N/D")}`,
    `   ${fixEncoding(p.tipo_persona ?? "")} ${p.forma_juridica ? `(${fixEncoding(p.forma_juridica)})` : ""} | Provee: ${fixEncoding(p.provee ?? "N/D")}`,
    `   MIPYME: ${p.es_mipyme === "Si" ? "Si" : "No"}${p.certificacion_micm === "Si" ? ` (certificada MICM${p.fecha_vencimiento_certificacion_micm ? `, vence ${soloFecha(p.fecha_vencimiento_certificacion_micm)}` : ""})` : ""} | Clasificacion: ${fixEncoding(p.clasificacion_empresarial ?? p.clasificacion ?? "N/D")}`,
    `   Registrado en RPE: ${soloFecha(p.fecha_registro_rpe)} | Empresa creada: ${soloFecha(p.fecha_creacion_empresa)}`,
    `   Ubicacion: ${[recortar(p.direccion, 120), ...[p.municipio, p.provincia].filter(Boolean).map((x) => recortar(x, 40))].filter(Boolean).join(", ") || "N/D"}`,
  ];
  const contacto = [
    p.contacto ? `${recortar(p.contacto, 60)}${p.posicion_contacto ? ` (${recortar(p.posicion_contacto, 40)})` : ""}` : "",
    p.telefono_comercial || p.telefono_contacto || "",
    p.correo_comercial || p.correo_contacto || "",
  ].filter(Boolean).join(" | ");
  if (contacto) l.push(`   Contacto: ${contacto}`);
  if (p.url_certificacion) l.push(`   Constancia RPE: ${p.url_certificacion}`);
  return l.join("\n");
}

function encabezado(titulo: string, listado: ListadoResult<unknown>, sustantivo: string, notas: string[], ventana?: string): string[] {
  const out = [`## ${titulo}`, lineaCobertura(listado, sustantivo), ...notas];
  if (ventana) out.push(ventana);
  return out;
}

const ContratosSchema = z.object({
  codigo_proceso: z.string().optional().describe("Codigo del proceso (filtro exacto en servidor)."),
  rpe: RPE.optional().describe("RPE del adjudicatario (filtro exacto en servidor)."),
  institucion: z.string().optional().describe("Institucion: nombre, acronimo o codigo de unidad de compra."),
  termino: z.string().optional().describe("Palabras en descripcion, proveedor o codigos (alternativas separadas por coma)."),
  proveedor: z.string().optional().describe("Nombre (o parte) del adjudicatario."),
  estado_contrato: z.string().optional().describe("Activo, Cerrado, Cancelado, Rescindido, Modificado, 'Flujo en aprobacion'."),
  monto_min: z.number().min(0).optional(),
  monto_max: z.number().min(0).optional(),
  limite: z.number().int().min(1).max(50).optional().describe(`Resultados a mostrar (default ${DEFAULT_PAGE_SIZE}).`),
}).strict();

const OfertasSchema = z.object({
  codigo_proceso: z.string().optional().describe("Codigo del proceso: devuelve TODAS sus ofertas (filtro exacto en servidor)."),
  rpe: RPE.optional().describe("RPE del oferente (filtro exacto en servidor)."),
  institucion: z.string().optional().describe("Institucion: nombre, acronimo o codigo."),
  termino: z.string().optional().describe("Palabras en oferente, nombre de oferta o codigos."),
  proveedor: z.string().optional().describe("Nombre (o parte) del oferente."),
  monto_min: z.number().min(0).optional(),
  monto_max: z.number().min(0).optional(),
  orden: z.enum(["recientes", "precio_menor"]).optional().describe("'recientes' (default) o 'precio_menor' (util para comparar ofertas de un proceso)."),
  limite: z.number().int().min(1).max(50).optional().describe(`Resultados a mostrar (default ${DEFAULT_PAGE_SIZE}).`),
}).strict();

const ProveedoresSchema = z.object({
  termino: z.string().optional().describe("RPE, RNC/cedula o nombre de la empresa. Los numeros se buscan de forma exacta."),
  rnc: z.string().optional().describe("RNC o cedula (exacto)."),
  rpe: RPE.optional().describe("Numero de RPE (exacto)."),
  provincia: z.string().optional().describe("Provincia, ej. 'SANTIAGO' (filtro de servidor; requiere tambien estado)."),
  estado: z.string().optional().describe("Estado en el RPE: Activo, Suspendido, Cancelado, Desactualizado..."),
  limite: z.number().int().min(1).max(50).optional(),
}).strict();

export function registerConsultasTools(server: McpServer): void {
  server.registerTool("dgcp_buscar_contratos", {
    title: "Buscar contratos adjudicados (DGCP)",
    description: `Contratos firmados por el Estado dominicano: quien gano, cuanto, cuando, forma y plazo de pago.
Filtros exactos en el servidor: codigo_proceso, rpe, institucion (resuelta a su codigo oficial), con cobertura total del filtro.
Sin esos filtros solo se analizan los ~3,000 contratos mas recientes (la API no filtra contratos por fecha ni por texto).`,
    inputSchema: ContratosSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error consultando contratos", async (p: z.infer<typeof ContratosSchema>) => {
    const { filtros, notas, institucionLocal, acotado } = await filtrosServidor(p);
    const listado = await dgcpListar<ContratoReal>("contratos", filtros, { maxPaginas: acotado ? 6 : 3 });
    const terminos = terminosAlternativos(p.termino);
    const prov = p.proveedor ? normalizar(p.proveedor) : "";
    const inst = institucionLocal ? normalizar(institucionLocal) : "";
    const est = p.estado_contrato ? normalizar(p.estado_contrato) : "";
    const res = ordenarPorFecha(listado.items.filter((c) =>
      contieneAlguno([c.descripcion, c.razon_social, c.codigo_contrato, c.codigo_proceso, c.unidad_compra], terminos) &&
      (!prov || normalizar(c.razon_social).includes(prov)) &&
      (!inst || normalizar(c.unidad_compra).includes(inst)) &&
      (!est || normalizar(c.estado_contrato).includes(est)) &&
      (p.monto_min === undefined || (c.valor_contratado ?? -1) >= p.monto_min) &&
      (p.monto_max === undefined || (c.valor_contratado ?? Infinity) <= p.monto_max)), (c) => c.fecha_adjudicacion);

    const out = encabezado("Contratos adjudicados DGCP", listado, "contratos del filtro", notas,
      acotado ? undefined : "Sin filtro de servidor: se analizaron los contratos mas recientes. Usa rpe, codigo_proceso o institucion para cobertura total.");
    if (res.length === 0) return texto([...out, "", "Sin coincidencias."].join("\n") + pie());
    const limite = p.limite ?? DEFAULT_PAGE_SIZE;
    const m = res.slice(0, limite);
    out.push(`Coinciden: ${res.length} por ${formatMonto(sumar(res, (c) => c.valor_contratado))} en total. Mostrando ${m.length} (mas recientes primero).`, "",
      ...m.map((c, i) => formatContrato(c, i + 1) + "\n"));
    if (res.length > m.length) out.push(`--- ${res.length - m.length} contratos mas: sube 'limite'.`);
    return texto(out.join("\n") + pie());
  }));

  server.registerTool("dgcp_buscar_ofertas", {
    title: "Buscar ofertas presentadas (DGCP)",
    description: `Ofertas que las empresas presentaron en procesos de compra: quien compitio y a que precio.
Con codigo_proceso devuelve TODAS las ofertas de ese proceso (filtro exacto en servidor); con rpe, todas las de una empresa.
Nota: la API casi siempre deja estado_evaluacion en "Pendiente"; el ganador real se ve en dgcp_buscar_contratos.`,
    inputSchema: OfertasSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error consultando ofertas", async (p: z.infer<typeof OfertasSchema>) => {
    const { filtros, notas, institucionLocal, acotado } = await filtrosServidor(p);
    const listado = await dgcpListar<OfertaReal>("ofertas", filtros, { maxPaginas: acotado ? 6 : 3 });
    const terminos = terminosAlternativos(p.termino);
    const prov = p.proveedor ? normalizar(p.proveedor) : "";
    const inst = institucionLocal ? normalizar(institucionLocal) : "";
    let res = listado.items.filter((o) =>
      contieneAlguno([o.razon_social, o.nombre_oferta, o.codigo_proceso, o.id_oferta, o.unidad_compra], terminos) &&
      (!prov || normalizar(o.razon_social).includes(prov)) &&
      (!inst || normalizar(o.unidad_compra).includes(inst)) &&
      (p.monto_min === undefined || (o.valor_oferta ?? -1) >= p.monto_min) &&
      (p.monto_max === undefined || (o.valor_oferta ?? Infinity) <= p.monto_max));
    res = p.orden === "precio_menor"
      ? [...res].sort((a, b) => (a.valor_oferta ?? Infinity) - (b.valor_oferta ?? Infinity))
      : ordenarPorFecha(res, (o) => o.fecha_creacion);

    const out = encabezado("Ofertas presentadas DGCP", listado, "ofertas del filtro", notas,
      acotado ? undefined : "Sin filtro de servidor: se analizaron las ofertas mas recientes. Usa codigo_proceso, rpe o institucion para cobertura total.");
    if (res.length === 0) return texto([...out, "", "Sin coincidencias."].join("\n") + pie());
    const m = res.slice(0, p.limite ?? DEFAULT_PAGE_SIZE);
    out.push(`Coinciden: ${res.length}. Mostrando ${m.length}.`, "", ...m.map((o, i) => formatOferta(o, i + 1) + "\n"));
    if (res.length > m.length) out.push(`--- ${res.length - m.length} ofertas mas: sube 'limite'.`);
    return texto(out.join("\n") + pie());
  }));

  server.registerTool("dgcp_buscar_proveedores", {
    title: "Buscar proveedores del Estado / RPE (DGCP)",
    description: `Ficha oficial en el Registro de Proveedores del Estado: RPE, RNC, estado, MIPYME/MICM, rubro, ubicacion, contacto y constancia.
Busca por RPE o RNC/cedula de forma exacta en el servidor. Por nombre, identifica la empresa a traves de su actividad reciente en contratos y ofertas.
Avisa si el proveedor figura en la lista oficial de inhabilitados o suspendidos.`,
    inputSchema: ProveedoresSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error consultando proveedores", async (p: z.infer<typeof ProveedoresSchema>) => {
    const out: string[] = ["## Proveedores del Estado (RPE)"];
    let encontrados: ProveedorReal[] = [];
    const termino = p.rnc ?? (p.rpe !== undefined ? String(p.rpe) : p.termino);

    if (termino) {
      const r = await resolverProveedor(p.rnc ? soloDigitos(p.rnc) : termino);
      if (r.proveedor) encontrados = [r.proveedor];
      if (r.via === "nombre") out.push(`Identificado por nombre a partir de contratos y ofertas recientes.`);
      if (r.alternativas.length > 0) out.push(`Otras empresas con nombre parecido: ${r.alternativas.map((a) => `${a.razon_social} (RPE ${a.rpe})`).join("; ")}`);
    } else if (p.estado || p.provincia) {
      const filtros: QueryParams = {};
      if (p.estado) filtros.estado = p.estado;
      if (p.provincia) filtros.provincia = p.provincia.toUpperCase();
      const l = await dgcpListar<ProveedorReal>("proveedores", filtros, { maxPaginas: 1 });
      out.push(lineaCobertura(l, "proveedores del filtro"));
      // El listado viene por RPE ascendente (los mas antiguos primero): se muestran los registros mas nuevos.
      encontrados = [...l.items].sort((a, b) => Number(b.rpe ?? 0) - Number(a.rpe ?? 0));
    } else {
      return texto("Indica 'termino' (RPE, RNC o nombre), 'rnc', 'rpe', o un filtro de 'estado'/'provincia'.");
    }

    if (encontrados.length === 0) {
      out.push("", "No se encontro el proveedor. Verifica el RPE/RNC; si buscas por nombre, prueba con una parte distintiva del nombre.");
      return texto(out.join("\n") + pie());
    }
    const m = encontrados.slice(0, p.limite ?? DEFAULT_PAGE_SIZE);
    for (const [i, prov] of m.entries()) {
      out.push("", formatProveedor(prov, m.length > 1 ? i + 1 : undefined));
      if (m.length === 1) {
        const inh = await inhabilitacionesVigentes(prov.rpe);
        for (const r of inh) {
          out.push(`   ${r.es_sancion ? "ALERTA - inhabilitado/suspendido" : "Registro cancelado/suspendido a solicitud propia"} desde ${r.fecha_inhabilitacion.slice(0, 10)}: ${r.motivo}`);
        }
      }
    }
    return texto(out.join("\n") + pie());
  }));
}
