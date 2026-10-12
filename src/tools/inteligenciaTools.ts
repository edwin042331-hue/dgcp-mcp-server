// src/tools/inteligenciaTools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dgcpGet, dgcpListar } from "../services/dgcpClient.js";
import { resolverProveedor, inhabilitacionesVigentes } from "../services/catalogos.js";
import {
  formatMonto, formatPct, fixEncoding, normalizar, sumar, soloDigitos, recortar, celda,
} from "../utils/texto.js";
import { formatFechaHoraRD, formatEpochRD, fechaISORD, soloFecha, cuentaRegresiva, diasHabilesEntre, parseFechaDGCP, msHasta } from "../utils/fechas.js";
import {
  regimenAplicable, describirRegimen, modalidadPorMonto, plazoMinimoPorModalidad, modalidadInferiorALaLegal,
  claveModalidad, exentaDeSeriedad, GARANTIAS, UMBRALES_2026, ACLARACIONES_PCT_PLAZO, AVISO_LEGAL, FUENTES,
  type TipoObjeto,
} from "../normativa.js";
import { texto, seguro, pie, SOLO_LECTURA, CALCULO_LOCAL } from "./comun.js";
import { formatProveedor } from "./consultasTools.js";
import type {
  ProcesoReal, ContratoReal, OfertaReal, ArticuloProceso, DocumentoProceso, RubroProveedor,
} from "../types.js";

/** Resultado de auditar el plazo de convocatoria contra el Art. 101 Ley 47-25. */
export function auditarPlazo(p: ProcesoReal): { habiles: number; minimo: number; base: string; incumple: boolean } | null {
  if (regimenAplicable(p.fecha_publicacion) !== "ley_47_25") return null;
  const regla = plazoMinimoPorModalidad(p.modalidad);
  if (!regla) return null;
  const habiles = diasHabilesEntre(p.fecha_publicacion, p.fecha_fin_recepcion_ofertas);
  if (habiles === null) return null;
  return { habiles, minimo: regla.dias, base: regla.base, incumple: habiles < regla.dias };
}

function tipoObjeto(p: ProcesoReal): TipoObjeto {
  return normalizar(p.objeto_proceso) === "obras" ? "obras" : "bienes_servicios";
}

function seccionGarantias(p: ProcesoReal, monto: number): string[] {
  const regimen = regimenAplicable(p.fecha_publicacion);
  const out = [`## Garantias y condiciones financieras (${describirRegimen(regimen)})`];
  if (regimen !== "ley_47_25") {
    out.push("Proceso convocado bajo el regimen anterior: las garantias y plazos se rigen por la Ley 340-06, el Dec. 416-23 y su pliego. Verificalos en el pliego.");
    return out;
  }
  const mipyme = p.dirigido_mipymes === "Si";
  if (exentaDeSeriedad(p.modalidad)) {
    out.push(`- Seriedad de oferta: NO se exige en ${fixEncoding(p.modalidad)} (Art. 201 parrafo, Dec. 52-26).`);
  } else {
    out.push(`- Seriedad de oferta: 1% de TU oferta, dentro del Sobre B (Art. 202 Dec. 52-26). Sobre el presupuesto estimado seria ${formatMonto(monto * GARANTIAS.SERIEDAD_OFERTA_PCT)}. Errores materiales son subsanables en 1 a 5 dias habiles (Art. 204).`);
    out.push(`  Si tu empresa es MIPYME: no se te puede exigir garantia de seriedad (Art. 175.2 Ley 47-25).`);
  }
  out.push(
    `- Fiel cumplimiento: 4% del monto adjudicado = ${formatMonto(monto * GARANTIAS.FIEL_CUMPLIMIENTO_PCT)}; MIPYME 1% = ${formatMonto(monto * GARANTIAS.FIEL_CUMPLIMIENTO_MIPYME_PCT)} (Art. 207 Dec. 52-26). Obligatoria si el contrato supera el equivalente a US$10,000; se entrega en 5 dias habiles tras la adjudicacion (Arts. 205-206).`,
    `- Anticipo MIPYME: la institucion debe otorgar 30% al firmar, sin factura = ${formatMonto(monto * GARANTIAS.ANTICIPO_MIPYME_PCT)} (Art. 174 Ley 47-25), respaldado por garantia de buen uso por el 100% del anticipo (Art. 210 Dec. 52-26).`,
    `- Pago: la institucion tiene maximo 30 dias para pagar desde que se cumple la condicion de pago y se presenta el requerimiento (Art. 148 parrafo III Ley 47-25).`,
  );
  if (mipyme) out.push(`- Este proceso esta dirigido a MIPYMES${p.dirigido_mipymes_mujeres === "Si" ? " lideradas por mujeres" : ""}.`);
  return out;
}

function seccionLegalidad(p: ProcesoReal, monto: number): string[] {
  const out: string[] = [];
  const plazo = auditarPlazo(p);
  if (plazo) {
    out.push(plazo.incumple
      ? `- ALERTA plazo: entre la publicacion y el cierre hay a lo sumo ${plazo.habiles} dias habiles; el minimo para ${fixEncoding(p.modalidad)} es ${plazo.minimo} (${plazo.base}). Conteo sin feriados: el incumplimiento es cierto.`
      : `- Plazo de convocatoria: ${plazo.habiles} dias habiles (sin descontar feriados) frente a un minimo de ${plazo.minimo} (${plazo.base}). Conforme.`);
  }
  if (regimenAplicable(p.fecha_publicacion) === "ley_47_25" && monto > 0) {
    const legal = modalidadPorMonto(monto, tipoObjeto(p));
    const inferior = modalidadInferiorALaLegal(p.modalidad, legal);
    if (inferior === true) {
      out.push(`- ALERTA modalidad: por ${formatMonto(monto)} corresponde ${legal.nombre} (${FUENTES.umbrales}), pero se convoco como ${fixEncoding(p.modalidad)}. Revisar posible fraccionamiento (Art. 81 Ley 47-25) o justificacion de excepcion.`);
    } else if (inferior === false) {
      out.push(`- Modalidad: ${fixEncoding(p.modalidad)} es compatible con el monto (por umbral corresponde como minimo ${legal.nombre}; el Art. 59 P. II permite una modalidad superior).`);
    }
  }
  const cierre = parseFechaDGCP(p.fecha_fin_recepcion_ofertas);
  const pub = parseFechaDGCP(p.fecha_publicacion);
  if (cierre !== null && pub !== null && cierre > Date.now()) {
    const limiteAclaraciones = pub + (cierre - pub) * ACLARACIONES_PCT_PLAZO;
    const iso = formatEpochRD(limiteAclaraciones);
    out.push(limiteAclaraciones > Date.now()
      ? `- Aclaraciones al pliego: puedes pedirlas hasta aprox. ${iso} (50% del plazo, Art. 102 Ley 47-25).`
      : `- Aclaraciones al pliego: el plazo para pedirlas (50% del periodo de ofertas, Art. 102) ya paso.`);
  }
  return out.length ? ["## Control de legalidad", ...out] : [];
}

const InteligenciaSchema = z.object({
  codigo_proceso: z.string().min(3).describe("Codigo oficial del proceso, ej. 'MIP-CCC-LPN-2026-0005'."),
}).strict();

const RadiografiaSchema = z.object({
  termino: z.string().min(2).describe("RPE, RNC/cedula o nombre de la empresa."),
}).strict();

const CalculadoraSchema = z.object({
  monto_estimado: z.number().positive().describe("Presupuesto estimado en DOP."),
  tipo_objeto: z.enum(["bienes_servicios", "obras"]).optional().describe("Default 'bienes_servicios'."),
  modalidad_planteada: z.string().optional().describe("Modalidad usada por la institucion, para verificar si es inferior a la legal."),
  es_mipyme: z.boolean().optional().describe("true si el oferente es MIPYME certificada."),
}).strict();

export function registerInteligenciaTools(server: McpServer): void {
  server.registerTool("dgcp_inteligencia_proceso", {
    title: "Expediente 360 de un proceso de compra (DGCP)",
    description: `Arma el expediente completo de una licitacion en una sola llamada, con consultas exactas a la API:
1. Ficha y cronograma (hora RD) con cuenta regresiva y regimen legal aplicable (Ley 47-25 o 340-06 transitoria).
2. Articulos solicitados (codigo UNSPSC, cantidades y precio unitario estimado por la institucion).
3. Documentos del pliego publicados (enlaces directos).
4. Ofertas recibidas y contratos adjudicados del proceso.
5. Historial de la institucion: a quien le compra y cuanto (ultimos contratos).
6. Control de legalidad: plazo minimo del Art. 101, modalidad vs umbral (posible fraccionamiento), fecha limite de aclaraciones.
7. Garantias, anticipo MIPYME y plazo de pago segun la Ley 47-25 y el Dec. 52-26.`,
    inputSchema: InteligenciaSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error armando el expediente del proceso", async ({ codigo_proceso }: z.infer<typeof InteligenciaSchema>) => {
    const cod = codigo_proceso.trim();
    const [proc, articulos, documentos, ofertas, contratos] = await Promise.all([
      dgcpListar<ProcesoReal>("procesos", { proceso: cod }, { maxPaginas: 1, limite: 10 }),
      dgcpListar<ArticuloProceso>("procesos/articulos", { proceso: cod }, { maxPaginas: 2 }),
      dgcpGet<{ payload?: { content?: DocumentoProceso[] | null } }>("procesos/documentos", { proceso: cod }).catch(() => null),
      dgcpListar<OfertaReal>("ofertas", { proceso: cod }, { maxPaginas: 2 }),
      dgcpListar<ContratoReal>("contratos", { proceso: cod }, { maxPaginas: 2 }),
    ]);
    const p = proc.items.find((x) => normalizar(x.codigo_proceso) === normalizar(cod)) ?? proc.items[0];
    if (!p) {
      return texto(`No existe el proceso "${cod}" en la API DGCP. Verifica el codigo exacto (ej. 'MIP-CCC-LPN-2026-0005'); si se publico hace pocas horas, aparecera tras el proximo corte de datos.` + pie());
    }
    const monto = typeof p.monto_estimado === "number" ? p.monto_estimado : 0;
    const out: string[] = [
      `# Expediente: ${fixEncoding(p.titulo ?? cod).trim()}`,
      `**Codigo:** ${p.codigo_proceso} | **Institucion:** ${fixEncoding(p.unidad_compra ?? "N/D")} (cod. ${p.codigo_unidad_compra ?? "N/D"})`,
      `**Modalidad:** ${fixEncoding(p.modalidad ?? "N/D")}${p.tipo_excepcion && p.tipo_excepcion !== "Proceso ordinario" ? ` (${fixEncoding(p.tipo_excepcion)})` : ""} | **Objeto:** ${fixEncoding(p.objeto_proceso ?? "N/D")}${p.subobjeto_proceso ? ` / ${fixEncoding(p.subobjeto_proceso)}` : ""}`,
      `**Presupuesto estimado:** ${formatMonto(monto, p.divisa ?? "DOP")} | **Estado:** ${fixEncoding(p.estado_proceso ?? "N/D")}`,
      `**MIPYME:** ${p.dirigido_mipymes === "Si" ? `Si${p.dirigido_mipymes_mujeres === "Si" ? " (mujeres)" : ""}` : "No"} | **Lotes:** ${p.proceso_lotificado ?? "N/D"} | **Proveedores notificados:** ${p.numero_proveedores_notificados ?? "N/D"}`,
      `**Regimen legal:** ${describirRegimen(regimenAplicable(p.fecha_publicacion))}`,
      p.url ? `**Portal:** ${String(p.url).replace("//Public", "/Public")}` : "",
      "",
      "## Cronograma (hora RD)",
      `- Publicacion: ${formatFechaHoraRD(p.fecha_publicacion)}${p.fecha_enmienda ? ` | Fecha limite de enmiendas: ${formatFechaHoraRD(p.fecha_enmienda)}` : ""}`,
      `- Cierre de ofertas: ${formatFechaHoraRD(p.fecha_fin_recepcion_ofertas)} (${cuentaRegresiva(p.fecha_fin_recepcion_ofertas)})`,
      `- Apertura: ${formatFechaHoraRD(p.fecha_apertura_ofertas)} | Adjudicacion estimada: ${formatFechaHoraRD(p.fecha_estimada_adjudicacion)} | Suscripcion: ${formatFechaHoraRD(p.fecha_suscripcion)}`,
      p.duracion_contrato ? `- Duracion del contrato: ${p.duracion_contrato}` : "",
      "",
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "");

    // Articulos
    if (articulos.items.length > 0) {
      out.push(`## Articulos solicitados (${articulos.items.length})`,
        "| # | Descripcion | UNSPSC | Cant. | Unidad | P. unitario est. | Total est. |",
        "|---|---|---|---|---|---|---|");
      articulos.items.slice(0, 25).forEach((a, i) => out.push(
        `| ${i + 1} | ${celda(a.descripcion_usuario || a.descripcion_articulo, 70)} | ${a.subclase_unspsc ?? "N/D"} | ${a.cantidad ?? "N/D"} | ${celda(a.unidad_medida, 15)} | ${formatMonto(a.precio_unitario_estimado)} | ${formatMonto(a.precio_total_estimado)} |`));
      if (articulos.items.length > 25) out.push(`_(+${articulos.items.length - 25} articulos mas)_`);
      out.push("Tip: usa dgcp_precios_referencia con la subclase UNSPSC para ver a que precio se ha adjudicado ese articulo antes.", "");
    }

    // Documentos
    const docs = documentos?.payload?.content ?? [];
    if (docs.length > 0) {
      out.push(`## Documentos publicados (${docs.length})`);
      [...docs].sort((a, b) => (parseFechaDGCP(b.fecha_carga_archivo) ?? 0) - (parseFechaDGCP(a.fecha_carga_archivo) ?? 0))
        .slice(0, 20)
        .forEach((d) => out.push(`- ${recortar(d.nombre_documento, 90)} (${recortar(d.tipo_documento, 60)}, ${formatFechaHoraRD(d.fecha_carga_archivo)}): ${d.url_documento ?? "sin enlace"}`));
      out.push("");
    }

    // Ofertas y contratos del proceso
    out.push(`## Ofertas recibidas (${ofertas.items.length})`);
    if (ofertas.items.length === 0) {
      out.push((msHasta(p.fecha_fin_recepcion_ofertas) ?? 0) > 0
        ? "Aun no hay ofertas visibles: el plazo sigue abierto y las ofertas se publican tras la apertura."
        : "La API no registra ofertas para este proceso.");
    } else {
      const ord = [...ofertas.items].sort((a, b) => (a.valor_oferta ?? Infinity) - (b.valor_oferta ?? Infinity));
      const minimo = ord[0].valor_oferta ?? 0;
      ord.slice(0, 20).forEach((o, i) => out.push(
        `${i + 1}. ${fixEncoding(o.razon_social ?? "N/D")} (RPE ${o.rpe ?? "N/D"}): ${formatMonto(o.valor_oferta)}${monto > 0 && o.valor_oferta ? ` = ${formatPct((o.valor_oferta / monto) * 100)} del estimado` : ""}${i > 0 && minimo > 0 && o.valor_oferta ? `, +${formatPct(((o.valor_oferta - minimo) / minimo) * 100)} sobre la menor` : ""}`));
    }
    out.push("", `## Adjudicacion (${contratos.items.length} contrato(s))`);
    if (contratos.items.length === 0) out.push("Sin contratos registrados para este proceso todavia.");
    contratos.items.forEach((c) => out.push(
      `- ${fixEncoding(c.razon_social ?? "N/D")} (RPE ${c.rpe ?? "N/D"}): ${formatMonto(c.valor_contratado, c.divisa ?? "DOP")} | ${fixEncoding(c.estado_contrato ?? "")} | pago ${fixEncoding(c.metodo_pago ?? "N/D")}, ${fixEncoding(c.plazo_pago_factura ?? "N/D")}${c.url_contrato ? ` | ${c.url_contrato}` : ""}`));

    // Historial de la institucion
    if (p.codigo_unidad_compra) {
      const hist = await dgcpListar<ContratoReal>("contratos", { unidad_compra: p.codigo_unidad_compra }, { maxPaginas: 1 });
      if (hist.items.length > 0) {
        const porProv = new Map<string, { nombre: string; monto: number; n: number }>();
        for (const c of hist.items) {
          const k = soloDigitos(c.rpe) || normalizar(c.razon_social);
          const e = porProv.get(k) ?? { nombre: fixEncoding(c.razon_social ?? "N/D"), monto: 0, n: 0 };
          e.monto += c.valor_contratado ?? 0;
          e.n++;
          porProv.set(k, e);
        }
        const total = sumar(hist.items, (c) => c.valor_contratado);
        const top = [...porProv.entries()].sort((a, b) => b[1].monto - a[1].monto).slice(0, 8);
        out.push("", `## A quien le compra ${fixEncoding(p.unidad_compra ?? "la institucion")} (ultimos ${hist.items.length} contratos de ${hist.total.toLocaleString("en-US")})`,
          `Total: ${formatMonto(total)} entre ${porProv.size} proveedores.`);
        top.forEach(([rpe, e], i) => out.push(`${i + 1}. ${e.nombre} (RPE ${rpe}): ${e.n} contratos, ${formatMonto(e.monto)} (${formatPct(total > 0 ? (e.monto / total) * 100 : 0)})`));
        const similares = hist.items.filter((c) => {
          const palabras = normalizar(p.titulo).split(" ").filter((w) => w.length > 5).slice(0, 6);
          const d = normalizar(c.descripcion);
          return palabras.filter((w) => d.includes(w)).length >= 2 && normalizar(c.codigo_proceso) !== normalizar(cod);
        }).slice(0, 5);
        if (similares.length > 0) {
          out.push("", "### Contratos anteriores parecidos (quien gano antes)");
          similares.forEach((c) => out.push(`- ${soloFecha(c.fecha_adjudicacion)} | ${recortar(c.descripcion, 80)} -> ${fixEncoding(c.razon_social ?? "N/D")}: ${formatMonto(c.valor_contratado)}`));
        }
      }
    }

    out.push("", ...seccionLegalidad(p, monto), "", ...seccionGarantias(p, monto), "", `_${AVISO_LEGAL}_`);
    return texto(out.join("\n") + pie());
  }));

  server.registerTool("dgcp_radiografia_proveedor", {
    title: "Radiografia de un proveedor del Estado (DGCP)",
    description: `Perfil completo y exacto de una empresa en compras publicas a partir de su RPE, RNC o nombre:
ficha RPE, alerta de inhabilitacion/suspension, rubros UNSPSC registrados, TODOS sus contratos (monto total, clientes principales, ultimos contratos) y sus ofertas (tasa de exito: procesos ganados / procesos ofertados).`,
    inputSchema: RadiografiaSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error en la radiografia del proveedor", async ({ termino }: z.infer<typeof RadiografiaSchema>) => {
    const r = await resolverProveedor(termino);
    if (!r.proveedor) {
      return texto(`No se pudo identificar a "${termino}". Usa el RPE o el RNC; por nombre solo se reconocen empresas con actividad reciente.` + pie());
    }
    const prov = r.proveedor;
    const rpe = Number(soloDigitos(prov.rpe));
    const [contratos, ofertas, rubros, inh] = await Promise.all([
      dgcpListar<ContratoReal>("contratos", { rpe }, { maxPaginas: 5 }),
      dgcpListar<OfertaReal>("ofertas", { rpe }, { maxPaginas: 5 }),
      dgcpListar<RubroProveedor>("proveedores/rubro", { rpe }, { maxPaginas: 1 }).catch(() => null),
      inhabilitacionesVigentes(rpe),
    ]);

    const out = [`# Radiografia del proveedor`, formatProveedor(prov)];
    if (r.alternativas.length > 0) out.push(`_Otras empresas con nombre parecido: ${r.alternativas.map((a) => `${a.razon_social} (RPE ${a.rpe})`).join("; ")}_`);
    for (const i of inh) {
      out.push(i.es_sancion
        ? `**ALERTA: figura como inhabilitado/suspendido desde ${i.fecha_inhabilitacion.slice(0, 10)}.** Motivo oficial: ${i.motivo}`
        : `Registro cancelado/suspendido a solicitud propia desde ${i.fecha_inhabilitacion.slice(0, 10)}.`);
    }
    if (rubros && rubros.items.length > 0) {
      out.push("", `## Rubros registrados (${rubros.items.length} familias UNSPSC)`,
        rubros.items.slice(0, 15).map((x) => `${x.familia_unspsc} ${recortar(x.descripcion, 50)}`).join("; ") + (rubros.items.length > 15 ? ` (+${rubros.items.length - 15})` : ""));
    }

    out.push("", "## Contratos con el Estado");
    if (contratos.items.length === 0) {
      out.push("No registra contratos adjudicados.");
    } else {
      const validos = contratos.items.filter((c) => !/cancel/i.test(String(c.estado_contrato)));
      const total = sumar(validos, (c) => c.valor_contratado);
      const porInst = new Map<string, { monto: number; n: number }>();
      for (const c of validos) {
        const k = fixEncoding(c.unidad_compra ?? "N/D");
        const e = porInst.get(k) ?? { monto: 0, n: 0 };
        e.monto += c.valor_contratado ?? 0; e.n++;
        porInst.set(k, e);
      }
      const fechas = validos.map((c) => parseFechaDGCP(c.fecha_adjudicacion)).filter((x): x is number => x !== null).sort((a, b) => a - b);
      out.push(
        `${contratos.completo ? "Todos sus" : `Sus ${contratos.items.length.toLocaleString("en-US")} mas recientes de`} ${contratos.total.toLocaleString("en-US")} contratos. Validos (no cancelados): ${validos.length} por ${formatMonto(total)}; promedio ${formatMonto(validos.length ? total / validos.length : 0)}.`,
        fechas.length ? `Periodo: ${fechaISORD(fechas[0])} a ${fechaISORD(fechas[fechas.length - 1])}.` : "",
        "", "### Principales clientes",
      );
      [...porInst.entries()].sort((a, b) => b[1].monto - a[1].monto).slice(0, 8)
        .forEach(([inst, e], i) => out.push(`${i + 1}. ${inst}: ${e.n} contratos, ${formatMonto(e.monto)} (${formatPct(total > 0 ? (e.monto / total) * 100 : 0)})`));
      out.push("", "### Ultimos contratos");
      [...validos].sort((a, b) => (parseFechaDGCP(b.fecha_adjudicacion) ?? 0) - (parseFechaDGCP(a.fecha_adjudicacion) ?? 0)).slice(0, 8)
        .forEach((c) => out.push(`- ${soloFecha(c.fecha_adjudicacion)} | ${c.codigo_proceso} | ${recortar(c.descripcion, 70)} | ${fixEncoding(c.unidad_compra ?? "")}: ${formatMonto(c.valor_contratado)} (pago ${fixEncoding(c.plazo_pago_factura ?? "N/D")})`));
    }

    if (ofertas.items.length > 0) {
      const procOfertados = new Set(ofertas.items.map((o) => normalizar(o.codigo_proceso)));
      const procGanados = new Set(contratos.items.map((c) => normalizar(c.codigo_proceso)).filter((c) => procOfertados.has(c)));
      out.push("", "## Ofertas y tasa de exito",
        `Ofertas presentadas: ${ofertas.total.toLocaleString("en-US")} en ${procOfertados.size} procesos${ofertas.completo ? "" : " (muestra mas reciente)"}. Procesos ganados entre esos: ${procGanados.size} -> tasa de exito ${formatPct(procOfertados.size ? (procGanados.size / procOfertados.size) * 100 : 0)}.`,
        `Valor ofertado total: ${formatMonto(sumar(ofertas.items, (o) => o.valor_oferta))}.`);
    }
    return texto(out.filter((l) => l !== undefined).join("\n") + pie());
  }));

  server.registerTool("dgcp_calculadora_legal", {
    title: "Calculadora normativa: umbrales 2026, modalidad, plazos y garantias",
    description: `Para un presupuesto dado calcula, con la Ley 47-25, el Dec. 52-26 y los umbrales 2026 (Resolucion PNP-03-2026):
1. Modalidad que corresponde y plazo minimo de convocatoria (Art. 101).
2. Si la modalidad usada por la institucion es inferior a la legal (indicio de fraccionamiento, Art. 81).
3. Garantia de seriedad (1%), fiel cumplimiento (4% o 1% MIPYME), anticipo MIPYME (30%) y reglas especiales MIPYME.`,
    inputSchema: CalculadoraSchema.shape,
    annotations: CALCULO_LOCAL,
  }, seguro("Error en la calculadora legal", async (p: z.infer<typeof CalculadoraSchema>) => {
    const m = p.monto_estimado;
    const tipo: TipoObjeto = p.tipo_objeto ?? "bienes_servicios";
    const legal = modalidadPorMonto(m, tipo);
    const u = UMBRALES_2026[tipo];
    const out = [
      `# Analisis normativo (Ley 47-25 / Dec. 52-26 / umbrales 2026)`,
      `**Monto:** ${formatMonto(m)} | **Objeto:** ${tipo === "obras" ? "Obras" : "Bienes y servicios"}`,
      `**Modalidad que corresponde:** ${legal.nombre}`,
      legal.plazoMinimoDiasHabiles > 0
        ? `**Plazo minimo entre convocatoria y recepcion de ofertas:** ${legal.plazoMinimoDiasHabiles} dias habiles (Art. 101 Ley 47-25).`
        : `**Plazo minimo:** no aplica (Art. 101 parrafo).`,
      legal.nota ? `_${legal.nota}_` : "",
      "",
      "## Umbrales 2026 aplicables (Resolucion PNP-03-2026)",
      ...Object.entries(u).map(([k, v]) => `- ${k.replace(/_/g, " ").toLowerCase()}: ${formatMonto(v)}`),
      "",
      "## Garantias y anticipo",
      `- Seriedad de oferta (1% de la oferta, Art. 202 Dec. 52-26): ${formatMonto(m * GARANTIAS.SERIEDAD_OFERTA_PCT)} sobre este monto.${p.es_mipyme ? " **Tu empresa es MIPYME: no se te puede exigir (Art. 175.2 Ley 47-25).**" : " Una MIPYME esta exenta (Art. 175.2 Ley 47-25)."} No aplica en sorteo de obras ni subasta inversa (Art. 201).`,
      `- Fiel cumplimiento (Art. 207 Dec. 52-26): 4% = ${formatMonto(m * GARANTIAS.FIEL_CUMPLIMIENTO_PCT)}; MIPYME 1% = ${formatMonto(m * GARANTIAS.FIEL_CUMPLIMIENTO_MIPYME_PCT)}${p.es_mipyme ? " (aplica a tu empresa)" : ""}. Obligatoria por encima del equivalente a US$10,000 (Art. 205).`,
      `- Anticipo MIPYME obligatorio 30% (Art. 174 Ley 47-25): ${formatMonto(m * GARANTIAS.ANTICIPO_MIPYME_PCT)}, con garantia de buen uso por el 100% del anticipo (Art. 210 Dec. 52-26).`,
      `- MIPYMES: solo se les pueden exigir fianzas de aseguradoras (Art. 175.1 Ley 47-25).`,
    ];
    if (p.modalidad_planteada) {
      const inferior = modalidadInferiorALaLegal(p.modalidad_planteada, legal);
      out.push("", "## Verificacion de la modalidad usada");
      if (inferior === true) {
        out.push(`ALERTA: "${p.modalidad_planteada}" es menos exigente que ${legal.nombre}, que es la que corresponde por monto. Indicio de fraccionamiento (Art. 81 Ley 47-25: dividir contrataciones de un mismo rubro en menos de 3 meses para eludir la modalidad). Puede pedirse aclaracion o interponer recurso de reconsideracion (Arts. 204-205).`);
      } else if (inferior === false) {
        out.push(`Conforme: "${p.modalidad_planteada}" es igual o mas exigente que la modalidad legal (Art. 59 P. II permite usar una superior).`);
      } else {
        out.push(`"${p.modalidad_planteada}" no es una modalidad ordinaria reconocible (p. ej. excepcion). Las excepciones requieren justificacion documentada y publicada.`);
      }
      if (claveModalidad(p.modalidad_planteada) === "licitacion_publica" && normalizar(p.modalidad_planteada).includes("abreviada")) {
        out.push("Licitacion Publica Abreviada: solo para bienes y servicios comunes y estandarizados (Art. 62), minimo 15 dias habiles (Art. 101.2).");
      }
    }
    out.push("", `_${AVISO_LEGAL} Procesos convocados antes de la Ley 47-25 siguen la Ley 340-06 (Art. 245)._`);
    return texto(out.filter((l) => l !== "").join("\n").replace(/\n(#+ )/g, "\n\n$1"));
  }));
}
