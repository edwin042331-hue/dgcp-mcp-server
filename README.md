# Servidor MCP Soberano - Contrataciones Públicas de República Dominicana (DGCP v4.1)

[![CI - Verificación y Pruebas](https://github.com/edwin042331-hue/dgcp-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/edwin042331-hue/dgcp-mcp-server/actions/workflows/ci.yml)
[![Tests: 17 Passed](https://img.shields.io/badge/Vitest-17%20Passed-brightgreen)](https://github.com/edwin042331-hue/dgcp-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js: >=18](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Official%20Standard-purple)](https://modelcontextprotocol.io/)

Creamos este servidor MCP de código abierto para **centralizar, transparentar y poner al alcance de toda la comunidad dominicana los datos de compras públicas del Estado**. Conecta cualquier asistente o agente de IA (**Claude Desktop, Gemini CLI, Cursor, Antigravity**) con la API oficial de datos abiertos de la Dirección General de Contrataciones Públicas (**DGCP**).

- **Fuente Oficial:** `https://datosabiertos.dgcp.gob.do/api-dgcp/v1`
- **Marco Legal:** Ley No. 340-06, Decreto No. 543-12, Decreto No. 416-23 (MIPYMES) y Resoluciones Vigentes de Umbrales Oficiales DGCP.

---

## 🚀 Suite Institucional Completa (13 Herramientas Verificadas)

| # | Herramienta | Pilar Estratégico | Función Principal |
|---|---|---|---|
| 1 | `dgcp_buscar_licitaciones` | Rastreo Operativo | Búsqueda multitérmino de procesos abiertos con validación de cierre en milisegundos y reporte de cobertura. |
| 2 | `dgcp_buscar_contratos` | Histórico y Pagos | Acceso a +722,000 contratos: adjudicatarios reales, montos, plazos (30, 60, 90+ días) y métodos de pago. |
| 3 | `dgcp_buscar_ofertas` | Inteligencia de Mercado | Consulta de +1.47 millones de propuestas económicas y técnicas de competidores en Sobre A y B. |
| 4 | `dgcp_buscar_proveedores` | Padrón RPE | Verificación de RNC, clasificación MIPYME del MICM, estatus y rubros comerciales registrados. |
| 5 | `dgcp_inteligencia_proceso` | Cruce 360° | Análisis integral de licitación: quién ganó procesos anteriores, ofertas rivales y garantías legales obligatorias. |
| 6 | `dgcp_radiografia_proveedor` | Análisis Competitivo | Volumen de facturación estatal acumulada, cuota de mercado e instituciones clientes principales. |
| 7 | `dgcp_calculadora_legal` | Blindaje Jurídico | Cálculo de umbrales oficiales, detección de fraccionamiento, garantía de seriedad (1%) y póliza MIPYME (1% Dec. 416-23). |
| 8 | `dgcp_generador_propuesta_sncc` | Expedientes Ganadores | Redacción instantánea de formularios oficiales SNCC (F.042, F.033 con 18% ITBIS y Declaración Jurada Art. 14 notariada). |
| 9 | `dgcp_simulador_puntuacion` | Estrategia de Precio | Matriz matemática oficial DGCP `(Pmin / Pof) * Puntos` para determinar el precio óptimo ganador sin ser temerario. |
| 10 | `dgcp_auditoria_colusion` | Forense Anti-Fraude | Detección de vínculos cruzados (teléfonos, correos o domicilios compartidos en RPE) bajo el Art. 65 del Dec. 543-12. |
| 11 | `dgcp_scorecard_institucion` | Salud Financiera | Auditoría de días reales de pago por entidad, método de desembolso (cheque vs transferencia) y rating comercial. |
| 12 | `dgcp_auditor_pliego_trampa` | Anti-Amarre de Pliegos | Detección de marcas comerciales sin equivalencia (violación Art. 21 Ley 340-06) y minuta de solicitud de aclaración técnica. |
| 13 | `dgcp_generador_recurso_impugnacion` | Defensa Jurídica | Redacción formal de Recurso Jerárquico y Medida Cautelar de Suspensión de Oficio ante la DGCP (Ley 340-06 y Ley 107-13). |

---

## ⚡ Instalación Rápida

### Requisitos:
- **Node.js:** Versión 18 o superior (`node -v`).
- **NPM:** Incluido con Node.

### Pasos:

```bash
# 1. Clonar el repositorio
git clone https://github.com/edwin042331-hue/dgcp-mcp-server.git
cd dgcp-mcp-server

# 2. Instalar dependencias y compilar
npm install
npm run build

# 3. Probar las pruebas unitarias
npm test
```

---

## 🔌 Configuración en tu Asistente de IA

### Para Claude Desktop:
Edita tu archivo `claude_desktop_config.json`:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "dgcp": {
      "command": "node",
      "args": ["RUTA_ABSOLUTA_A/dgcp-mcp-server/dist/index.js"]
    }
  }
}
```

### Para Gemini CLI / Antigravity / Cursor:
Agrega la entrada en tu archivo `mcp_config.json`:

```json
{
  "mcpServers": {
    "dgcp": {
      "command": "node",
      "args": ["RUTA_ABSOLUTA_A/dgcp-mcp-server/dist/index.js"]
    }
  }
}
```

---

## 🖥️ Inspección Visual Interactiva con MCP Inspector v2

Puedes explorar de manera gráfica los esquemas Zod y probar cada herramienta directamente en tu navegador:

```bash
npm run inspect
```

Abre automáticamente la consola interactiva oficial del Model Context Protocol en `http://localhost:5173`.

---

## 🧪 Pruebas Unitarias Automatizadas (Vitest)

La suite cuenta con 17 pruebas unitarias de grado industrial que verifican:
- Filtro estricto de fechas (procesos vencidos hace pocas horas no aparecen como abiertos).
- Sanitización de caracteres mal codificados (UTF-8 / Latin-1).
- Umbrales normativos de la Ley 340-06 y Resoluciones anuales DGCP.
- Algoritmo matemático de puntuación económica.

```bash
npm test
```

---

## 🤝 Cómo Contribuir (Comunidad Dominicana)

¡Las contribuciones de desarrolladores, investigadores y ciudadanos son bienvenidas!
La rama `main` está protegida; todas las mejoras se gestionan vía **Pull Request**:
1. Haz un **Fork** de este repositorio.
2. Crea tu rama descriptiva (`git checkout -b feature/nueva-herramienta`).
3. Agrega tus pruebas correspondientes en `tests/` y confirma que `npm test` pase en verde.
4. Envía tu **Pull Request**.

Consulta nuestra guía completa en [CONTRIBUTING.md](CONTRIBUTING.md).

---

## ⚖️ Licencia y Aviso Legal
Este proyecto está licenciado bajo la **Licencia MIT** - consulta [LICENSE](LICENSE) para más detalles.

*Aviso de Responsabilidad: Este software es una iniciativa independiente y abierta de transparencia de datos cívicos. Los análisis, dictámenes y cálculos generados constituyen asistencia técnica informativa automatizada basada en datos públicos y normativa vigente. Requieren revisión humana y no sustituyen las resoluciones formales de los Comités de Compras y Contrataciones ni de la Dirección General de Contrataciones Públicas (DGCP).*
