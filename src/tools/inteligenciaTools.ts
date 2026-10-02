// src/tools/inteligenciaTools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  dgcpGetVariasPaginas, formatMonto, truncate, fixEncoding,
  soloFecha, diasHasta, sigueAbierto, normalizar, limpiarRNC, DgcpApiError,
} from "../services/dgcpClient.js";
import {
  MAX_RESPONSE_CHARS, TAMANO_PAGINA_API,
  UMBRALES_BIENES_SERVICIOS, UMBRALES_OBRAS,
  GARANTIA_SERIEDAD_OFERTA_PCT, GARANTIA_FIEL_CUMPLIMIENTO_PCT,
  GARANTIA_FIEL_CUMPLIMIENTO_MIPYME_PCT, ANTICIPO_MAXIMO_PCT,
} from "../constants.js";
import type { ProcesoReal, ContratoReal, OfertaReal, ProveedorReal } from "../types.js";

// ============================================================================
// 1. TOOL: dgcp_inteligencia_proceso (Análisis 360° de Licitación)
// ============================================================================
const InteligenciaSchema = z.object({
  codigo_proceso: z.string().describe("Codigo oficial del proceso (ej. 'TSS-DAF-CM-2026-0055' o 'HLA-DAF-CD-2026-0121')."),
  paginas_historial: z.number().int().min(1).max(25).optional()
    .describe("Paginas a escanear en contratos y ofertas para buscar antecedentes (default 12 = 1,200 registros)"),
}).strict();

type InteligenciaInput = z.infer<typeof InteligenciaSchema>;

export function registerInteligenciaTools(server: McpServer): void {
  // HERRAMIENTA 1: Inteligencia 360° de una Licitación
  server.registerTool("dgcp_inteligencia_proceso", {
    title: "Inteligencia 360° de Proceso: Quién ganó antes y Estrategia",
    description: `Realiza un análisis integral 360° de una licitación pública en la DGCP:
1. Extrae la ficha técnica del proceso (monto, vigencia, modalidad, reservas MIPYME).
2. Busca automáticamente antecedentes de contratación en esa misma institución y objeto contractual ("¿Quién ganó antes?").
3. Detecta ofertas y precios de referencia de competidores.
4. Calcula automáticamente las garantías legales obligatorias (Seriedad 1%, Fiel Cumplimiento 4% o 1% MIPYME, Anticipo 20%).
5. Genera la hoja de ruta y estrategia legal ganadora bajo la Ley 340-06.`,
    inputSchema: InteligenciaSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: InteligenciaInput) => {
    try {
      const codBuscado = params.codigo_proceso.trim();
      const codNorm = normalizar(codBuscado);
      const paginasHistorial = params.paginas_historial ?? 12;

      // 1. Buscar proceso objetivo
      const procData = await dgcpGetVariasPaginas<ProcesoReal>("procesos", 8, TAMANO_PAGINA_API);
      const proceso = procData.items.find((p) => normalizar(p.codigo_proceso) === codNorm);

      let unidadCompra = "";
      let tituloProceso = "";
      let montoEstimado = 0;
      let modalidad = "";
      let diasRestantes: number | null = null;
      let urlPortal = "";
      let esMipyme = false;

      const out: string[] = [];

      if (proceso) {
        unidadCompra = proceso.unidad_compra ?? "";
        tituloProceso = proceso.titulo ?? "";
        montoEstimado = typeof proceso.monto_estimado === "number" ? proceso.monto_estimado : 0;
        modalidad = proceso.modalidad ?? "";
        diasRestantes = diasHasta(proceso.fecha_fin_recepcion_ofertas);
        urlPortal = proceso.url ?? "";
        esMipyme = proceso.dirigido_mipymes === "Si";

        out.push(
          `# INFORME DE INTELIGENCIA ESTRATÉGICA DGCP (Ley 340-06)`,
          `**Proceso:** ${codBuscado}`,
          `**Objeto:** ${fixEncoding(tituloProceso)}`,
          `**Institución:** ${fixEncoding(unidadCompra)}`,
          `**Modalidad:** ${fixEncoding(modalidad)}`,
          `**Presupuesto Estimado:** ${formatMonto(montoEstimado, proceso.divisa ?? "DOP")}`,
          `**Cierre de Ofertas:** ${soloFecha(proceso.fecha_fin_recepcion_ofertas)} (${diasRestantes !== null && diasRestantes >= 0 ? `Quedan ${diasRestantes} días` : "PLAZO VENCIDO"})`,
          `**Reserva MIPYME:** ${esMipyme ? "SÍ (Exclusivo MIPYMES conforme a Ley 488-08 y Dec. 416-23)" : "NO (Abierto nacional/general)"}`,
          urlPortal ? `**Portal Transaccional:** ${urlPortal}` : "",
          "---",
        );
      } else {
        out.push(
          `# INFORME DE INTELIGENCIA DGCP - Búsqueda Directa por Código: ${codBuscado}`,
          `*Aviso: El proceso no apareció en los últimos ${procData.items.length} procesos activos de la DGCP. Se auditarán contratos y ofertas con ese código o institución.*`,
          "---",
        );
      }

      // 2. Buscar Contratos Anteriores de esa institución o para ese proceso
      const contratosData = await dgcpGetVariasPaginas<ContratoReal>("contratos", paginasHistorial, TAMANO_PAGINA_API);
      const contratosDirectos = contratosData.items.filter((c) => normalizar(c.codigo_proceso) === codNorm);
      
      const uNorm = normalizar(unidadCompra);
      const contratosInstitucion = contratosData.items.filter((c) =>
        uNorm.length > 3 && normalizar(c.unidad_compra).includes(uNorm)
      );

      out.push(`## 1. Antecedentes de Adjudicación e Historial ("¿Quién ganó antes?")`);

      if (contratosDirectos.length > 0) {
        out.push(`Se encontraron **${contratosDirectos.length} contrato(s) adjudicado(s)** directamente para este código de proceso:`);
        contratosDirectos.forEach((c, idx) => {
          out.push(
            `   ${idx + 1}. **${fixEncoding(c.razon_social)}** (RPE: ${c.rpe ?? "N/D"})`,
            `      - Contrato: ${c.codigo_contrato ?? "N/D"} | Monto Adjudicado: ${formatMonto(c.valor_contratado, c.divisa ?? "DOP")}`,
            `      - Estado: ${c.estado_contrato} | Adjudicación: ${c.estado_adjudicacion}`,
            `      - Condiciones: ${fixEncoding(c.metodo_pago ?? "N/D")} (Plazo: ${fixEncoding(c.plazo_pago_factura ?? "N/D")})`,
            c.url_contrato ? `      - Enlace Contrato: ${c.url_contrato}` : "",
          );
        });
      } else if (contratosInstitucion.length > 0) {
        out.push(`No hay contrato adjudicado aún para este proceso puntual, pero se auditaron **${contratosInstitucion.length} contratos recientes adjudicados por ${fixEncoding(unidadCompra)}**:`);
        contratosInstitucion.slice(0, 4).forEach((c, idx) => {
          out.push(
            `   ${idx + 1}. **${fixEncoding(c.descripcion?.trim() || c.codigo_contrato)}**`,
            `      - Ganador: **${fixEncoding(c.razon_social)}** (RPE: ${c.rpe ?? "N/D"})`,
            `      - Monto: ${formatMonto(c.valor_contratado, c.divisa ?? "DOP")} | Fecha: ${soloFecha(c.fecha_adjudicacion)}`,
            `      - Plazo de Pago: ${fixEncoding(c.plazo_pago_factura ?? "N/D")} vía ${fixEncoding(c.metodo_pago ?? "N/D")}`,
          );
        });
      } else {
        out.push(`No se encontraron contratos registrados para esta institución dentro de los ${contratosData.items.length} contratos más recientes de la DGCP.`);
      }

      // 3. Buscar Ofertas de Competidores
      const ofertasData = await dgcpGetVariasPaginas<OfertaReal>("ofertas", paginasHistorial, TAMANO_PAGINA_API);
      const ofertasDirectas = ofertasData.items.filter((o) => normalizar(o.codigo_proceso) === codNorm);
      const ofertasInstitucion = ofertasData.items.filter((o) =>
        uNorm.length > 3 && normalizar(o.unidad_compra).includes(uNorm)
      );

      out.push("", `## 2. Auditoría de Competidores y Ofertas Presentadas`);

      if (ofertasDirectas.length > 0) {
        out.push(`Ofertas recibidas específicamente en este proceso (${ofertasDirectas.length} ofertas):`);
        ofertasDirectas.forEach((o, idx) => {
          out.push(
            `   ${idx + 1}. **${fixEncoding(o.razon_social)}** (RPE: ${o.rpe ?? "N/D"})`,
            `      - Valor Ofertado: ${formatMonto(o.valor_oferta, "DOP")}`,
            `      - Tipo de Oferta: ${fixEncoding(o.tipo_oferta)} | Estado Evaluación: ${fixEncoding(o.estado_evaluacion)}`,
          );
        });
      } else if (ofertasInstitucion.length > 0) {
        out.push(`Oferentes habituales que cotizan a ${fixEncoding(unidadCompra)} en procesos recientes:`);
        const vistos = new Set<string>();
        let count = 0;
        for (const o of ofertasInstitucion) {
          const prov = fixEncoding(o.razon_social);
          if (!vistos.has(prov) && count < 4) {
            vistos.add(prov);
            count++;
            out.push(`   - **${prov}** (RPE: ${o.rpe ?? "N/D"}) | Última oferta registrada: ${formatMonto(o.valor_oferta, "DOP")} (${soloFecha(o.fecha_creacion)})`);
          }
        }
      } else {
        out.push(`No se detectaron ofertas en la muestra para esta institución.`);
      }

      // 4. Cálculo Normativo de Garantías (Ley 340-06)
      if (montoEstimado > 0) {
        const garantiaSeriedad = montoEstimado * GARANTIA_SERIEDAD_OFERTA_PCT;
        const garantiaFielCumplimientoGen = montoEstimado * GARANTIA_FIEL_CUMPLIMIENTO_PCT;
        const garantiaFielCumplimientoMipyme = montoEstimado * GARANTIA_FIEL_CUMPLIMIENTO_MIPYME_PCT;
        const anticipoMax = montoEstimado * ANTICIPO_MAXIMO_PCT;

        out.push(
          "",
          `## 3. Matriz Financiera y Garantías Obligatorias (Ley 340-06 y Dec. 416-23)`,
          `- **Póliza de Garantía de Seriedad de la Oferta (1%):** **${formatMonto(garantiaSeriedad)}**`,
          `  *(Obligatoria para Licitación Pública y Comparación de Precios. Emitida por aseguradora regulada por la Superintendencia de Seguros).*`,
          `- **Garantía de Fiel Cumplimiento de Contrato (4% General):** **${formatMonto(garantiaFielCumplimientoGen)}**`,
          `- **Garantía de Fiel Cumplimiento Especial MIPYME (1% Dec. 416-23):** **${formatMonto(garantiaFielCumplimientoMipyme)}** *(Ahorro del 75% en costo de póliza si estás certificado MICM)*`,
          `- **Anticipo Máximo Legal (20%):** Hasta **${formatMonto(anticipoMax)}**`,
        );
      }

      // 5. Estrategia Ganadora
      out.push(
        "",
        `## 4. Estrategia Senior y Hoja de Ruta para Ganar la Licitación`,
        `1. **Sobre A (Blindaje Habilitante Inflexible):**`,
        `   - **RPE:** Certificado activo y con rubro específico para este objeto.`,
        `   - **DGII:** Certificación emitida en el mes en curso (cero deudas fiscales).`,
        `   - **TSS:** Certificación vigente sin atrasos de pago de nómina.`,
        `   - **Garantía de Seriedad:** Presentar el original de la póliza por el 1% exacto con vigencia mínima requerida en pliego (usualmente 60 a 90 días).`,
        `   - **Declaración Jurada Notarial:** Art. 14 de Ley 340-06 firmada y legalizada.`,
        `2. **Propuesta Técnica:**`,
        `   - Cumplir literal y estrictamente las Fichas Técnicas sin condicionamientos. Si es tecnología, adjuntar Carta de Autorización del Fabricante (MAF).`,
        `3. **Sobre B (Estrategia Económica):**`,
        `   - Ajustar el precio unitario considerando plazos de pago y retenciones estatales (5% IESP / ITBIS).`,
        `   - Rango competitivo recomendado: entre el 92% y 96% del presupuesto oficial estimado para liderar en puntuación económica.`,
      );

      return { content: [{ type: "text", text: truncate(out.join("\n"), MAX_RESPONSE_CHARS) }] };
    } catch (err) {
      if (err instanceof DgcpApiError) {
        return { content: [{ type: "text", text: `Error en análisis de inteligencia: ${err.message}` }] };
      }
      throw err;
    }
  });

  // HERRAMIENTA 2: Radiografía Completa de un Proveedor / Competidor
  const RadiografiaSchema = z.object({
    termino: z.string().describe("Nombre de la empresa, RNC (con o sin guiones) o número de RPE a auditar."),
    paginas: z.number().int().min(1).max(25).optional()
      .describe("Páginas de contratos a escanear para auditoría de facturación estatal (default 15 = 1,500 contratos)"),
  }).strict();

  type RadiografiaInput = z.infer<typeof RadiografiaSchema>;

  server.registerTool("dgcp_radiografia_proveedor", {
    title: "Radiografía de Proveedor: RPE, Contratos Ganados y Cuota de Mercado",
    description: `Audita integralmente a un proveedor o competidor en las contrataciones públicas:
1. Verifica su ficha en el RPE: RNC, estatus (Activo/Inactivo), clasificación MIPYME, fecha de registro y contactos.
2. Calcula su volumen total de contratos ganados en el Estado en la muestra reciente.
3. Identifica sus clientes principales en el sector público (a qué instituciones les vende más).
4. Analiza sus márgenes y presencia en licitaciones del gobierno dominicano.`,
    inputSchema: RadiografiaSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: RadiografiaInput) => {
    try {
      const termRaw = params.termino.trim();
      const termNorm = normalizar(termRaw);
      const termRnc = limpiarRNC(termRaw);
      const paginas = params.paginas ?? 15;

      // 1. Buscar en proveedores (RPE)
      const provData = await dgcpGetVariasPaginas<ProveedorReal>("proveedores", 10, TAMANO_PAGINA_API);
      const proveedor = provData.items.find((p) => {
        const rncP = limpiarRNC(p.numero_documento);
        const rpeP = String(p.rpe ?? "");
        const nombreP = normalizar(p.razon_social);
        return (termRnc.length > 0 && rncP === termRnc) ||
               rpeP === termRaw ||
               nombreP.includes(termNorm);
      });

      // 2. Buscar contratos ganados por este proveedor
      const contrData = await dgcpGetVariasPaginas<ContratoReal>("contratos", paginas, TAMANO_PAGINA_API);
      const provRpe = proveedor?.rpe ? String(proveedor.rpe) : termRaw;
      const provNombre = proveedor?.razon_social ? normalizar(proveedor.razon_social) : termNorm;

      const contratosGanados = contrData.items.filter((c) => {
        const cRpe = String(c.rpe ?? "").trim();
        const cNombre = normalizar(c.razon_social);
        return (cRpe.length > 0 && cRpe === provRpe) || cNombre.includes(provNombre);
      });

      const out: string[] = [
        `# RADIOGRAFÍA Y AUDITORÍA DE PROVEEDOR DGCP`,
        `**Término Consultado:** ${termRaw}`,
        "---",
      ];

      if (proveedor) {
        out.push(
          `## 1. Ficha del Registro de Proveedores del Estado (RPE)`,
          `- **Razón Social:** ${fixEncoding(proveedor.razon_social)}`,
          `- **RPE:** ${proveedor.rpe ?? "N/D"} | **${proveedor.tipo_documento ?? "RNC"}:** ${proveedor.numero_documento ?? "N/D"}`,
          `- **Estatus Jurídico:** ${fixEncoding(proveedor.estado)} | Tipo: ${fixEncoding(proveedor.tipo_persona)} (${fixEncoding(proveedor.forma_juridica)})`,
          `- **Clasificación MIPYME:** ${proveedor.es_mipyme === "Si" ? "SÍ (Acreditado)" : "NO"}${proveedor.certificacion_micm === "Si" ? " | Certificación MICM Activa" : ""}`,
          `- **Rubro Registrado:** ${fixEncoding(proveedor.provee)}`,
          `- **Ubicación:** ${fixEncoding(proveedor.provincia ?? "N/D")}, ${fixEncoding(proveedor.municipio ?? "")}`,
          proveedor.direccion ? `- **Dirección:** ${fixEncoding(proveedor.direccion)}` : "",
          proveedor.contacto ? `- **Contacto Principal:** ${fixEncoding(proveedor.contacto).trim()} (${fixEncoding(proveedor.posicion_contacto ?? "Representante")}) | Tel: ${proveedor.telefono_comercial ?? "N/D"} | Email: ${proveedor.correo_comercial ?? "N/D"}` : "",
          proveedor.url_certificacion ? `- **Certificación Oficial RPE:** ${proveedor.url_certificacion}` : "",
          "",
        );
      } else {
        out.push(`*Aviso: No se localizó en la muestra reciente de RPE. Se auditarán sus contratos en el Estado.*`, "");
      }

      out.push(`## 2. Desempeño y Contratos Adjudicados en el Estado`);

      if (contratosGanados.length > 0) {
        const totalFacturado = contratosGanados.reduce((acc, c) => acc + (typeof c.valor_contratado === "number" ? c.valor_contratado : 0), 0);
        
        // Agrupar por institución
        const porInstitucion = new Map<string, number>();
        contratosGanados.forEach((c) => {
          const inst = fixEncoding(c.unidad_compra) || "Otras";
          porInstitucion.set(inst, (porInstitucion.get(inst) ?? 0) + (typeof c.valor_contratado === "number" ? c.valor_contratado : 0));
        });

        out.push(
          `- **Total de Contratos Ganados (Muestra):** ${contratosGanados.length} contratos`,
          `- **Monto Total Facturado al Estado:** **${formatMonto(totalFacturado)}**`,
          `- **Promedio por Contrato:** **${formatMonto(totalFacturado / contratosGanados.length)}**`,
          "",
          `### Principales Clientes en el Estado (Mayor concentración):`,
        );

        Array.from(porInstitucion.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .forEach(([inst, totalInst], idx) => {
            out.push(`   ${idx + 1}. **${inst}**: ${formatMonto(totalInst)}`);
          });

        out.push("", `### Últimos Contratos Firmados:`);
        contratosGanados.slice(0, 5).forEach((c, idx) => {
          out.push(
            `   ${idx + 1}. **${c.codigo_contrato}** (${soloFecha(c.fecha_adjudicacion)})`,
            `      - Objeto: ${fixEncoding(c.descripcion?.trim() || "S/D")}`,
            `      - Entidad: ${fixEncoding(c.unidad_compra)} | Monto: ${formatMonto(c.valor_contratado, c.divisa ?? "DOP")}`,
            `      - Pago: ${fixEncoding(c.metodo_pago ?? "N/D")} (Plazo: ${fixEncoding(c.plazo_pago_factura ?? "N/D")})`,
          );
        });
      } else {
        out.push(`No se encontraron contratos adjudicados para este proveedor dentro de la muestra de ${contrData.items.length} contratos recientes.`);
      }

      return { content: [{ type: "text", text: truncate(out.join("\n"), MAX_RESPONSE_CHARS) }] };
    } catch (err) {
      if (err instanceof DgcpApiError) {
        return { content: [{ type: "text", text: `Error en radiografía de proveedor: ${err.message}` }] };
      }
      throw err;
    }
  });

  // HERRAMIENTA 3: Calculadora Legal y de Umbrales Oficiales DGCP
  const CalculadoraSchema = z.object({
    monto_estimado: z.number().positive().describe("Monto estimado del proceso en pesos dominicanos (DOP)."),
    tipo_objeto: z.enum(["bienes_servicios", "obras"]).default("bienes_servicios")
      .describe("Tipo de contratación: 'bienes_servicios' u 'obras'"),
    modalidad_planteada: z.string().optional()
      .describe("Modalidad utilizada por la institución para validar si es correcta o si incurre en fraccionamiento."),
    es_mipyme: z.boolean().optional().default(false)
      .describe("true si la empresa oferente cuenta con certificación MIPYME del MICM"),
  }).strict();

  type CalculadoraInput = z.infer<typeof CalculadoraSchema>;

  server.registerTool("dgcp_calculadora_legal", {
    title: "Calculadora Normativa DGCP: Umbrales, Garantías y Alertas de Ilegalidad",
    description: `Calcula las obligaciones legales exactas bajo la Ley 340-06 para cualquier presupuesto:
1. Determina la modalidad de contratación legal obligatoria (LPN, Comparación de Precios, Compra Menor, etc.).
2. Detecta FRACCIONAMIENTO o uso de modalidad incorrecta por parte de la institución contratante (causal de impugnación).
3. Calcula con precisión de centavos:
   - Garantía de Seriedad de Oferta (1%).
   - Garantía de Fiel Cumplimiento (4% General o 1% MIPYME con Decreto 416-23).
   - Anticipo Máximo Legal (20%).
4. Indica plazos mínimos legales de convocatoria y recepción de ofertas.`,
    inputSchema: CalculadoraSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: CalculadoraInput) => {
    const m = params.monto_estimado;
    const esObras = params.tipo_objeto === "obras";
    const esMipyme = params.es_mipyme;

    let modalidadLegal = "";
    let plazoMinimoDias = 0;
    let requiereGarantiaSeriedad = false;

    if (!esObras) {
      if (m >= UMBRALES_BIENES_SERVICIOS.LICITACION_PUBLICA_MIN) {
        modalidadLegal = "Licitación Pública Nacional (LPN)";
        plazoMinimoDias = 30; // 30 días hábiles
        requiereGarantiaSeriedad = true;
      } else if (m >= UMBRALES_BIENES_SERVICIOS.COMPARACION_PRECIOS_MIN) {
        modalidadLegal = "Comparación de Precios (CP)";
        plazoMinimoDias = 5; // 5 días hábiles
        requiereGarantiaSeriedad = true;
      } else if (m >= UMBRALES_BIENES_SERVICIOS.COMPRAS_MENORES_MIN) {
        modalidadLegal = "Compras Menores (CM)";
        plazoMinimoDias = 2; // 2 días hábiles
        requiereGarantiaSeriedad = false;
      } else {
        modalidadLegal = "Compras por Debajo del Umbral (CD)";
        plazoMinimoDias = 1;
        requiereGarantiaSeriedad = false;
      }
    } else {
      if (m >= UMBRALES_OBRAS.LICITACION_PUBLICA_MIN) {
        modalidadLegal = "Licitación Pública de Obras (LPN)";
        plazoMinimoDias = 30;
        requiereGarantiaSeriedad = true;
      } else if (m >= UMBRALES_OBRAS.COMPARACION_PRECIOS_MIN) {
        modalidadLegal = "Comparación de Precios de Obras (CP)";
        plazoMinimoDias = 10;
        requiereGarantiaSeriedad = true;
      } else {
        modalidadLegal = "Sorteo de Obras o Compra Menor";
        plazoMinimoDias = 5;
        requiereGarantiaSeriedad = false;
      }
    }

    const gSeriedad = m * GARANTIA_SERIEDAD_OFERTA_PCT;
    const gFielGen = m * GARANTIA_FIEL_CUMPLIMIENTO_PCT;
    const gFielMipyme = m * GARANTIA_FIEL_CUMPLIMIENTO_MIPYME_PCT;
    const anticipo = m * ANTICIPO_MAXIMO_PCT;

    const out = [
      `# ANÁLISIS NORMATIVO Y CÁLCULO DE GARANTÍAS (Ley 340-06)`,
      `**Monto Evaluado:** ${formatMonto(m)} | **Objeto:** ${esObras ? "Obras Públicas" : "Bienes y Servicios"}`,
      `**Modalidad Legal Correspondiente:** **${modalidadLegal}**`,
      `**Plazo Mínimo de Convocatoria Legal:** **${plazoMinimoDias} días hábiles** entre publicación y apertura.`,
      "---",
      `## 1. Valores de Garantías Legales`,
      `- **Garantía de Seriedad de la Oferta (1%):** **${formatMonto(gSeriedad)}**`,
      `  *Estado de exigencia:* ${requiereGarantiaSeriedad ? "⚠️ **MANDATORIA EN SOBRE A** (LPN / Comparación de Precios). Su omisión es causal de descalificación sin subsanación." : "Opcional / No exigida por ley en Compras Menores (salvo pliego específico)." }`,
      `- **Garantía de Fiel Cumplimiento de Contrato (4% General):** **${formatMonto(gFielGen)}**`,
      `- **Garantía de Fiel Cumplimiento Especial MIPYME (1% Dec. 416-23):** **${formatMonto(gFielMipyme)}** ${esMipyme ? "*(APLICA A TU EMPRESA: Ahorro directo en prima)*" : "*(Requiere certificación MICM vigente)*"}`,
      `- **Anticipo Máximo Autorizado por Ley (20%):** **${formatMonto(anticipo)}**`,
    ];

    // Validación de discrepancia o posible fraccionamiento
    if (params.modalidad_planteada) {
      out.push("", `## 2. Alerta de Legalidad e Impugnación`);
      const modPlanteadaNorm = normalizar(params.modalidad_planteada);
      const modLegalNorm = normalizar(modalidadLegal);

      if (!modLegalNorm.includes(modPlanteadaNorm) && !modPlanteadaNorm.includes(modLegalNorm)) {
        out.push(
          `⚠️ **ALERTA PREVENTIVA DE DISCREPANCIA:**`,
          `La institución convocó mediante *"${params.modalidad_planteada}"*, pero según los umbrales oficiales vigentes de la DGCP para **${formatMonto(m)}**, correspondería **"${modalidadLegal}"**.`,
          `- Si la institución utilizó una modalidad de menor cuantía sin justificación de lote o urgencia, existe indicio pasible de **fraccionamiento** (Art. 25 Ley 340-06), sujeto a solicitud formal de aclaración o recurso administrativo.`,
        );
      } else {
        out.push(`✅ **Modalidad Conforme:** La modalidad convocada *"${params.modalidad_planteada}"* coincide con los umbrales oficiales vigentes de la DGCP.`);
      }
    }

    out.push(
      "",
      `---`,
      `### 📌 Fuentes Normativas y Trazabilidad Oficial:`,
      `- **Resolución DGCP No. PNP-01-2024 / PNP-02-2024:** Fijación anual de umbrales para compras públicas.`,
      `- **Ley No. 340-06 y modificatoria Ley No. 449-06:** Arts. 16, 17, 25, 30 y 31.`,
      `- **Decreto No. 543-12:** Reglamento de Aplicación, Arts. 109, 112 y concordantes.`,
      `- **Decreto No. 416-23:** Medidas de apoyo a MIPYMES (reducción de garantía de fiel cumplimiento al 1%).`,
      ``,
      `*Aviso de Responsabilidad Jurídica: Este análisis es una herramienta técnica orientativa automatizada basada en la normativa vigente al momento de la consulta. Requiere revisión humana por el equipo legal del oferente frente a las cláusulas particulares del Pliego de Condiciones Específicas.*`
    );

    return { content: [{ type: "text", text: out.join("\n") }] };
  });
}
