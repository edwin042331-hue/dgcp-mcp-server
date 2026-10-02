// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerProcesosTools } from "./tools/procesosTools.js";
import { registerContratosTools } from "./tools/contratosTools.js";
import { registerOfertasTools } from "./tools/ofertasTools.js";
import { registerProveedoresTools } from "./tools/proveedoresTools.js";
import { registerInteligenciaTools } from "./tools/inteligenciaTools.js";
import { registerPropuestasTools } from "./tools/propuestasTools.js";
import { registerForenseTools } from "./tools/forenseTools.js";
import { registerQuirurgicoTools } from "./tools/quirurgicoTools.js";

const server = new McpServer({
  name: "dgcp-mcp-server",
  version: "4.0.0",
});

// ============================================================================
// SUITE INSTITUCIONAL SOBERANA DE CONTRATACIONES PÚBLICAS RD (DGCP v4.0)
// ============================================================================

// 1. Núcleo Operativo de Consulta y Rastreo Acelerado (100% Verificado)
registerProcesosTools(server);    // dgcp_buscar_licitaciones
registerContratosTools(server);   // dgcp_buscar_contratos
registerOfertasTools(server);     // dgcp_buscar_ofertas
registerProveedoresTools(server); // dgcp_buscar_proveedores

// 2. Inteligencia Estratégica 360° y Auditoría de Competidores
registerInteligenciaTools(server);
//   - dgcp_inteligencia_proceso: Cruce 360° automático (licitación + quién ganó antes + ofertas + garantías)
//   - dgcp_radiografia_proveedor: Cuota de mercado estatal, facturación acumulada y principales clientes
//   - dgcp_calculadora_legal: Umbrales oficiales DGCP, detección de fraccionamiento y cálculo de pólizas

// 3. Ingeniería de Licitaciones y Preparación de Expedientes Ganadores
registerPropuestasTools(server);
//   - dgcp_generador_propuesta_sncc: Redacción instantánea de formularios oficiales SNCC (F.042, F.033, Dec. Jurada)
//   - dgcp_simulador_puntuacion: Algoritmo matemático oficial DGCP de puntuación técnica y económica con matriz de sensibilidad

// 4. Auditoría Forense y Anti-Fraude
registerForenseTools(server);
//   - dgcp_auditoria_colusion: Detección de vínculos cruzados, teléfonos duplicados y procesos amarrados

// 5. Inteligencia Quirúrgica y Defensa Jurídica de Estado (Nivel Élite)
registerQuirurgicoTools(server);
//   - dgcp_scorecard_institucion: Salud financiera y riesgo de pago (días reales de pago, concentración de proveedores)
//   - dgcp_auditor_pliego_trampa: Detección forense de pliegos dirigidos a una marca o con cláusulas prohibidas
//   - dgcp_generador_recurso_impugnacion: Redacción formal de recurso jerárquico y medida cautelar ante la DGCP

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("===================================================================");
  console.error(" Servidor MCP DGCP Soberano v4.0 - Plataforma Élite de Compras RD");
  console.error("===================================================================");
  console.error("  [1]  dgcp_buscar_licitaciones         (Rastreo y filtrado multitérmino)");
  console.error("  [2]  dgcp_buscar_contratos            (Histórico de adjudicaciones y pagos)");
  console.error("  [3]  dgcp_buscar_ofertas              (Mapeo de ofertas de competidores)");
  console.error("  [4]  dgcp_buscar_proveedores          (Auditoría RPE, RNC y clasificación)");
  console.error("  [5]  dgcp_inteligencia_proceso        (⭐ Cruce 360: Quién ganó antes y estrategia)");
  console.error("  [6]  dgcp_radiografia_proveedor       (⭐ Cuota de mercado y clientes del competidor)");
  console.error("  [7]  dgcp_calculadora_legal           (⭐ Umbrales, alertas fraccionamiento y pólizas)");
  console.error("  [8]  dgcp_generador_propuesta_sncc    (⭐ Formularios oficiales SNCC Sobre A y B)");
  console.error("  [9]  dgcp_simulador_puntuacion        (⭐ Simulación matemática oficial de adjudicación)");
  console.error("  [10] dgcp_auditoria_colusion          (⭐ Detección forense de colusión y amarres)");
  console.error("  [11] dgcp_scorecard_institucion       (⭐ Scorecard de salud financiera y riesgo de pago)");
  console.error("  [12] dgcp_auditor_pliego_trampa       (⭐ Detección de pliegos dirigidos y cláusulas ilegales)");
  console.error("  [13] dgcp_generador_recurso_impugnacion(⭐ Redacción de recurso legal y medida cautelar DGCP)");
  console.error("===================================================================");
}

main().catch((err: unknown) => {
  console.error("Error fatal en el servidor MCP DGCP v4.0:", err);
  process.exit(1);
});
