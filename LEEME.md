# Servidor MCP Soberano - Contrataciones Públicas de República Dominicana (DGCP v4.1)

Conecta asistentes de IA (Claude Desktop, Gemini CLI, Cursor, Antigravity) a la API oficial de datos abiertos de la Dirección General de Contrataciones Públicas (DGCP).

- **API Oficial:** `https://datosabiertos.dgcp.gob.do/api-dgcp/v1`
- **Marco Normativo:** Ley 340-06, Decreto 543-12, Decreto 416-23 (MIPYMES) y Resoluciones Oficiales de Umbrales DGCP (PNP-01-2024 / PNP-02-2024).

---

## 1. Suite Institucional Completa (13 Herramientas Verificadas)

| # | Herramienta | Alcance Estratégico | Salida / Función |
|---|---|---|---|
| 1 | `dgcp_buscar_licitaciones` | Rastreo y Filtrado | Procesos abiertos, publicados o cerrados con validación estricta de fecha en milisegundos y trazabilidad de muestra. |
| 2 | `dgcp_buscar_contratos` | Histórico de Adjudicaciones | Adjudicatarios reales, montos firmados, métodos y plazos de pago (30, 60, 90+ días). |
| 3 | `dgcp_buscar_ofertas` | Inteligencia de Mercado | Propuestas económicas de competidores y estado de evaluación en Sobre A y B. |
| 4 | `dgcp_buscar_proveedores` | Padrón Oficial (RPE) | RNC, RPE, clasificación MIPYME, rubros comerciales y datos de contacto. |
| 5 | `dgcp_inteligencia_proceso` | Cruce 360° Total | Ficha técnica + antecedentes históricos ("quién ganó antes") + competidores + garantías obligatorias. |
| 6 | `dgcp_radiografia_proveedor` | Inteligencia Competitiva | Facturación histórica acumulada al Estado, cuota de mercado y clientes institucionales principales. |
| 7 | `dgcp_calculadora_legal` | Blindaje Jurídico | Umbrales oficiales, detección de fraccionamiento, cálculo de garantías (1% seriedad, 4% fiel cumplimiento, 1% MIPYME Dec. 416-23). |
| 8 | `dgcp_generador_propuesta_sncc` | Ingeniería de Licitación | Redacción instantánea de formularios oficiales SNCC.F.042, SNCC.F.033 con ITBIS y Declaración Jurada Art. 14 notariada. |
| 9 | `dgcp_simulador_puntuacion` | Estrategia Económica | Matriz de sensibilidad matemática oficial DGCP `(Pmin / Pof) * Puntos` para determinar el precio ganador exacto. |
| 10 | `dgcp_auditoria_colusion` | Forense Anti-Fraude | Detección de vínculos cruzados (teléfonos, correos o domicilios compartidos en RPE) bajo Art. 14 Ley 340-06 y Art. 65 Dec. 543-12. |
| 11 | `dgcp_scorecard_institucion` | Salud Financiera Institucional | Días reales de pago, método de desembolso (cheque vs transferencia), concentración de proveedores y rating de solvencia. |
| 12 | `dgcp_auditor_pliego_trampa` | Anti-Amarre de Pliegos | Detección de marcas comerciales sin equivalencia (Art. 21 Ley 340-06) y generación de solicitud de aclaración técnica. |
| 13 | `dgcp_generador_recurso_impugnacion` | Defensa Jurídica de Estado | Minuta formal de Recurso Jerárquico y Medida Cautelar de Suspensión de Oficio ante la DGCP (Ley 340-06 y Ley 107-13). |

---

## 2. Inspección Visual y CI con MCP Inspector v2

Puedes probar de forma interactiva y visual cada herramienta, sus esquemas Zod y sus respuestas en tiempo real:

```bash
# Opción 1: Mediante npm script
npm run inspect

# Opción 2: Ejecución directa con npx
npx @modelcontextprotocol/inspector node .\dist\index.js
```

Esto abrirá la consola interactiva oficial del Model Context Protocol en tu navegador para auditar inputs, schemas y outputs.

---

## 3. Pruebas Automatizadas con Vitest

El servidor cuenta con una suite completa de pruebas unitarias que validan:
- Cálculo estricto de fechas (procesos vencidos hace menos de 24 horas marcados como cerrados).
- Sanitización de encoding de caracteres UTF-8/Latin-1.
- Límites de umbrales y cálculo de garantías legales.
- Algoritmo matemático oficial de puntuación económica.

```bash
# Ejecutar pruebas una sola vez
npm test

# Modo observador (watch mode)
npm run test:watch
```

---

## 4. Trazabilidad de Datos y Salvaguardas Jurídicas

1. **Muestras y Cobertura:** La API DGCP no filtra del lado del servidor. Las herramientas descargan lotes concurrentes y reportan de forma transparente:
   - Número de registros escaneados.
   - Páginas descargadas y páginas con fallos de red.
   - Fecha exacta de la consulta.
   - Advertencia de que un resultado vacío en una muestra reciente no descarta convocatorias anteriores.
2. **Salvaguarda Legal:** Las herramientas jurídicas y forenses incluyen fuentes normativas oficiales (Resoluciones DGCP, Ley 340-06, Dec. 543-12) y advertencias de que los dictámenes constituyen asistencia técnica orientativa que requiere validación humana frente al Pliego de Condiciones Específicas.
