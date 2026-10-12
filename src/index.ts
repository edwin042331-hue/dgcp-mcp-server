#!/usr/bin/env node
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VERSION } from "./constants.js";
import { registerProcesosTools } from "./tools/procesosTools.js";
import { registerConsultasTools } from "./tools/consultasTools.js";
import { registerInteligenciaTools } from "./tools/inteligenciaTools.js";
import { registerMercadoTools } from "./tools/mercadoTools.js";
import { registerPropuestasTools } from "./tools/propuestasTools.js";
import { registerForenseTools } from "./tools/forenseTools.js";
import { registerQuirurgicoTools } from "./tools/quirurgicoTools.js";

export function crearServidor(): McpServer {
  const server = new McpServer(
    { name: "dgcp-mcp-server", version: VERSION },
    {
      instructions:
        "Servidor de datos abiertos de Contrataciones Publicas de Republica Dominicana (DGCP). " +
        "Para 'lo ultimo' o 'lo de hoy' usa dgcp_ultimas_licitaciones. Para buscar procesos abiertos, dgcp_buscar_licitaciones. " +
        "Para analizar un proceso concreto, dgcp_inteligencia_proceso. Para 'que puedo ofertar', dgcp_oportunidades_para_mi. " +
        "Las fechas y horas son de Republica Dominicana. La API de la DGCP se actualiza a las 00:00, 07:00, 14:00 y 21:00. " +
        "El marco legal vigente es la Ley 47-25 y su Reglamento (Dec. 52-26); los procesos convocados antes de su vigencia siguen la Ley 340-06.",
    },
  );

  // Consulta (filtros exactos del servidor de la API)
  registerProcesosTools(server);     // dgcp_buscar_licitaciones, dgcp_ultimas_licitaciones
  registerConsultasTools(server);    // dgcp_buscar_contratos, dgcp_buscar_ofertas, dgcp_buscar_proveedores
  // Inteligencia
  registerInteligenciaTools(server); // dgcp_inteligencia_proceso, dgcp_radiografia_proveedor, dgcp_calculadora_legal
  registerMercadoTools(server);      // dgcp_oportunidades_para_mi, dgcp_precios_referencia, dgcp_plan_compras
  // Preparacion de ofertas
  registerPropuestasTools(server);   // dgcp_generador_propuesta_sncc, dgcp_simulador_puntuacion
  // Control y defensa
  registerForenseTools(server);      // dgcp_auditoria_colusion
  registerQuirurgicoTools(server);   // dgcp_scorecard_institucion, dgcp_auditor_pliego_trampa, dgcp_generador_recurso_impugnacion
  return server;
}

async function main(): Promise<void> {
  const server = crearServidor();
  await server.connect(new StdioServerTransport());
  console.error(`dgcp-mcp-server v${VERSION} listo (stdio).`);
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((err: unknown) => {
    console.error("Error fatal en dgcp-mcp-server:", err);
    process.exit(1);
  });
}
