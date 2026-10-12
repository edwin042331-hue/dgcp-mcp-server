// src/tools/quirurgicoTools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dgcpGet, dgcpListar } from "../services/dgcpClient.js";
import { resolverInstitucion } from "../services/catalogos.js";
import { formatMonto, formatPct, fixEncoding, normalizar, sumar, soloDigitos, contienePalabra, recortar } from "../utils/texto.js";
import { formatEpochRD, fechaISORD, sumarDias, parseFechaDGCP } from "../utils/fechas.js";
import {
  PLAZO_MAXIMO_PAGO_DIAS, PLAZO_RECURSO_DIAS_HABILES, AVISO_LEGAL, RESERVA_MIPYME, FIN_TRANSICION,
  regimenAplicable, describirRegimen,
} from "../normativa.js";
import { auditarPlazo } from "./inteligenciaTools.js";
import { texto, seguro, pie, SOLO_LECTURA, CALCULO_LOCAL } from "./comun.js";
import type { ContratoReal, ProcesoReal, CuotaMipyme, ArticuloProceso, DocumentoProceso } from "../types.js";

/** Dias de plazo de pago a partir del texto de la API ("60 dias", "No especificado"). */
export function diasDePago(plazo: unknown): number | null {
  const m = /(\d+)/.exec(normalizar(plazo));
  return m ? Number(m[1]) : null;
}

/** Indice Herfindahl-Hirschman (0-10,000) sobre participaciones de mercado. */
export function hhi(montos: number[]): number {
  const total = montos.reduce((s, x) => s + x, 0);
  if (total <= 0) return 0;
  return Math.round(montos.reduce((s, x) => s + ((x / total) * 100) ** 2, 0));
}

/** Suma n dias habiles (lunes a viernes) a una fecha YYYY-MM-DD. No descuenta feriados. */
export function sumarDiasHabiles(fechaISO: string, n: number): string {
  let d = fechaISO;
  let restantes = n;
  while (restantes > 0) {
    d = sumarDias(d, 1);
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) restantes--;
  }
  return d;
}

const MARCAS = [
  "cisco", "fortinet", "palo alto", "checkpoint", "sophos", "juniper", "aruba", "ubiquiti", "mikrotik",
  "microsoft", "oracle", "sap", "vmware", "red hat", "adobe", "autodesk", "kaspersky", "eset", "symantec",
  "dell", "hp", "hpe", "lenovo", "apple", "asus", "acer", "samsung", "lg", "huawei", "xerox", "epson", "canon",
  "ricoh", "brother", "kyocera", "toyota", "nissan", "mitsubishi", "hyundai", "kia", "ford", "chevrolet",
  "caterpillar", "john deere", "carrier", "trane", "daikin", "york", "apc", "eaton", "schneider", "siemens",
  "philips", "ge", "3m", "honeywell",
];

export function detectarMarcas(texto: string): string[] {
  return MARCAS.filter((m) => contienePalabra(texto, m));
}

const FRASES_SUBJETIVAS = ["a juicio de", "a discrecion", "a criterio del perito", "a satisfaccion de la institucion", "a criterio de la institucion", "segun considere"];
const FRASES_EXCLUSIVIDAD = ["distribuidor exclusivo", "carta de exclusividad", "representante exclusivo", "unico distribuidor", "distribuidor autorizado exclusivo"];

const ScorecardSchema = z.object({
  institucion: z.string().min(2).describe("Nombre, acronimo o codigo de la institucion. Ej: 'MINERD', 'INFOTEP', '141'."),
}).strict();

const PliegoSchema = z.object({
  codigo_proceso: z.string().min(3).describe("Codigo oficial del proceso."),
  extracto_pliego: z.string().optional().describe("Texto de clausulas o especificaciones tecnicas del pliego a auditar (copiado del PDF)."),
}).strict();

const RecursoSchema = z.object({
  tipo_recurso: z.enum(["reconsideracion", "jerarquico_impropio"]).optional()
    .describe("'reconsideracion' (default): primer recurso, ante la institucion (Art. 204). 'jerarquico_impropio': contra la decision de la reconsideracion, ante la DGCP (Art. 207)."),
  codigo_proceso: z.string().min(3).describe("Codigo del proceso."),
  acto_impugnado: z.string().min(3).describe("Acto que se impugna: 'Acta de adjudicacion No. X', 'Informe de evaluacion', 'Pliego de condiciones'..."),
  fecha_notificacion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha (YYYY-MM-DD) en que se notifico o publico el acto: calcula el vencimiento del plazo."),
  hechos: z.string().min(10).describe("Relato breve de lo ocurrido y por que perjudica al recurrente."),
  agravios: z.string().optional().describe("Normas o principios violados, si se conocen."),
  incluir_medida_cautelar: z.boolean().optional().describe("true = agrega la instancia separada de medida cautelar ante la DGCP (Art. 211)."),
  empresa_recurrente: z.string().min(2),
  rnc_recurrente: z.string().min(3),
  rpe_recurrente: z.string().optional(),
  representante: z.string().min(3).describe("Representante legal."),
}).strict();

export function registerQuirurgicoTools(server: McpServer): void {
  server.registerTool("dgcp_scorecard_institucion", {
    title: "Scorecard de una institucion compradora (DGCP)",
    description: `Perfil exacto de como compra y paga una institucion (filtro por su codigo oficial de unidad de compra):
- Plazos de pago pactados frente al maximo legal de 30 dias (Art. 148 P. III Ley 47-25) y metodo de pago.
- Concentracion de proveedores: top 5 y HHI.
- Cumplimiento de la cuota MIPYME del ano (dato oficial DGCP).
- Mezcla de modalidades (peso de excepciones y compras directas) y auditoria de plazos de convocatoria de sus procesos recientes (Art. 101).`,
    inputSchema: ScorecardSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error en el scorecard institucional", async ({ institucion }: z.infer<typeof ScorecardSchema>) => {
    const unidades = await resolverInstitucion(institucion);
    if (unidades.length === 0) return texto(`No se encontro ninguna unidad de compra para "${institucion}". Prueba con el acronimo o parte del nombre oficial.`);
    if (unidades.length > 1) {
      return texto(`"${institucion}" coincide con ${unidades.length} unidades de compra. Repite con el codigo exacto:\n` +
        unidades.slice(0, 20).map((u) => `- ${u.codigo_unidad_compra}: ${u.unidad_compra}${u.acronimo ? ` (${u.acronimo})` : ""}`).join("\n"));
    }
    const u = unidades[0];
    const anio = Number(fechaISORD().slice(0, 4));
    const [contratos, procesos, cuota] = await Promise.all([
      dgcpListar<ContratoReal>("contratos", { unidad_compra: u.codigo_unidad_compra }, { maxPaginas: 2 }),
      dgcpListar<ProcesoReal>("procesos", { unidad_compra: u.codigo_unidad_compra }, { maxPaginas: 1 }),
      dgcpGet<{ payload?: { content?: CuotaMipyme[] } | CuotaMipyme[] }>("procesos/mipymes/cuota_institucion", { unidad_compra: u.codigo_unidad_compra, "año": anio }).catch(() => null),
    ]);

    const out = [
      `# Scorecard: ${fixEncoding(u.unidad_compra ?? "")} (cod. ${u.codigo_unidad_compra}${u.acronimo ? `, ${u.acronimo}` : ""})`,
      `Contratos analizados: ${contratos.items.length.toLocaleString("en-US")} de ${contratos.total.toLocaleString("en-US")} (los mas recientes). Procesos analizados: ${procesos.items.length.toLocaleString("en-US")} de ${procesos.total.toLocaleString("en-US")}.`,
    ];
    const validos = contratos.items.filter((c) => !/cancel/i.test(String(c.estado_contrato)));
    if (validos.length > 0) {
      const total = sumar(validos, (c) => c.valor_contratado);
      const conPlazo = validos.map((c) => diasDePago(c.plazo_pago_factura)).filter((d): d is number => d !== null);
      // El maximo de 30 dias solo obliga en contratos del regimen nuevo: se mide sobre los adjudicados
      // despues de la transicion (los procesos convocados antes siguen la Ley 340-06, Art. 245).
      const corte = Date.parse(`${FIN_TRANSICION}T00:00:00-04:00`);
      const nuevos = validos.filter((c) => (parseFechaDGCP(c.fecha_adjudicacion) ?? 0) >= corte)
        .map((c) => diasDePago(c.plazo_pago_factura)).filter((d): d is number => d !== null);
      const excede = nuevos.filter((d) => d > PLAZO_MAXIMO_PAGO_DIAS).length;
      const metodos = new Map<string, number>();
      validos.forEach((c) => metodos.set(fixEncoding(c.metodo_pago ?? "No especificado"), (metodos.get(fixEncoding(c.metodo_pago ?? "No especificado")) ?? 0) + 1));
      const plazos = new Map<string, number>();
      validos.forEach((c) => plazos.set(fixEncoding(c.plazo_pago_factura ?? "No especificado"), (plazos.get(fixEncoding(c.plazo_pago_factura ?? "No especificado")) ?? 0) + 1));
      const prom = conPlazo.length ? conPlazo.reduce((s, x) => s + x, 0) / conPlazo.length : 0;

      out.push("", "## Pagos",
        `- Plazo de pago pactado promedio: ${prom.toFixed(0)} dias. Distribucion: ${[...plazos.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(", ")}.`,
        nuevos.length > 0
          ? `- Adjudicados desde el ${FIN_TRANSICION} con plazo pactado mayor a ${PLAZO_MAXIMO_PAGO_DIAS} dias: ${excede} de ${nuevos.length} (${formatPct((excede / nuevos.length) * 100)}). La Ley 47-25 obliga a pagar en maximo 30 dias desde que se cumple la condicion de pago y se presenta el requerimiento, con intereses por mora si no (Art. 148 P. III). Verifica en cada caso que el proceso se convoco ya bajo la Ley 47-25.`
          : `- No hay contratos adjudicados despues del ${FIN_TRANSICION} en la muestra para medir el plazo legal de 30 dias (Art. 148 P. III Ley 47-25).`,
        `- Metodo de pago: ${[...metodos.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${formatPct((v / validos.length) * 100)}`).join(", ")}.`,
        `- Calificacion de pago: ${prom <= 30 ? "A (paga en plazo legal)" : prom <= 60 ? "B (60 dias tipicos: prever capital de trabajo)" : "C (pago lento: incluye el costo financiero en tu precio o usa factoring, Art. 174/cesion de credito)"}.`);

      const porProv = new Map<string, { nombre: string; monto: number; n: number }>();
      for (const c of validos) {
        const k = soloDigitos(c.rpe) || normalizar(c.razon_social);
        const e = porProv.get(k) ?? { nombre: fixEncoding(c.razon_social ?? "N/D"), monto: 0, n: 0 };
        e.monto += c.valor_contratado ?? 0; e.n++;
        porProv.set(k, e);
      }
      const orden = [...porProv.values()].sort((a, b) => b.monto - a.monto);
      const indice = hhi(orden.map((x) => x.monto));
      const top3 = orden.slice(0, 3).reduce((s, x) => s + x.monto, 0);
      out.push("", "## Concentracion de proveedores",
        `- ${porProv.size} proveedores distintos; monto total ${formatMonto(total)}.`,
        `- Top 3 concentra ${formatPct(total ? (top3 / total) * 100 : 0)}. HHI = ${indice} (${indice >= 2500 ? "muy concentrado" : indice >= 1500 ? "moderadamente concentrado" : "competitivo"}).`,
        ...orden.slice(0, 5).map((x, i) => `${i + 1}. ${x.nombre}: ${x.n} contratos, ${formatMonto(x.monto)} (${formatPct(total ? (x.monto / total) * 100 : 0)})`));
    }

    const c = cuota ? (Array.isArray(cuota.payload) ? cuota.payload : cuota.payload?.content ?? [])[0] : undefined;
    if (c && typeof c.porcentaje_mipymes === "number") {
      out.push("", `## Adjudicacion a MIPYMES ${c.año ?? anio} (dato oficial DGCP)`,
        `- Adjudicado total: ${formatMonto(c.monto_adjudicado)}; a MIPYMES: ${formatMonto(c.adjudicado_mipymes)} (${formatPct(c.porcentaje_mipymes)}); a MIPYMES de mujeres: ${formatPct(c.porcentaje_mipymes_mujeres ?? 0)}.`,
        `- Referencia legal: el Art. 172 Ley 47-25 obliga a reservar al menos el ${RESERVA_MIPYME.TOTAL_PCT}% de las partidas de contratacion para procedimientos exclusivos de MIPYMES (${RESERVA_MIPYME.GENERAL_PCT}% general y ${RESERVA_MIPYME.MUJERES_PCT}% dirigidas por mujeres). La cifra de arriba mide lo adjudicado a MIPYMES por cualquier via, no la reserva: sirve como indicio, no como prueba de cumplimiento.`);
    }

    if (procesos.items.length > 0) {
      const mods = new Map<string, number>();
      procesos.items.forEach((p) => mods.set(fixEncoding(p.modalidad ?? "N/D"), (mods.get(fixEncoding(p.modalidad ?? "N/D")) ?? 0) + 1));
      const auditados = procesos.items.map((p) => ({ p, a: auditarPlazo(p) })).filter((x) => x.a !== null);
      const incumplen = auditados.filter((x) => x.a!.incumple);
      out.push("", `## Procesos recientes (${procesos.items.length})`,
        `- Modalidades: ${[...mods.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${formatPct((v / procesos.items.length) * 100)}`).join(", ")}.`,
        `- Plazo de convocatoria (Art. 101 Ley 47-25): ${auditados.length} procesos auditables, ${incumplen.length} con menos dias habiles que el minimo legal${incumplen.length > 0 ? " (el conteo no descuenta feriados, asi que esos incumplimientos son ciertos)" : ""}.`);
      incumplen.slice(0, 8).forEach(({ p, a }) => out.push(`  - ${p.codigo_proceso} (${fixEncoding(p.modalidad ?? "")}): ${a!.habiles} de ${a!.minimo} dias habiles. ${recortar(p.titulo, 70)}`));
    }
    out.push("", `_${AVISO_LEGAL}_`);
    return texto(out.join("\n") + pie());
  }));

  server.registerTool("dgcp_auditor_pliego_trampa", {
    title: "Auditor de pliegos dirigidos (DGCP)",
    description: `Revisa si un proceso tiene senales de pliego dirigido o barreras indebidas:
- Marcas o nombres comerciales en titulo, articulos o el extracto del pliego (Art. 91 P. II Ley 47-25: prohibidas salvo que no exista otra forma de describir el objeto).
- Exigencias de exclusividad y criterios subjetivos de evaluacion (Art. 91 P. I: especificaciones que crean obstaculos innecesarios).
- Plazo de convocatoria inferior al minimo (Art. 101) y fecha limite para pedir aclaraciones (Art. 102).
Genera la solicitud de aclaracion lista para el buzon del portal. Pega en 'extracto_pliego' las especificaciones del PDF para un analisis completo.`,
    inputSchema: PliegoSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error auditando el pliego", async ({ codigo_proceso, extracto_pliego }: z.infer<typeof PliegoSchema>) => {
    const cod = codigo_proceso.trim();
    const [proc, arts, docs] = await Promise.all([
      dgcpListar<ProcesoReal>("procesos", { proceso: cod }, { maxPaginas: 1, limite: 5 }),
      dgcpListar<ArticuloProceso>("procesos/articulos", { proceso: cod }, { maxPaginas: 1 }),
      dgcpGet<{ payload?: { content?: DocumentoProceso[] | null } }>("procesos/documentos", { proceso: cod }).catch(() => null),
    ]);
    const p = proc.items[0];
    const fuentes = [
      p?.titulo, p?.descripcion,
      ...arts.items.map((a) => a.descripcion_usuario),
      extracto_pliego,
    ].map((x) => fixEncoding(x ?? "")).join(" \n ");
    const t = normalizar(fuentes);
    const hallazgos: string[] = [];

    const marcas = detectarMarcas(fuentes);
    if (marcas.length > 0) {
      const equivalente = /(o (su )?equivalente|o similar|equivalente funcional|o superior)/.test(t);
      hallazgos.push(equivalente
        ? `Menciona marcas (${marcas.join(", ").toUpperCase()}) con salvedad de equivalencia. Verifica que las especificaciones no sean exclusivas de una marca.`
        : `**Marcas sin salvedad de equivalencia: ${marcas.join(", ").toUpperCase()}.** El Art. 91 P. II Ley 47-25 prohibe exigir o mencionar marcas salvo que no exista otro medio suficientemente preciso para describir el objeto.`);
    }
    const subj = FRASES_SUBJETIVAS.filter((f) => t.includes(f));
    if (subj.length) hallazgos.push(`**Criterios subjetivos** ("${subj.join('", "')}"): la evaluacion debe ser objetiva y verificable (Art. 91 Ley 47-25).`);
    const excl = FRASES_EXCLUSIVIDAD.filter((f) => t.includes(f));
    if (excl.length) hallazgos.push(`**Exigencia de exclusividad** ("${excl.join('", "')}"): restringe la participacion (Art. 91 P. I). La exclusividad solo justifica un procedimiento de excepcion por proveedor unico.`);
    const exp = /experiencia (minima )?de (\d+) anos/.exec(t);
    if (exp && Number(exp[2]) >= 5) hallazgos.push(`Exige ${exp[2]} anos de experiencia: valida que sea proporcional al objeto; requisitos excesivos pueden ser un obstaculo innecesario (Art. 91 P. I).`);
    if (p) {
      const a = auditarPlazo(p);
      if (a?.incumple) hallazgos.push(`**Plazo insuficiente:** ${a.habiles} dias habiles entre publicacion y cierre, minimo ${a.minimo} (${a.base}).`);
    }

    const pub = parseFechaDGCP(p?.fecha_publicacion);
    const cierre = parseFechaDGCP(p?.fecha_fin_recepcion_ofertas);
    const limiteAclaracion = pub !== null && cierre !== null ? pub + (cierre - pub) / 2 : null;

    const out = [
      `# Auditoria de pliego: ${cod}`,
      p ? `${fixEncoding(p.titulo ?? "").trim()} | ${fixEncoding(p.unidad_compra ?? "")} | ${fixEncoding(p.modalidad ?? "")} | ${formatMonto(p.monto_estimado)}` : "_Proceso no encontrado en /procesos: se audita solo el extracto aportado._",
      p ? `Regimen: ${describirRegimen(regimenAplicable(p.fecha_publicacion))}` : "",
      `Texto analizado: titulo, ${arts.items.length} articulos${extracto_pliego ? " y el extracto aportado" : " (sin extracto del pliego: pega las especificaciones para un analisis completo)"}.`,
      "", "## Hallazgos",
      ...(hallazgos.length ? hallazgos.map((h) => `- ${h}`) : ["- Sin senales de direccionamiento en el texto disponible."]),
    ];
    const docsPliego = (docs?.payload?.content ?? []).filter((d) => /pliego|especificacion|ficha|termino/i.test(`${d.nombre_documento} ${d.tipo_documento}`));
    if (docsPliego.length) {
      out.push("", "## Documentos del pliego para revisar", ...docsPliego.slice(0, 8).map((d) => `- ${recortar(d.nombre_documento, 80)}: ${d.url_documento}`));
    }
    out.push("", "## Solicitud de aclaracion (para el buzon de consultas del portal)",
      limiteAclaracion !== null
        ? `Plazo para enviarla: hasta ${formatEpochRD(limiteAclaracion)} (50% del plazo de ofertas, Art. 102 Ley 47-25).${limiteAclaracion < Date.now() ? " **Ese plazo ya vencio.**" : ""}`
        : "Plazo: hasta el 50% del periodo de presentacion de ofertas (Art. 102 Ley 47-25).",
      "",
      `Senores Comite de Contrataciones Publicas${p ? ` de ${fixEncoding(p.unidad_compra ?? "")}` : ""}:`,
      "",
      `Ref.: Procedimiento ${cod}. Solicitud de aclaracion y enmienda del pliego de condiciones (Art. 102 Ley 47-25).`,
      "",
      "En virtud del principio de libre competencia y de los Arts. 91 y 102 de la Ley 47-25, solicitamos:",
      marcas.length ? `1. Confirmar que se admitiran bienes de marcas distintas a ${marcas.join(", ").toUpperCase()} que cumplan una equivalencia funcional y tecnica, o enmendar las especificaciones para describir el objeto de forma objetiva, funcional y generica (Art. 91 P. II).` : "1. Confirmar que las especificaciones tecnicas admiten soluciones equivalentes que cumplan las mismas funciones (Art. 91).",
      excl.length ? "2. Eliminar la exigencia de exclusividad o de distribuidor unico, por constituir un obstaculo innecesario a la participacion (Art. 91 P. I)." : "2. Precisar los criterios de evaluacion de forma objetiva y verificable, indicando su ponderacion.",
      "3. Publicar las respuestas y enmiendas en el SECP para conocimiento de todos los interesados.",
      "", "Atentamente,", "[Nombre del representante] - [Empresa] - RNC [ ] - RPE [ ]",
      "", `_${AVISO_LEGAL}_`);
    return texto(out.filter((l) => l !== "").join("\n").replace(/\n(#+ )/g, "\n\n$1") + pie());
  }));

  server.registerTool("dgcp_generador_recurso_impugnacion", {
    title: "Generador de recurso administrativo (Ley 47-25)",
    description: `Redacta el recurso correcto segun la Ley 47-25:
- Reconsideracion: primero y obligatorio, ante el organo responsable del proceso, en 10 dias habiles (Arts. 204-205).
- Jerarquico impropio: contra la decision de la reconsideracion, ante la DGCP, en 10 dias habiles (Arts. 207-208).
- Medida cautelar: instancia separada ante la DGCP mientras el recurso este pendiente (Art. 211); los recursos NO suspenden el acto por si solos (Art. 201).
Calcula el vencimiento del plazo si se indica la fecha de notificacion. Si el proceso fue convocado bajo la Ley 340-06, lo advierte.`,
    inputSchema: RecursoSchema.shape,
    annotations: CALCULO_LOCAL,
  }, seguro("Error generando el recurso", async (p: z.infer<typeof RecursoSchema>) => {
    const tipo = p.tipo_recurso ?? "reconsideracion";
    const proc = await dgcpListar<ProcesoReal>("procesos", { proceso: p.codigo_proceso.trim() }, { maxPaginas: 1, limite: 5 }).catch(() => null);
    const pr = proc?.items[0];
    const regimen = regimenAplicable(pr?.fecha_publicacion);
    const institucion = pr ? fixEncoding(pr.unidad_compra ?? "") : "[Institucion contratante]";
    const vence = p.fecha_notificacion ? sumarDiasHabiles(p.fecha_notificacion, PLAZO_RECURSO_DIAS_HABILES) : null;
    const hoy = fechaISORD();

    const out: string[] = [];
    if (regimen !== "ley_47_25") {
      out.push(`> **Atencion:** el proceso fue convocado bajo ${describirRegimen(regimen)}. Por el Art. 245 Ley 47-25, sus recursos se rigen por la ley vigente al momento de la convocatoria; adapta este modelo con un abogado.`, "");
    }
    if (vence) {
      out.push(`> **Plazo:** notificado el ${p.fecha_notificacion}; vence el ${vence} (10 dias habiles, sin descontar feriados: si hubo feriados el plazo se extiende).${vence < hoy ? " **SEGUN ESTE CALCULO EL PLAZO YA VENCIO.**" : ""}`, "");
    }
    const destinatario = tipo === "reconsideracion"
      ? `Comite de Contrataciones Publicas / Organo responsable del procedimiento\n${institucion}`
      : "Direccion General de Contrataciones Publicas (DGCP)";
    out.push(
      `# RECURSO DE ${tipo === "reconsideracion" ? "RECONSIDERACION" : "JERARQUICO IMPROPIO"}`,
      "", `**A:** ${destinatario}`,
      `**Recurrente:** ${p.empresa_recurrente}, RNC ${p.rnc_recurrente}${p.rpe_recurrente ? `, RPE ${p.rpe_recurrente}` : ""}, representada por ${p.representante}.`,
      `**Procedimiento:** ${p.codigo_proceso}${pr ? ` - ${fixEncoding(pr.titulo ?? "").trim()}` : ""}`,
      `**Acto impugnado:** ${p.acto_impugnado}${p.fecha_notificacion ? `, notificado/publicado el ${p.fecha_notificacion}` : ""}.`,
      tipo === "jerarquico_impropio" ? `**Antecedente:** resolucion que decidio el recurso de reconsideracion interpuesto ante ${institucion}.` : "",
      "", "## I. Legitimacion y admisibilidad",
      `La recurrente es oferente${p.rpe_recurrente ? " inscrita en el Registro de Proveedores del Estado" : ""} afectada en sus derechos e intereses legitimos por el acto impugnado (Art. 202 Ley 47-25). El recurso se presenta por escrito por la via habilitada (Art. 203) y dentro del plazo de diez (10) dias habiles (Art. ${tipo === "reconsideracion" ? "205" : "208"}).`,
      "", "## II. Hechos", p.hechos,
      "", "## III. Agravios y fundamentos de derecho",
      p.agravios ?? "El acto impugnado vulnera los principios de juridicidad, objetividad, igualdad, libre competencia, transparencia y debido proceso que rigen las contrataciones publicas (Ley 47-25), asi como el deber de motivacion de los actos administrativos (Ley 107-13).",
      "", "## IV. Pedimentos",
      "PRIMERO: Declarar admisible el presente recurso por haber sido interpuesto en tiempo habil y conforme a la Ley 47-25.",
      `SEGUNDO: En cuanto al fondo, revocar ${p.acto_impugnado} y ordenar la reevaluacion de las ofertas con apego a los criterios del pliego de condiciones.`,
      "TERCERO: Ordenar la publicacion de la decision en el Sistema Electronico de Contrataciones Publicas.",
      "", "Bajo reserva de derechos.", "", `${p.representante}`, `Por ${p.empresa_recurrente}`, `Fecha: ${hoy}`,
    );
    if (p.incluir_medida_cautelar) {
      out.push("", "---", "# SOLICITUD DE MEDIDA CAUTELAR (instancia separada, Art. 211 Ley 47-25)",
        "**A:** Direccion General de Contrataciones Publicas (DGCP)",
        `**Recurrente:** ${p.empresa_recurrente}, RNC ${p.rnc_recurrente} | **Procedimiento:** ${p.codigo_proceso}`,
        "",
        `La interposicion del recurso no suspende los efectos del acto (Art. 201). Mientras se decide el recurso de ${tipo === "reconsideracion" ? "reconsideracion" : "jerarquico impropio"}, solicitamos ordenar la suspension provisional del procedimiento, incluida la firma o ejecucion del contrato, por concurrir:`,
        "- Apariencia de buen derecho: los hechos y fundamentos expuestos en el recurso, que se anexa.",
        "- Dano irreparable por la demora: de suscribirse o ejecutarse el contrato, la decision final del recurso quedaria sin efecto practico.",
        "La DGCP notifica la solicitud en 2 dias habiles y las partes tienen 3 dias habiles para pronunciarse (Art. 212).",
        "", `${p.representante} - ${p.empresa_recurrente}`);
    }
    out.push("", `_${AVISO_LEGAL} Hazlo revisar y firmar por un abogado antes de presentarlo._`);
    return texto(out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"));
  }));
}
