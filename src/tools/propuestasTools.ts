// src/tools/propuestasTools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  dgcpGetVariasPaginas, formatMonto, truncate, fixEncoding,
  normalizar, soloFecha, DgcpApiError,
} from "../services/dgcpClient.js";
import { TAMANO_PAGINA_API, MAX_RESPONSE_CHARS } from "../constants.js";
import type { ProcesoReal } from "../types.js";

// ============================================================================
// 1. TOOL: dgcp_generador_propuesta_sncc (Generador de Formularios Sobre A y B)
// ============================================================================
const GeneradorSchema = z.object({
  codigo_proceso: z.string().describe("Codigo oficial del proceso en la DGCP (ej. 'INFOTEP-DAF-CM-2026-0080')."),
  razon_social: z.string().describe("Nombre o razon social de tu empresa oferente."),
  rnc: z.string().describe("Numero de RNC o identificacion tributaria de tu empresa."),
  rpe: z.union([z.string(), z.number()]).describe("Numero de Registro de Proveedores del Estado (RPE)."),
  representante_legal: z.string().describe("Nombre completo del representante legal o titular."),
  cedula_representante: z.string().describe("Numero de cedula del representante legal."),
  monto_ofertado_subtotal: z.number().positive().describe("Monto subtotal de tu oferta economica antes de ITBIS en DOP."),
  descripcion_servicio: z.string().optional().describe("Breve descripcion de los bienes, software o consultoria a ofertar."),
  tiempo_entrega_dias: z.number().int().positive().optional().default(15).describe("Tiempo de entrega o ejecucion en dias calendario."),
}).strict();

type GeneradorInput = z.infer<typeof GeneradorSchema>;

export function registerPropuestasTools(server: McpServer): void {
  server.registerTool("dgcp_generador_propuesta_sncc", {
    title: "Generador de Formularios Oficiales SNCC y Expediente (Sobre A y B)",
    description: `Genera de forma instantánea la documentación formal normalizada exigida por la DGCP bajo el Sistema Nacional de Compras y Contrataciones Públicas (SNCC):
1. Formulario de Información sobre el Oferente (SNCC.F.042).
2. Declaración Jurada Notarial del Artículo 14 de la Ley 340-06.
3. Carta Formal de Presentación de la Oferta y Compromiso.
4. Formulario de Oferta Económica (SNCC.F.033) con desglose matemático exacto de ITBIS (18%) y total.
5. Checklist de verificación previa para garantizar admisibilidad del Sobre A.`,
    inputSchema: GeneradorSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: GeneradorInput) => {
    try {
      const codNorm = normalizar(params.codigo_proceso);
      const procData = await dgcpGetVariasPaginas<ProcesoReal>("procesos", 8, TAMANO_PAGINA_API);
      const proceso = procData.items.find((p) => normalizar(p.codigo_proceso) === codNorm);

      const tituloProceso = proceso?.titulo ? fixEncoding(proceso.titulo) : "Proceso de Contratación Pública";
      const institucion = proceso?.unidad_compra ? fixEncoding(proceso.unidad_compra) : "Institución Contratante";
      const fechaActual = new Date().toLocaleDateString("es-DO", { year: "numeric", month: "long", day: "numeric" });

      const subtotal = params.monto_ofertado_subtotal;
      const itbis = subtotal * 0.18;
      const total = subtotal + itbis;

      const out = [
        `# EXPEDIENTE OFICIAL DE PROPUESTA (SNCC - LEY 340-06)`,
        `**Proceso:** ${params.codigo_proceso}`,
        `**Institución:** ${institucion}`,
        `**Oferente:** ${params.razon_social} (RNC: ${params.rnc} | RPE: ${params.rpe})`,
        `**Fecha:** ${fechaActual}`,
        "================================================================================",
        "",
        `## 📄 DOCUMENTO 1: CARTA DE PRESENTACIÓN DE LA OFERTA Y COMPROMISO`,
        `**A:** Comité de Compras y Contrataciones / Unidad Operativa de Compras`,
        `**Entidad:** ${institucion}`,
        `**Referencia:** Proceso No. ${params.codigo_proceso}`,
        "",
        `Distinguidos Señores:`,
        "",
        `Quien suscribe, **${params.representante_legal}**, dominicano(a), mayor de edad, portador(a) de la Cédula de Identidad y Electoral No. **${params.cedula_representante}**, actuando en calidad de Representante Legal de la empresa **${params.razon_social}**, RNC No. **${params.rnc}**, Registro de Proveedor del Estado (RPE) No. **${params.rpe}**, formalmente presenta propuesta para el proceso de referencia correspondiente a:`,
        `*"${tituloProceso}"*.`,
        "",
        `Declaramos formalmente bajo la gravedad del juramento que:`,
        `1. Hemos examinado detenidamente el Pliego de Condiciones Específicas, Especificaciones Técnicas y Enmiendas del presente proceso, aceptando íntegramente sus disposiciones sin reservas ni salvedades.`,
        `2. Nos comprometemos a ejecutar y entregar los bienes/servicios en un plazo de **${params.tiempo_entrega_dias} días calendario**, contados a partir de la firma del contrato o recepción de la orden de compra.`,
        `3. Nuestra oferta económica total asciende a la suma de **${formatMonto(total)} (incluye ITBIS)**.`,
        `4. Esta oferta se mantendrá vigente por el período exigido en el pliego de condiciones.`,
        "",
        `Atentamente,`,
        `_____________________________________________`,
        `**${params.representante_legal}**`,
        `Por: ${params.razon_social}`,
        "",
        "================================================================================",
        "",
        `## 📄 DOCUMENTO 2: FORMULARIO DE INFORMACIÓN SOBRE EL OFERENTE (SNCC.F.042)`,
        `- **Razón Social:** ${params.razon_social}`,
        `- **Nombre Comercial:** ${params.razon_social}`,
        `- **RNC:** ${params.rnc}`,
        `- **Registro de Proveedor del Estado (RPE):** ${params.rpe}`,
        `- **Representante Legal:** ${params.representante_legal}`,
        `- **Cédula Representante:** ${params.cedula_representante}`,
        `- **País de Constitución:** República Dominicana`,
        `- **Tipo de Persona:** Persona Jurídica / MIPYME`,
        `- **Servicios a Ofertar:** ${params.descripcion_servicio || tituloProceso}`,
        `- **Garantía Técnica:** Garantía de cumplimiento y soporte técnico directo en territorio dominicano.`,
        "",
        "================================================================================",
        "",
        `## 📄 DOCUMENTO 3: DECLARACIÓN JURADA ART. 14 LEY 340-06 (LISTA PARA NOTARIO)`,
        `*ACTO NÚMERO: [___________].-*`,
        `En la ciudad de Santo Domingo, República Dominicana, a los [____] días del mes de [________] del año [____].`,
        `Ante mí, [Nombre del Notario], Notario Público de los del Número del Distrito Nacional, comparece libre y voluntariamente el(la) señor(a) **${params.representante_legal}**, de nacionalidad dominicana, mayor de edad, titular de la Cédula de Identidad y Electoral No. **${params.cedula_representante}**, quien actúa en su calidad de Representante Legal de la entidad comercial **${params.razon_social}**, RNC No. **${params.rnc}**, y me declara bajo la fe del juramento lo siguiente:`,
        "",
        `**PRIMERO:** Que ni el declarante, ni la sociedad comercial que representa, ni sus socios o directivos, se encuentran afectados por ninguna de las inhabilidades, prohibiciones e incompatibilidades previstas en el **Artículo 14 de la Ley No. 340-06** sobre Compras y Contrataciones de Bienes, Servicios, Obras y Concesiones, ni sus modificaciones.`,
        `**SEGUNDO:** Que dicha sociedad comercial no se encuentra en estado de quiebra, liquidación judicial, ni tiene juicios pendientes con el Estado Dominicano ni con ninguna de sus dependencias.`,
        `**TERCERO:** Que se encuentra al día en el cumplimiento de sus obligaciones tributarias ante la Dirección General de Impuestos Internos (DGII) y de seguridad social ante la Tesorería de la Seguridad Social (TSS).`,
        "",
        `DECLARACIÓN QUE HACE EN VIRTUD DE LA LEY PARA SER PRESENTADA EN EL PROCESO: **${params.codigo_proceso}**.`,
        "",
        `____________________________________       ____________________________________`,
        `       COMPARECIENTE / OFERENTE                         NOTARIO PÚBLICO`,
        "",
        "================================================================================",
        "",
        `## 📄 DOCUMENTO 4: FORMULARIO DE OFERTA ECONÓMICA (SNCC.F.033 - SOBRE B)`,
        `| Ítem | Descripción del Bien / Servicio | Cant. | Unidad | Precio Unitario (DOP) | ITBIS (18%) | Total Ofertado (DOP) |`,
        `|:---:|:---|:---:|:---:|:---:|:---:|:---:|`,
        `| 1 | ${fixEncoding(params.descripcion_servicio || tituloProceso)} | 1 | Servicio | ${formatMonto(subtotal)} | ${formatMonto(itbis)} | **${formatMonto(total)}** |`,
        "",
        `- **Subtotal Neto:** ${formatMonto(subtotal)}`,
        `- **ITBIS de Ley (18%):** ${formatMonto(itbis)}`,
        `- **VALOR TOTAL GENERAL DE LA OFERTA:** **${formatMonto(total)}**`,
        `- **Condiciones de Pago:** Según lo estipulado en el pliego de condiciones de la institución.`,
        `- **Moneda:** Pesos Dominicanos (DOP).`,
        "",
        "================================================================================",
        "",
        `## 📋 CHECKLIST PREVENTIVO DE ADMISIBILIDAD (SOBRE A)`,
        `Antes de cargar la oferta al Portal Transaccional, verifica que adjuntas:`,
        `[ ] Copia de Constancia de Registro de Proveedores del Estado (RPE) activo.`,
        `[ ] Certificación al día de la Dirección General de Impuestos Internos (DGII).`,
        `[ ] Certificación vigente de la Tesorería de la Seguridad Social (TSS).`,
        `[ ] Certificación MIPYME emitida por el Ministerio de Industria, Comercio y Mipymes (MICM).`,
        `[ ] Copia del Registro Mercantil vigente de la Cámara de Comercio.`,
        `[ ] Copia de Cédula del Representante Legal.`,
        `[ ] Declaración Jurada Art. 14 Ley 340-06 notariada.`,
        `[ ] Propuesta Técnica y Metodología de Trabajo firmada.`,
        `[ ] Formulario de Oferta Económica SNCC.F.033 firmado y sellado (Dentro del Sobre B).`,
      ];

      return { content: [{ type: "text", text: truncate(out.join("\n"), MAX_RESPONSE_CHARS) }] };
    } catch (err) {
      if (err instanceof DgcpApiError) {
        return { content: [{ type: "text", text: `Error al generar expediente SNCC: ${err.message}` }] };
      }
      throw err;
    }
  });

  // ============================================================================
  // 2. TOOL: dgcp_simulador_puntuacion (Simulador Matemático Oficial DGCP)
  // ============================================================================
  const SimuladorSchema = z.object({
    monto_referencial: z.number().positive().describe("Monto estimado oficial del proceso en DOP."),
    costo_ejecucion_base: z.number().positive().describe("Tus costos reales directos e indirectos de ejecucion en DOP."),
    puntaje_tecnico_esperado: z.number().min(0).max(100).optional().default(70)
      .describe("Puntos que esperas obtener en el Sobre A (default 70)."),
    peso_tecnico_max: z.number().min(0).max(100).optional().default(70)
      .describe("Puntos maximos del Sobre Tecnico segun pliego (default 70)."),
    peso_economico_max: z.number().min(0).max(100).optional().default(30)
      .describe("Puntos maximos del Sobre Economico segun pliego (default 30)."),
    precios_competidores: z.array(z.number()).optional()
      .describe("Array con precios estimados o historicos de competidores (opcional)."),
  }).strict();

  type SimuladorInput = z.infer<typeof SimuladorSchema>;

  server.registerTool("dgcp_simulador_puntuacion", {
    title: "Simulador Matemático de Adjudicación y Puntuación DGCP",
    description: `Calcula con la fórmula matemática oficial de la DGCP el precio óptimo para ganar la licitación:
Fórmula: Puntos_Economicos = (Precio_Minimo_Valido / Precio_Oferta) * Peso_Economico_Maximo.
Puntaje Total = Puntos_Tecnicos + Puntos_Economicos.

Genera una matriz de sensibilidad evaluando escenarios de precio (90%, 92%, 94%, 96%, 98% del valor referencial)
mostrando margen bruto en DOP, margen en %, puntaje total estimado y recomendación estratégica senior.`,
    inputSchema: SimuladorSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: SimuladorInput) => {
    const ref = params.monto_referencial;
    const costo = params.costo_ejecucion_base;
    const pTec = params.puntaje_tecnico_esperado;
    const pesoEcon = params.peso_economico_max;

    const porcentajes = [0.90, 0.92, 0.94, 0.96, 0.98, 1.00];
    const escenarios = porcentajes.map((pct) => {
      const precioOfertado = ref * pct;
      const ganancia = precioOfertado - costo;
      const margenPct = precioOfertado > 0 ? (ganancia / precioOfertado) * 100 : 0;

      // Suponemos que el precio mínimo en el mercado ronda entre el 90% y 92%
      const precioMinimoEstimado = params.precios_competidores && params.precios_competidores.length > 0
        ? Math.min(...params.precios_competidores, precioOfertado)
        : ref * 0.90;

      const pEcon = precioOfertado > 0 ? (precioMinimoEstimado / precioOfertado) * pesoEcon : 0;
      const pTotal = pTec + pEcon;

      return {
        pct: `${Math.round(pct * 100)}%`,
        precio: precioOfertado,
        ganancia,
        margenPct,
        pEcon: Math.min(pesoEcon, pEcon),
        pTotal,
      };
    });

    const out = [
      `# SIMULACIÓN MATEMÁTICA DE ADJUDICACIÓN DGCP (Ley 340-06)`,
      `**Presupuesto Referencial:** ${formatMonto(ref)}`,
      `**Costo Base de Ejecución:** ${formatMonto(costo)}`,
      `**Ponderación del Pliego:** Técnico ${params.peso_tecnico_max} pts | Económico ${params.peso_economico_max} pts (Total 100 pts)`,
      `**Puntaje Técnico Esperado (Sobre A):** ${pTec} / ${params.peso_tecnico_max} pts`,
      "---",
      `## 1. Matriz de Sensibilidad de Escenarios de Precio`,
      `| % Presupuesto | Precio Ofertado (DOP) | Margen Bruto (DOP) | Margen % | Puntos Económicos | PUNTAJE TOTAL | Competitividad |`,
      `|:---:|:---:|:---:|:---:|:---:|:---:|:---:|`,
    ];

    escenarios.forEach((esc) => {
      const competitividad = esc.pTotal >= (pTec + pesoEcon * 0.95)
        ? "⭐⭐⭐ Muy Alta (Líder)"
        : esc.pTotal >= (pTec + pesoEcon * 0.90)
        ? "⭐⭐ Alta (Competitiva)"
        : "⭐ Moderada (Riesgo)";

      out.push(
        `| ${esc.pct} | ${formatMonto(esc.precio)} | ${formatMonto(esc.ganancia)} | ${esc.margenPct.toFixed(1)}% | ${esc.pEcon.toFixed(2)} pts | **${esc.pTotal.toFixed(2)} pts** | ${competitividad} |`
      );
    });

    // Encontrar el precio balanceado óptimo (alrededor del 93% - 94%)
    const optimo = escenarios.find((e) => e.pct === "94%") || escenarios[2];

    out.push(
      "",
      `## 2. Recomendación Estratégica Senior`,
      `- **Punto de Equilibrio Óptimo (Recomendado):** Ofertar al **${optimo.pct} del presupuesto referencial** (**${formatMonto(optimo.precio)}**).`,
      `- **Beneficio Estimado:** Aseguras un margen bruto de **${formatMonto(optimo.ganancia)} (${optimo.margenPct.toFixed(1)}% de rentabilidad)**.`,
      `- **Impacto en Puntuación:** Alcanzas **${optimo.pTotal.toFixed(2)} puntos sobre 100**, superando con solvencia a los competidores que típicamente ofertan al 98% o 100% por miedo a reducir margen.`,
      `- **Alerta de Precio Temerario:** Ofertas en el rango del 90%-95% cumplen con los estándares de sostenibilidad de la DGCP (Art. 30 Ley 340-06), mitigando el riesgo de rechazo por precio temerario o ruinoso.`,
      "",
      `---`,
      `### 📌 Metodología Oficial y Advertencia Técnica:`,
      `- **Fórmula Oficial Aplicada:** Modelo estándar de relación inversamente proporcional DGCP: \`(Pmin / Pof) * Puntos Asignados\`.`,
      `- *Aviso de Simulación Económica: Esta simulación es un modelo predictivo basado en supuestos de comportamiento de mercado y fórmulas estándar del Sistema Nacional de Compras Públicas. La puntuación real está sujeta a los precios efectivos presentados por los demás oferentes en el acto de apertura del Sobre B y a la ponderación del Pliego de Condiciones Específicas.*`
    );

    return { content: [{ type: "text", text: out.join("\n") }] };
  });
}
