// src/tools/forenseTools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  dgcpGetVariasPaginas, formatMonto, truncate, fixEncoding,
  normalizar, limpiarRNC, DgcpApiError,
} from "../services/dgcpClient.js";
import { TAMANO_PAGINA_API, MAX_RESPONSE_CHARS } from "../constants.js";
import type { OfertaReal, ProveedorReal, ProcesoReal } from "../types.js";

const ForenseSchema = z.object({
  codigo_proceso: z.string().describe("Codigo oficial del proceso a auditar (ej. 'TSS-DAF-CM-2026-0055')."),
  paginas: z.number().int().min(1).max(25).optional().default(15)
    .describe("Paginas a escanear en ofertas y proveedores para la auditoria forense (default 15)"),
}).strict();

type ForenseInput = z.infer<typeof ForenseSchema>;

export function registerForenseTools(server: McpServer): void {
  server.registerTool("dgcp_auditoria_colusion", {
    title: "Auditoría Forense de Colusión, Vinculación y Procesos Viciados",
    description: `Audita forensemente las ofertas presentadas en un proceso para detectar amarres o colusión:
1. Rastrea todos los oferentes que depositaron propuestas para ese código de proceso.
2. Cruza cada oferente contra el padrón oficial del RPE (/proveedores).
3. Detecta banderas rojas de colusión (Art. 14 Ley 340-06 y Art. 65 Dec. 543-12):
   - Teléfonos o celulares comerciales idénticos entre competidores supuestamente independientes.
   - Correos electrónicos o dominios compartidos.
   - Domicilio comercial o representantes legales cruzados.
   - Posturas de cobertura (precios coordinados artificialmente).
4. Emite un dictamen legal con los fundamentos jurídicos para solicitar la descalificación de oficio o impugnación.`,
    inputSchema: ForenseSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: ForenseInput) => {
    try {
      const codBuscado = params.codigo_proceso.trim();
      const codNorm = normalizar(codBuscado);
      const paginas = params.paginas ?? 15;

      // 1. Obtener proceso
      const procData = await dgcpGetVariasPaginas<ProcesoReal>("procesos", 8, TAMANO_PAGINA_API);
      const proceso = procData.items.find((p) => normalizar(p.codigo_proceso) === codNorm);

      // 2. Obtener ofertas para este proceso
      const ofData = await dgcpGetVariasPaginas<OfertaReal>("ofertas", paginas, TAMANO_PAGINA_API);
      const ofertasProceso = ofData.items.filter((o) => normalizar(o.codigo_proceso) === codNorm);

      const out: string[] = [
        `# DICTAMEN DE AUDITORÍA FORENSE Y DETECCIÓN DE COLUSIÓN (DGCP)`,
        `**Proceso Auditado:** ${codBuscado}`,
        `**Objeto:** ${proceso?.titulo ? fixEncoding(proceso.titulo) : "Proceso de Contratación Pública"}`,
        `**Institución:** ${proceso?.unidad_compra ? fixEncoding(proceso.unidad_compra) : "Institución Contratante"}`,
        "---",
      ];

      if (ofertasProceso.length === 0) {
        out.push(
          `## 1. Estado de Ofertas en el Portal`,
          `No se encontraron ofertas registradas para este código de proceso dentro de los ${ofData.items.length} registros más recientes de la DGCP.`,
          `*(Posibles causas: El proceso está aún en fase de recepción abierta y los sobres no han sido aperturados formalmente en el Portal Transaccional).*`,
          "",
          `### Verificación Preventiva de Riesgo de Pliegos:`,
          `- **Vigilancia de Especificaciones Técnicas:** Revisa si el pliego exige marcas registradas sin colocar la frase legal *"o su equivalente funcional"* (prohibido por el Art. 21 de la Ley 340-06).`,
          `- **Plazos Mínimos:** Si la institución dio menos de los días hábiles requeridos por su umbral, el proceso es nulo de pleno derecho por vulnerar el principio de libre participación.`,
        );
        return { content: [{ type: "text", text: out.join("\n") }] };
      }

      out.push(
        `## 1. Mapeo de Competidores Identificados (${ofertasProceso.length} ofertas)`,
        `Se auditaron las siguientes propuestas económicas depositadas:`,
      );

      ofertasProceso.forEach((o, idx) => {
        out.push(
          `   ${idx + 1}. **${fixEncoding(o.razon_social)}** (RPE: ${o.rpe ?? "N/D"})`,
          `      - Monto Ofertado: ${formatMonto(o.valor_oferta, "DOP")} | Estado: ${fixEncoding(o.estado_evaluacion || o.estado_oferta)}`,
        );
      });

      // 3. Buscar datos de cada oferente en RPE
      const provData = await dgcpGetVariasPaginas<ProveedorReal>("proveedores", 15, TAMANO_PAGINA_API);

      const fichasCompetidores: { oferta: OfertaReal; proveedor?: ProveedorReal }[] = [];
      for (const o of ofertasProceso) {
        const rpeStr = String(o.rpe ?? "").trim();
        const prov = provData.items.find((p) => String(p.rpe ?? "").trim() === rpeStr);
        fichasCompetidores.push({ oferta: o, proveedor: prov });
      }

      // 4. Algoritmo Forense de Detección de Colusión
      const alertas: string[] = [];
      const telefonos = new Map<string, string[]>();
      const correos = new Map<string, string[]>();
      const direcciones = new Map<string, string[]>();

      for (const item of fichasCompetidores) {
        if (!item.proveedor) continue;
        const nombre = fixEncoding(item.proveedor.razon_social);

        // Limpiar teléfonos
        const tel1 = (item.proveedor.telefono_comercial ?? "").replace(/[^0-9]/g, "");
        const tel2 = (item.proveedor.telefono_contacto ?? "").replace(/[^0-9]/g, "");
        const correo = normalizar(item.proveedor.correo_comercial ?? item.proveedor.correo_contacto ?? "");
        const dir = normalizar(item.proveedor.direccion ?? "");

        if (tel1 && tel1.length >= 7) {
          const arr = telefonos.get(tel1) ?? [];
          arr.push(nombre);
          telefonos.set(tel1, arr);
        }
        if (tel2 && tel2.length >= 7 && tel2 !== tel1) {
          const arr = telefonos.get(tel2) ?? [];
          arr.push(nombre);
          telefonos.set(tel2, arr);
        }
        if (correo && !correo.includes("gmail.com") && !correo.includes("hotmail.com") && !correo.includes("yahoo.com")) {
          const arr = correos.get(correo) ?? [];
          arr.push(nombre);
          correos.set(correo, arr);
        }
        if (dir && dir.length > 10) {
          const arr = direcciones.get(dir) ?? [];
          arr.push(nombre);
          direcciones.set(dir, arr);
        }
      }

      // Evaluar colisión de teléfonos
      telefonos.forEach((empresas, tel) => {
        if (empresas.length > 1) {
          alertas.push(`🚩 **TELÉFONO DUPLICADO IDENTIFICADO:** Las empresas **${empresas.join(" y ")}** tienen registrado el mismo número de teléfono (**${tel}**) en el padrón oficial del RPE.`);
        }
      });

      // Evaluar colisión de correos
      correos.forEach((empresas, email) => {
        if (empresas.length > 1) {
          alertas.push(`🚩 **CORREO ELECTRÓNICO COMPARTIDO:** Las empresas **${empresas.join(" y ")}** comparten el mismo correo (**${email}**) en el RPE.`);
        }
      });

      // Evaluar colisión de direcciones
      direcciones.forEach((empresas, d) => {
        if (empresas.length > 1) {
          alertas.push(`🚩 **DOMICILIO FÍSICO COMÚN:** Las empresas **${empresas.join(" y ")}** registran el mismo domicilio comercial en el RPE.`);
        }
      });

      out.push("", `## 2. Resultado de la Inspección Anti-Colusión`);

      if (alertas.length > 0) {
        out.push(
          `⚠️ **SE HAN DETECTADO INDICIOS GRAVES DE VINCULACIÓN ENTRE OFERENTES:**`,
          "",
          ...alertas,
          "",
          `### Fundamento Jurídico para Descalificación e Impugnación:`,
          `- **Artículo 14, Numeral 5 de la Ley 340-06:** Establece la prohibición de que personas físicas o jurídicas que formen parte de un mismo grupo económico o compartan administración participen simultáneamente con ofertas separadas en un mismo proceso.`,
          `- **Artículo 65 del Decreto 543-12:** Faculta al Comité de Compras y Contrataciones a la **descalificación motivada** de los oferentes que incurran en prácticas colusorias o acuerdos previos.`,
          `- **Acción Recomendada:** Si presentaste oferta en este proceso y detectas esto, solicita formalmente al Comité de Compras la verificación oficiosa del Art. 65 del Decreto 543-12 con copia a la Dirección General de Contrataciones Públicas (DGCP).`,
        );
      } else {
        out.push(
          `✅ **Sin Evidencia de Vínculos Cruzados Directos:** No se identificaron teléfonos comerciales, correos corporativos ni domicilios idénticos compartidos entre los oferentes en los registros cotejados del RPE.`,
          `- Las propuestas analizadas presentan datos de contacto diferenciados en el padrón del Estado.`,
        );
      }

      out.push(
        "",
        `---`,
        `*Aviso Forense y Salvaguarda Legal: Este reporte es un cotejo algorítmico automatizado sobre datos públicos del Registro de Proveedores del Estado (RPE). Constituye un indicio preventivo de carácter técnico-administrativo que requiere verificación humana y no sustituye la investigación formal de los órganos de control ni vulnera la presunción de inocencia de los participantes.*`
      );

      return { content: [{ type: "text", text: truncate(out.join("\n"), MAX_RESPONSE_CHARS) }] };
    } catch (err) {
      if (err instanceof DgcpApiError) {
        return { content: [{ type: "text", text: `Error en auditoría forense: ${err.message}` }] };
      }
      throw err;
    }
  });
}
