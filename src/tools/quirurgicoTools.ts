// src/tools/quirurgicoTools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  dgcpGetVariasPaginas, formatMonto, truncate, fixEncoding,
  normalizar, soloFecha, DgcpApiError,
} from "../services/dgcpClient.js";
import { TAMANO_PAGINA_API, MAX_RESPONSE_CHARS } from "../constants.js";
import type { ContratoReal, ProcesoReal } from "../types.js";

// ============================================================================
// 1. TOOL: dgcp_scorecard_institucion (Auditoría de Liquidez y Riesgo de Pago)
// ============================================================================
const ScorecardSchema = z.object({
  institucion: z.string().describe("Nombre o parte del nombre de la institucion a auditar (ej. 'IDAC', 'Hospital', 'MICM', 'Ayuntamiento')."),
  paginas: z.number().int().min(1).max(30).optional().default(20)
    .describe("Paginas de contratos a escanear para calcular la salud de pago (default 20 = 2,000 contratos)"),
}).strict();

type ScorecardInput = z.infer<typeof ScorecardSchema>;

export function registerQuirurgicoTools(server: McpServer): void {
  server.registerTool("dgcp_scorecard_institucion", {
    title: "Scorecard de Salud Financiera y Riesgo de Pago Institucional",
    description: `Audita quirúrgicamente el comportamiento comercial y de pago de cualquier institución del Estado:
1. Calcula los plazos reales de pago pactados (30, 60, 90 o 120 días).
2. Determina los métodos de desembolso preferidos (Transferencia Bancaria directa vs Cheque burocrático).
3. Calcula el Índice de Concentración de Proveedores (si compran a muchas empresas o si el 80% se lo llevan los mismos 2 proveedores).
4. Asigna un Rating de Solvencia Comercial (A+, A, B, C, D) y recomendaciones para mitigar asfixia financiera o factoring.`,
    inputSchema: ScorecardSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: ScorecardInput) => {
    try {
      const instNorm = normalizar(params.institucion);
      const contrData = await dgcpGetVariasPaginas<ContratoReal>("contratos", params.paginas, TAMANO_PAGINA_API);

      const contratosInst = contrData.items.filter((c) =>
        normalizar(c.unidad_compra || "").includes(instNorm)
      );

      const out: string[] = [
        `# SCORECARD QUIRÚRGICO DE SALUD FINANCIERA INSTITUCIONAL (DGCP)`,
        `**Institución Evaluada:** ${params.institucion}`,
        `**Muestra Analizada:** ${contratosInst.length} contratos recientes adjudicados`,
        "================================================================================",
      ];

      if (contratosInst.length === 0) {
        out.push(
          `No se localizaron contratos para "${params.institucion}" dentro de la muestra de ${contrData.items.length} contratos analizados.`,
          `*Sugerencia: Amplía el término de búsqueda o verifica el nombre oficial de la Unidad de Compra.*`,
        );
        return { content: [{ type: "text", text: out.join("\n") }] };
      }

      const totalMonto = contratosInst.reduce((acc, c) => acc + (typeof c.valor_contratado === "number" ? c.valor_contratado : 0), 0);
      const nombreOficial = fixEncoding(contratosInst[0].unidad_compra || params.institucion);

      // Desglose de plazos de pago
      const plazosCount = new Map<string, number>();
      const metodosCount = new Map<string, number>();
      const proveedoresCount = new Map<string, number>();

      let dias30 = 0;
      let dias60 = 0;
      let dias90Mas = 0;

      contratosInst.forEach((c) => {
        const plazo = fixEncoding(c.plazo_pago_factura || "No especificado").trim();
        const metodo = fixEncoding(c.metodo_pago || "No especificado").trim();
        const prov = fixEncoding(c.razon_social || "Anónimo").trim();

        plazosCount.set(plazo, (plazosCount.get(plazo) ?? 0) + 1);
        metodosCount.set(metodo, (metodosCount.get(metodo) ?? 0) + 1);
        proveedoresCount.set(prov, (proveedoresCount.get(prov) ?? 0) + (typeof c.valor_contratado === "number" ? c.valor_contratado : 0));

        const pNorm = normalizar(plazo);
        if (pNorm.includes("30") || pNorm.includes("15") || pNorm.includes("inmediato")) dias30++;
        else if (pNorm.includes("60") || pNorm.includes("45")) dias60++;
        else if (pNorm.includes("90") || pNorm.includes("120")) dias90Mas++;
        else dias60++; // default conservador
      });

      // Calificación de Rating
      const pct30 = (dias30 / contratosInst.length) * 100;
      const pct90 = (dias90Mas / contratosInst.length) * 100;
      const tieneTransferencia = Array.from(metodosCount.keys()).some((m) => normalizar(m).includes("transferencia"));

      let rating = "B (Riesgo Moderado)";
      let recomendacionFinanciera = "";

      if (pct30 >= 60 && tieneTransferencia) {
        rating = "🟢 A+ (Solvencia Óptima / Pago Rápido)";
        recomendacionFinanciera = "Institución de alta confiabilidad. Ideal para MIPYMES con bajo capital; paga a tiempo vía transferencia sin necesidad de factoring costoso.";
      } else if (pct90 >= 30) {
        rating = "🔴 C (Riesgo Alto de Ilíquidez / Pago Lento)";
        recomendacionFinanciera = "ALERTA: Esta institución dilata pagos a 90 o 120 días. Si ofertas, DEBES incorporar el costo financiero del dinero (5% a 8%) en tu Sobre B o prever una línea de factoring.";
      } else {
        rating = "🟡 B+ (Riesgo Controlado / 45-60 Días)";
        recomendacionFinanciera = "Comportamiento estándar de la administración pública. Flujo predecible a 60 días. Requiere colchón de liquidez básico.";
      }

      out.push(
        `## 1. Dictamen de Calificación Crediticia`,
        `- **Nombre Oficial en Portal:** ${nombreOficial}`,
        `- **Calificación Asignada:** **${rating}**`,
        `- **Volumen Adjudicado Muestreado:** ${formatMonto(totalMonto)} (${contratosInst.length} contratos)`,
        `- **Ticket Promedio por Contrato:** ${formatMonto(totalMonto / contratosInst.length)}`,
        `- **Recomendación Estratégica:** ${recomendacionFinanciera}`,
        "",
        `## 2. Anatomía de Tiempos y Métodos de Desembolso`,
        `- **Pagos Ágiles (≤ 30 días):** ${dias30} contratos (${pct30.toFixed(1)}%)`,
        `- **Pagos Medios (45 a 60 días):** ${dias60} contratos (${((dias60 / contratosInst.length) * 100).toFixed(1)}%)`,
        `- **Pagos Lentos (≥ 90 días):** ${dias90Mas} contratos (${pct90.toFixed(1)}%)`,
        "",
        `### Métodos de Pago Empleados:`,
      );

      metodosCount.forEach((cant, met) => {
        out.push(`   - **${met}:** ${cant} contratos (${((cant / contratosInst.length) * 100).toFixed(1)}%)`);
      });

      out.push("", `## 3. Índice de Apertura vs. Concentración de Proveedores`);
      const provsOrdenados = Array.from(proveedoresCount.entries()).sort((a, b) => b[1] - a[1]);
      const top3Monto = provsOrdenados.slice(0, 3).reduce((acc, p) => acc + p[1], 0);
      const pctConcentracion = totalMonto > 0 ? (top3Monto / totalMonto) * 100 : 0;

      out.push(
        `- **Total de Proveedores Distintos Contratados:** ${proveedoresCount.size}`,
        `- **Concentración en los 3 Mayores Suplidores:** ${pctConcentracion.toFixed(1)}% del presupuesto muestreado.`,
        pctConcentracion > 65
          ? `  *(⚠️ ALERTA: Alta concentración de adjudicaciones en pocos proveedores. Requiere propuesta agresiva en precio para romper la inercia).*`
          : `  *(✅ ENTORNO COMPETITIVO: La institución diversifica sus compras y da apertura real a nuevos oferentes).*`,
        "",
        `### Top 3 Suplidores con Mayor Facturación en la Entidad:`,
      );

      provsOrdenados.slice(0, 3).forEach(([prov, monto], i) => {
        out.push(`   ${i + 1}. **${prov}:** ${formatMonto(monto)} (${totalMonto > 0 ? ((monto / totalMonto) * 100).toFixed(1) : 0}%)`);
      });

      return { content: [{ type: "text", text: truncate(out.join("\n"), MAX_RESPONSE_CHARS) }] };
    } catch (err) {
      if (err instanceof DgcpApiError) {
        return { content: [{ type: "text", text: `Error en scorecard institucional: ${err.message}` }] };
      }
      throw err;
    }
  });

  // ============================================================================
  // 2. TOOL: dgcp_auditor_pliego_trampa (Detección de Pliegos "Traje a la Medida")
  // ============================================================================
  const TrampaSchema = z.object({
    codigo_proceso: z.string().describe("Codigo oficial del proceso en la DGCP (ej. 'MICM-CCC-LPN-2026-0007')."),
    extracto_pliego: z.string().optional()
      .describe("Texto, clausula o requerimiento del pliego de condiciones que sospechas que esta amarrado o dirigido."),
  }).strict();

  type TrampaInput = z.infer<typeof TrampaSchema>;

  server.registerTool("dgcp_auditor_pliego_trampa", {
    title: "Auditor Forense de Pliegos: Detección de Cláusulas Trampa y Amarres",
    description: `Analiza si un pliego de condiciones contiene especificaciones ilegales o dirigidas a un único proveedor:
1. Detecta violación al Artículo 21 de la Ley 340-06 (inclusión de marcas o patentes sin la frase "o su equivalente técnico").
2. Detecta exigencias desproporcionadas de experiencia que violan el Principio de Razonabilidad (Art. 3 Ley 340-06).
3. Identifica subcriterios subjetivos ("a satisfacción del perito") prohibidos por la DGCP.
4. Redacta de forma automática la Solicitud Formal de Aclaración y Enmienda de Pliego para obligar a la institución a abrir la competencia.`,
    inputSchema: TrampaSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: TrampaInput) => {
    try {
      const codNorm = normalizar(params.codigo_proceso);
      const procData = await dgcpGetVariasPaginas<ProcesoReal>("procesos", 8, TAMANO_PAGINA_API);
      const proceso = procData.items.find((p) => normalizar(p.codigo_proceso) === codNorm);

      const textoAuditado = (params.extracto_pliego || "") + " " + (proceso?.descripcion || "") + " " + (proceso?.titulo || "");
      const textoNorm = normalizar(textoAuditado);

      const hallazgos: string[] = [];

      // Banderas de auditoría
      const marcasConocidas = ["cisco", "fortinet", "palo alto", "microsoft", "oracle", "dell", "hp", "lenovo", "xerox", "epson"];
      const marcasDetectadas = marcasConocidas.filter((m) => textoNorm.includes(m));

      if (marcasDetectadas.length > 0) {
        const tieneEquivalente = textoNorm.includes("equivalente") || textoNorm.includes("o similar");
        if (!tieneEquivalente) {
          hallazgos.push(
            `🚩 **VIOLACIÓN DIRECTA AL ARTÍCULO 21 LEY 340-06:** Se detectó la mención explícita de marcas comerciales (**${marcasDetectadas.join(", ").toUpperCase()}**) SIN la cláusula obligatoria *"o su equivalente funcional/técnico"*. Esto constituye causal de impugnación por direccionamiento ilícito.`
          );
        } else {
          hallazgos.push(
            `ℹ️ **Mención de Marca con Salvedad Legal:** Se mencionan marcas (${marcasDetectadas.join(", ").toUpperCase()}), pero se incluyó la salvedad de equivalencia. Se debe verificar que las especificaciones no sean exclusivas de esa arquitectura.`
          );
        }
      }

      if (textoNorm.includes("a juicio de") || textoNorm.includes("a discrecion") || textoNorm.includes("a criterio del perito")) {
        hallazgos.push(
          `🚩 **CRITERIO SUBJETIVO DISCRECIONAL (PROHIBIDO):** Se detectaron frases de ponderación subjetiva. La DGCP prohíbe puntajes basados en apreciaciones personales no cuantificables matemáticamente.`
        );
      }

      if (textoNorm.includes("certificacion de distribuidor exclusivo") || textoNorm.includes("carta de exclusividad")) {
        hallazgos.push(
          `🚩 **BARRERA ARTIFICIAL DE ENTRADA:** La exigencia de exclusividad en un proceso ordinario bloquea la libre concurrencia (Art. 3 Ley 340-06). Solo se admite en Contratación Directa por Proveedor Único justificada técnicamente.`
        );
      }

      const out = [
        `# AUDITORÍA QUIRÚRGICA DE PLIEGO DE CONDICIONES (LEY 340-06)`,
        `**Proceso:** ${params.codigo_proceso}`,
        `**Institución:** ${proceso?.unidad_compra ? fixEncoding(proceso.unidad_compra) : "Institución Contratante"}`,
        `**Objeto:** ${proceso?.titulo ? fixEncoding(proceso.titulo) : "Proceso de Licitación"}`,
        "================================================================================",
        "",
        `## 1. Diagnóstico de Legalidad y Banderas Rojas`,
      ];

      if (hallazgos.length > 0) {
        hallazgos.forEach((h) => out.push(h, ""));
      } else {
        out.push(
          `✅ **Pliego Aparentemente Conforme:** No se detectaron patrones típicos de amarre en la descripción general.`,
          `- Si tienes una cláusula puntual del documento PDF que consideres restrictiva, ingrésala en el parámetro 'extracto_pliego' para emitir dictamen específico.`,
          "",
        );
      }

      out.push(
        `## 2. Minuta Legal de Solicitud de Aclaración y Enmienda (Lista para someter)`,
        `*Esta solicitud debe cargarse en la sección "Consultas y Respuestas" del Portal Transaccional antes de que venza el período de aclaraciones:*`,
        "",
        `**A:** Comité de Compras y Contrataciones`,
        `**Referencia:** Proceso No. ${params.codigo_proceso}`,
        `**Asunto:** Solicitud de aclaración y enmienda técnica en virtud de los Artículos 3 y 21 de la Ley 340-06`,
        "",
        `Distinguidos Miembros del Comité:`,
        `En atención al principio de **Libre Competencia, Igualdad y Participación** consagrado en el Artículo 3 de la Ley No. 340-06, solicitamos formalmente aclarar y enmendar las especificaciones técnicas del presente proceso:`,
        "",
        `1. Solicitar la confirmación expresa de que, de conformidad con el **Artículo 21 de la Ley 340-06**, serán admitidas todas aquellas propuestas que ofrezcan bienes o soluciones de tecnología que cumplan con la **equivalencia funcional y técnica**, sin que la mención de marcas comerciales de referencia constituya una causal de exclusión o descalificación.`,
        `2. Enmendar cualquier cláusula restrictiva que limite la participación de canales autorizados independientes o MIPYMES acreditadas en el RPE.`,
        "",
        `Agradeciendo de antemano su pronta atención en pro de la transparencia de las compras públicas.`,
      );

      return { content: [{ type: "text", text: truncate(out.join("\n"), MAX_RESPONSE_CHARS) }] };
    } catch (err) {
      if (err instanceof DgcpApiError) {
        return { content: [{ type: "text", text: `Error al auditar pliego: ${err.message}` }] };
      }
      throw err;
    }
  });

  // ============================================================================
  // 3. TOOL: dgcp_generador_recurso_impugnacion (Defensa Jurídica ante la DGCP)
  // ============================================================================
  const RecursoSchema = z.object({
    codigo_proceso: z.string().describe("Codigo oficial del proceso licitado."),
    acto_atacado: z.string().describe("Acto que se impugna (ej. 'Acta de Adjudicación No. XX', 'Pliego de Condiciones', 'Acta de Descalificación Técnica')."),
    motivo_agravio: z.string().describe("Causal de violación (ej. 'Descalificación arbitraria habiendo cumplido ficha técnica', 'Adjudicación a empresa con precio superior sin justificación', 'Colusión demostrada entre oferentes')."),
    empresa_recurrente: z.string().describe("Nombre de tu empresa que somete el recurso."),
    rnc_recurrente: z.string().describe("RNC de tu empresa."),
    representante: z.string().describe("Nombre del representante legal."),
  }).strict();

  type RecursoInput = z.infer<typeof RecursoSchema>;

  server.registerTool("dgcp_generador_recurso_impugnacion", {
    title: "Generador de Recurso de Impugnación y Medida Cautelar ante la DGCP",
    description: `Redacta un Recurso Jerárquico formal con Solicitud de Medida Cautelar de Suspensión de Oficio ante la DGCP:
1. Fundamentado en la Ley 340-06, Decreto 543-12, Ley 107-13 sobre Procedimiento Administrativo y jurisprudencia del TSA.
2. Contiene estructura jurídica formal de tribunal: Calidad, Hechos, Derecho, Agravios y Petitorio formal.
3. Solicita la suspensión inmediata del proceso o contrato para evitar la consumación de daños irreparables.`,
    inputSchema: RecursoSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: RecursoInput) => {
    const fecha = new Date().toLocaleDateString("es-DO", { year: "numeric", month: "long", day: "numeric" });

    const out = [
      `# RECURSO FORMAL DE IMPUGNACIÓN Y SOLICITUD DE MEDIDA CAUTELAR (DGCP)`,
      `**Sometido por:** ${params.empresa_recurrente} (RNC: ${params.rnc_recurrente})`,
      `**Proceso Afectado:** ${params.codigo_proceso}`,
      `**Acto Impugnado:** ${params.acto_atacado}`,
      `**Fecha:** ${fecha}`,
      "================================================================================",
      "",
      `**AL:** Director General de la Dirección General de Contrataciones Públicas (DGCP)`,
      `**Y AL:** Comité de Compras y Contrataciones de la Institución Convocante`,
      "",
      `**ASUNTO:** FORMAL RECURSO ADMINISTRATIVO DE IMPUGNACIÓN CONTRA ${params.acto_atacado.toUpperCase()} Y SOLICITUD DE MEDIDA CAUTELAR DE SUSPENSIÓN DE OFICIO DEL PROCESO No. ${params.codigo_proceso}.`,
      "",
      `**RECURRENTE:** La sociedad comercial **${params.empresa_recurrente}**, RNC No. **${params.rnc_recurrente}**, representada por su Representante Legal, **${params.representante}**.`,
      "",
      `Distinguidas Autoridades:`,
      "",
      `### I. DE LA CALIDAD Y EL PLAZO LEGAL`,
      `La recurrente ostenta calidad jurídica plena en virtud de su condición de oferente formal debidamente inscrito en el Registro de Proveedores del Estado (RPE) y participante habilitado en el proceso de referencia. El presente recurso se interpone dentro del plazo legal improrrogable establecido por el **Artículo 67 de la Ley No. 340-06** y los plazos de la **Ley No. 107-13** sobre los Derechos de las Personas en sus Relaciones con la Administración.`,
      "",
      `### II. RELACIÓN DE LOS HECHOS Y AGRAVIOS`,
      `1. En fecha reciente, la entidad contratante emitió el acto administrativo consistente en **"${params.acto_atacado}"**, mediante el cual se lesionan los derechos e intereses legítimos de nuestra representada.`,
      `2. **MOTIVO ESPECÍFICO DEL AGRAVIO:** ${params.motivo_agravio}.`,
      `3. Dicha decisión transgrede de manera flagrante los principios rectores de **Igualdad, Libre Competencia, Transparencia y Debido Proceso Administrativo** contemplados en el Artículo 3 de la Ley 340-06, así como la debida motivación que exige el Artículo 3 de la Ley 107-13.`,
      "",
      `### III. PETITORIO DE MEDIDA CAUTELAR (SUSPENSIÓN INMEDIATA)`,
      `Existe un evidente *Fumus Boni Iuris* (apariencia de buen derecho) y un manifiesto *Periculum in Mora* (peligro en la demora), toda vez que de continuarse con la firma o ejecución del contrato derivado de este acto viciado, se consumaría un daño irreparable tanto al patrimonio público como a los derechos adquiridos de la recurrente.`,
      "",
      `**POR TALES MOTIVOS**, y los que oportunamente se expondrán, solicitamos muy respetuosamente:`,
      "",
      `**PRIMERO:** Declarar **BUENO Y VÁLIDO**, en cuanto a la forma, el presente Recurso de Impugnación por haber sido interpuesto en tiempo hábil y con apego a las disposiciones de la Ley No. 340-06 y la Ley No. 107-13.`,
      `**SEGUNDO:** Ordenar como **MEDIDA CAUTELAR DE URGENCIA** la **SUSPENSIÓN INMEDIATA** de todos los efectos jurídicos del proceso No. **${params.codigo_proceso}**, absteniéndose la institución de suscribir contrato o librar órdenes de pago hasta tanto la DGCP emita su resolución definitiva.`,
      `**TERCERO:** En cuanto al fondo, **REVOCAR Y ANULAR** en todas sus partes el acto consistente en **"${params.acto_atacado}"**, ordenando la reevaluación objetiva de las propuestas conforme a derecho y adjudicando a quien en estricta justicia corresponda.`,
      "",
      `BAJO LAS MÁS AMPLIAS RESERVAS DE DERECHO Y ACCIÓN.`,
      "",
      `___________________________________________________________`,
      `**${params.representante}**`,
      `Por: **${params.empresa_recurrente}**`,
      "",
      `---`,
      `*Aviso de Responsabilidad Legal: Este documento es una minuta preliminar generada por una herramienta de asistencia técnica. Conforme a la legislación procesal dominicana y la Ley 91 sobre el Colegio de Abogados, todo recurso administrativo ante la DGCP o el Tribunal Superior Administrativo (TSA) debe ser revisado, validado y rubricado por un profesional del derecho autorizado.*`
    ];

    return { content: [{ type: "text", text: truncate(out.join("\n"), MAX_RESPONSE_CHARS) }] };
  });
}
