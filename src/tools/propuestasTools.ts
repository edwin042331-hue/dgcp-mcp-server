// src/tools/propuestasTools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dgcpListar } from "../services/dgcpClient.js";
import { formatMonto, formatPct, fixEncoding } from "../utils/texto.js";
import { formatFechaHoraRD, fechaISORD } from "../utils/fechas.js";
import { regimenAplicable, describirRegimen, exentaDeSeriedad, GARANTIAS, AVISO_LEGAL } from "../normativa.js";
import { texto, seguro, CALCULO_LOCAL, SOLO_LECTURA } from "./comun.js";
import type { ProcesoReal } from "../types.js";

export const ITBIS = 0.18;

export interface Escenario {
  pct: number;
  precio: number;
  margen: number;
  margenPct: number;
  puntosEconomicos: number;
  puntajeTotal: number;
}

/**
 * Formula de proporcionalidad inversa de uso comun en pliegos del SNCP:
 *   puntos = (precio_minimo / precio_ofertado) * puntos_maximos
 * El precio minimo es el menor entre las ofertas rivales esperadas y la propia.
 */
export function simularEscenarios(p: {
  referencial: number;
  costo: number;
  puntajeTecnico: number;
  pesoEconomico: number;
  preciosRivales: number[];
  porcentajes?: number[];
}): Escenario[] {
  const pcts = p.porcentajes ?? [0.85, 0.88, 0.90, 0.92, 0.94, 0.96, 0.98, 1.0];
  return pcts.map((pct) => {
    const precio = p.referencial * pct;
    const minimo = Math.min(precio, ...p.preciosRivales.filter((x) => x > 0));
    const puntosEconomicos = precio > 0 ? Math.min(p.pesoEconomico, (minimo / precio) * p.pesoEconomico) : 0;
    const margen = precio - p.costo;
    return {
      pct, precio, margen,
      margenPct: precio > 0 ? (margen / precio) * 100 : 0,
      puntosEconomicos,
      puntajeTotal: p.puntajeTecnico + puntosEconomicos,
    };
  });
}

const GeneradorSchema = z.object({
  codigo_proceso: z.string().min(3).describe("Codigo oficial del proceso."),
  razon_social: z.string().min(2).describe("Razon social del oferente."),
  rnc: z.string().min(3),
  rpe: z.union([z.string(), z.number()]),
  representante_legal: z.string().min(3),
  cedula_representante: z.string().min(3),
  monto_ofertado_subtotal: z.number().positive().describe("Subtotal de la oferta antes de ITBIS (DOP)."),
  aplica_itbis: z.boolean().optional().describe("false si el bien o servicio esta exento de ITBIS (default true, 18%)."),
  es_mipyme: z.boolean().optional().describe("true si el oferente es MIPYME certificada."),
  descripcion_oferta: z.string().optional().describe("Descripcion breve de lo ofertado."),
  plazo_entrega_dias: z.number().int().positive().optional().describe("Plazo de entrega o ejecucion en dias calendario (default 15)."),
}).strict();

const SimuladorSchema = z.object({
  monto_referencial: z.number().positive().describe("Presupuesto estimado oficial (DOP)."),
  costo_total: z.number().positive().describe("Tu costo total de ejecucion (DOP)."),
  puntaje_tecnico_esperado: z.number().min(0).max(100).optional().describe("Puntos tecnicos que esperas obtener (default 70)."),
  peso_tecnico_max: z.number().min(0).max(100).optional().describe("Puntos maximos tecnicos segun el pliego (default 70)."),
  peso_economico_max: z.number().min(0).max(100).optional().describe("Puntos maximos economicos segun el pliego (default 30)."),
  precios_competidores: z.array(z.number().positive()).optional().describe("Precios esperados o historicos de rivales (ver dgcp_buscar_ofertas / dgcp_precios_referencia)."),
  margen_minimo_pct: z.number().min(0).max(90).optional().describe("Margen minimo aceptable en % (default 8)."),
}).strict();

export function registerPropuestasTools(server: McpServer): void {
  server.registerTool("dgcp_generador_propuesta_sncc", {
    title: "Generador de borradores de oferta (Sobre A y B)",
    description: `Genera borradores de la carta de presentacion, la declaracion jurada de no estar en el regimen de inhabilidades (Arts. 38-39 Ley 47-25), la oferta economica con ITBIS y el checklist del expediente, con los datos reales del proceso.
Ajusta las garantias y el anticipo si el oferente es MIPYME (Arts. 174-175 Ley 47-25). Usa siempre los formularios estandar que publica el pliego del proceso: esto es un borrador para completarlos.`,
    inputSchema: GeneradorSchema.shape,
    annotations: SOLO_LECTURA,
  }, seguro("Error generando el expediente", async (p: z.infer<typeof GeneradorSchema>) => {
    const proc = await dgcpListar<ProcesoReal>("procesos", { proceso: p.codigo_proceso.trim() }, { maxPaginas: 1, limite: 5 });
    const pr = proc.items[0];
    const titulo = pr?.titulo ? fixEncoding(pr.titulo).trim() : "[Objeto del procedimiento]";
    const institucion = pr?.unidad_compra ? fixEncoding(pr.unidad_compra) : "[Institucion contratante]";
    const regimen = regimenAplicable(pr?.fecha_publicacion);
    const subtotal = p.monto_ofertado_subtotal;
    const itbis = p.aplica_itbis === false ? 0 : subtotal * ITBIS;
    const total = subtotal + itbis;
    const plazo = p.plazo_entrega_dias ?? 15;
    const hoy = fechaISORD();
    const seriedadExenta = p.es_mipyme || exentaDeSeriedad(pr?.modalidad);

    const out = [
      `# Borrador de expediente de oferta`,
      `**Procedimiento:** ${p.codigo_proceso} - ${titulo}`,
      `**Institucion:** ${institucion}${pr ? ` | Cierre: ${formatFechaHoraRD(pr.fecha_fin_recepcion_ofertas)} (hora RD)` : ""}`,
      `**Regimen:** ${describirRegimen(regimen)}`,
      !pr ? "_Aviso: el proceso no aparece en la API; verifica el codigo._" : "",
      "",
      "## 1. Carta de presentacion de la oferta",
      `Santo Domingo, ${hoy}`,
      `Senores Comite de Contrataciones Publicas, ${institucion}`,
      `Ref.: Procedimiento ${p.codigo_proceso}`,
      "",
      `Quien suscribe, ${p.representante_legal}, cedula ${p.cedula_representante}, en representacion de ${p.razon_social} (RNC ${p.rnc}, RPE ${p.rpe}), presenta oferta para "${titulo}" y declara que:`,
      "1. Conoce y acepta el pliego de condiciones, sus enmiendas y circulares.",
      `2. Se compromete a entregar/ejecutar en ${plazo} dias calendario desde la firma del contrato u orden de compra.`,
      `3. El precio total ofertado es ${formatMonto(total)}${itbis > 0 ? " (ITBIS incluido)" : " (exento de ITBIS)"}.`,
      "4. Mantendra la oferta durante el plazo de vigencia exigido en el pliego.",
      "", "_____________________________", `${p.representante_legal} - ${p.razon_social}`,
      "",
      "## 2. Declaracion jurada (para notarizar si el pliego lo exige)",
      `Yo, ${p.representante_legal}, cedula ${p.cedula_representante}, en representacion de ${p.razon_social}, RNC ${p.rnc}, declaro bajo fe de juramento que:`,
      regimen === "ley_340_06"
        ? "PRIMERO: Ni la empresa ni sus socios, directivos o representantes estan afectados por las prohibiciones del Art. 14 de la Ley 340-06, aplicable a este proceso por el regimen transitorio."
        : "PRIMERO: Ni la empresa ni sus socios, directivos o representantes estan comprendidos en el regimen de inhabilidades y prohibiciones para contratar de los Arts. 38 y 39 de la Ley 47-25.",
      "SEGUNDO: La empresa no esta en quiebra, liquidacion ni concurso de acreedores, y esta al dia con sus obligaciones tributarias (DGII) y de seguridad social (TSS).",
      "TERCERO: No ha incurrido en practicas colusorias ni ha acordado precios o condiciones con otros oferentes de este procedimiento (Art. 116 Ley 47-25).",
      "CUARTO: Toda la informacion y documentacion presentada es veraz.",
      "", "_____________________________", "Firma / Notario Publico",
      "",
      "## 3. Oferta economica (Sobre B)",
      "| Item | Descripcion | Cant. | Precio unitario | ITBIS | Total |",
      "|---|---|---|---|---|---|",
      `| 1 | ${fixEncoding(p.descripcion_oferta ?? titulo).replace(/\|/g, "/")} | 1 | ${formatMonto(subtotal)} | ${formatMonto(itbis)} | ${formatMonto(total)} |`,
      "",
      `Subtotal ${formatMonto(subtotal)} + ITBIS ${formatMonto(itbis)} = **${formatMonto(total)}**. Desglosa por articulo usando la lista oficial (dgcp_inteligencia_proceso).`,
      "",
      "## 4. Garantias y condiciones",
      seriedadExenta
        ? `- Garantia de seriedad: no requerida (${p.es_mipyme ? "MIPYME, Art. 175.2 Ley 47-25" : "modalidad exenta, Art. 201 Dec. 52-26"}).`
        : `- Garantia de seriedad: 1% de la oferta = ${formatMonto(total * GARANTIAS.SERIEDAD_OFERTA_PCT)}, dentro del Sobre B (Art. 202 Dec. 52-26).`,
      `- Si resultas adjudicatario: fiel cumplimiento ${p.es_mipyme ? `1% (MIPYME) = ${formatMonto(total * GARANTIAS.FIEL_CUMPLIMIENTO_MIPYME_PCT)}` : `4% = ${formatMonto(total * GARANTIAS.FIEL_CUMPLIMIENTO_PCT)}`} en 5 dias habiles (Arts. 205-207 Dec. 52-26).`,
      p.es_mipyme ? `- Anticipo MIPYME: 30% al firmar = ${formatMonto(total * GARANTIAS.ANTICIPO_MIPYME_PCT)}, con garantia de buen uso por ese monto (Art. 174 Ley 47-25; Art. 210 Dec. 52-26). Solo pueden exigirte fianzas de aseguradoras (Art. 175.1).` : "",
      "",
      "## 5. Checklist del expediente",
      "[ ] Constancia de RPE activo y con el rubro del objeto",
      p.es_mipyme
        ? "[ ] Certificaciones de DGII y TSS (una MIPYME puede participar con atrasos de hasta 6 meses, Art. 172 P. III Ley 47-25)"
        : "[ ] Certificaciones al dia de DGII y TSS",
      p.es_mipyme ? "[ ] Certificacion MIPYME vigente del MICM" : "[ ] (Si aplica) certificacion MIPYME del MICM",
      "[ ] Registro mercantil vigente y documentos societarios",
      "[ ] Declaracion jurada firmada (y notarizada si el pliego lo pide)",
      "[ ] Oferta tecnica conforme a las especificaciones del pliego",
      "[ ] Formularios estandar del pliego completos y firmados",
      seriedadExenta ? "" : "[ ] Garantia de seriedad (1%) dentro del Sobre B",
      "[ ] Oferta economica firmada y sellada",
      "", `_${AVISO_LEGAL}_`,
    ];
    return texto(out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"));
  }));

  server.registerTool("dgcp_simulador_puntuacion", {
    title: "Simulador de precio y puntuacion economica",
    description: `Simula escenarios de precio (85% a 100% del presupuesto) con la formula de proporcionalidad inversa usada en los pliegos: puntos = (precio minimo / precio ofertado) x puntos maximos.
Muestra margen y puntaje total por escenario y recomienda el que maximiza el puntaje respetando tu margen minimo.
Para precios rivales reales usa dgcp_buscar_ofertas (ofertas de procesos similares) o dgcp_precios_referencia. Verifica siempre la formula exacta en el pliego.`,
    inputSchema: SimuladorSchema.shape,
    annotations: CALCULO_LOCAL,
  }, seguro("Error en el simulador", async (p: z.infer<typeof SimuladorSchema>) => {
    const pesoTec = p.peso_tecnico_max ?? 70;
    const pesoEcon = p.peso_economico_max ?? 30;
    const tecnico = Math.min(p.puntaje_tecnico_esperado ?? 70, pesoTec);
    const rivales = p.precios_competidores ?? [];
    const margenMin = p.margen_minimo_pct ?? 8;
    const supuesto = rivales.length === 0;
    const esc = simularEscenarios({
      referencial: p.monto_referencial,
      costo: p.costo_total,
      puntajeTecnico: tecnico,
      pesoEconomico: pesoEcon,
      preciosRivales: supuesto ? [p.monto_referencial * 0.9] : rivales,
    });
    const viables = esc.filter((e) => e.margenPct >= margenMin);
    const mejor = viables.sort((a, b) => b.puntajeTotal - a.puntajeTotal || b.margen - a.margen)[0];

    const out = [
      "# Simulacion de precio y puntuacion",
      `Presupuesto: ${formatMonto(p.monto_referencial)} | Tu costo: ${formatMonto(p.costo_total)} | Pesos: tecnico ${pesoTec}, economico ${pesoEcon} | Tecnico esperado: ${tecnico}`,
      supuesto
        ? "_Sin precios rivales: se supone que la oferta rival mas baja sera el 90% del presupuesto. Pasa precios_competidores para un resultado real._"
        : `Precio rival mas bajo: ${formatMonto(Math.min(...rivales))}`,
      "",
      "| % presupuesto | Precio | Margen | Margen % | Pts economicos | Total |",
      "|---|---|---|---|---|---|",
      ...esc.map((e) => `| ${Math.round(e.pct * 100)}% | ${formatMonto(e.precio)} | ${formatMonto(e.margen)} | ${formatPct(e.margenPct)} | ${e.puntosEconomicos.toFixed(2)} | ${e.puntajeTotal.toFixed(2)} |`),
      "",
      mejor
        ? `**Recomendacion:** ofertar ${formatMonto(mejor.precio)} (${Math.round(mejor.pct * 100)}% del presupuesto): ${mejor.puntajeTotal.toFixed(2)} puntos con margen ${formatPct(mejor.margenPct)}.`
        : `**Ningun escenario alcanza tu margen minimo de ${margenMin}%.** Con este costo no es rentable competir por precio; revisa costos o la estrategia tecnica.`,
      "",
      "_Notas: el puntaje real depende de las ofertas que se presenten y de la formula del pliego. Una oferta anormalmente baja puede ser cuestionada; justifica tu estructura de costos._",
    ];
    return texto(out.join("\n"));
  }));
}
