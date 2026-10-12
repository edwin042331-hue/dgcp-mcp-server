# dgcp-mcp-server

[![CI](https://github.com/edwin042331-hue/dgcp-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/edwin042331-hue/dgcp-mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-stdio-purple)](https://modelcontextprotocol.io/)

Servidor [Model Context Protocol](https://modelcontextprotocol.io/) que conecta cualquier asistente de IA (Claude, Cursor, Gemini CLI...) con la **API oficial de datos abiertos de la Dirección General de Contrataciones Públicas de República Dominicana (DGCP)**.

Pregúntale a tu IA *"¿cuál es la última licitación?"*, *"¿qué puedo ofertar hoy con mi RPE?"*, *"¿a qué precio se han comprado estas laptops?"* o *"¿hay colusión en este proceso?"* y responde con datos oficiales, exactos y con la hora de República Dominicana.

- **Fuente:** `https://datosabiertos.dgcp.gob.do/api-dgcp/v1` (solo lectura, sin credenciales).
- **Marco legal:** Ley 47-25 de Contrataciones Públicas, su Reglamento (Decreto 52-26) y los umbrales 2026 (Resolución PNP-03-2026), con régimen transitorio de la Ley 340-06 para procesos convocados antes.

---

## Herramientas (17)

### Consulta
| Herramienta | Qué responde |
|---|---|
| `dgcp_ultimas_licitaciones` | Lo último publicado (hoy, esta semana), del más reciente al más antiguo, con hora RD y tiempo restante para ofertar. |
| `dgcp_buscar_licitaciones` | Procesos abiertos o en cualquier estado. Con `estado: "abierto"` revisa el universo **completo** de procesos publicados, no una muestra. Admite términos alternativos (`"laptop, computadora, servidor"`), institución por nombre/acrónimo/código, montos, fechas y orden. |
| `dgcp_buscar_contratos` | Quién ganó, cuánto, cuándo, forma y plazo de pago. Filtros exactos por proceso, RPE o institución. |
| `dgcp_buscar_ofertas` | Todas las ofertas de un proceso o de una empresa, ordenables por precio. |
| `dgcp_buscar_proveedores` | Ficha RPE por RPE, RNC/cédula o nombre, con alerta si figura en la lista oficial de inhabilitados. |

### Inteligencia
| Herramienta | Qué responde |
|---|---|
| `dgcp_inteligencia_proceso` | Expediente 360° de un proceso: ficha y cronograma, artículos con código UNSPSC y precio estimado, documentos del pliego, ofertas, adjudicación, a quién le compra la institución, control de legalidad (plazo mínimo, modalidad vs. umbral, fecha límite de aclaraciones) y garantías según la ley aplicable. |
| `dgcp_oportunidades_para_mi` | **Qué licitaciones abiertas encajan con lo que vende tu empresa**, cruzando todos los rubros UNSPSC registrados en tu RPE con los artículos de cada proceso vigente. Encuentra lo que una búsqueda por palabras pierde. |
| `dgcp_precios_referencia` | A qué precio unitario el Estado contrató realmente un artículo (mínimo, P25, mediana, P75, máximo por unidad de medida) con ejemplos recientes. Para fijar precio o detectar sobreprecios. |
| `dgcp_plan_compras` | Lo que una institución planea comprar en el año (PACC): monto, modalidad y fecha prevista. Para anticiparse a la licitación. |
| `dgcp_radiografia_proveedor` | Perfil completo de una empresa: ficha, inhabilitaciones, rubros, todos sus contratos, clientes principales y tasa de éxito (procesos ganados / ofertados). |
| `dgcp_scorecard_institucion` | Cómo compra y paga una institución: plazos de pago frente al máximo legal de 30 días, concentración de proveedores (HHI), cumplimiento de la cuota MIPYME y procesos con plazo de convocatoria inferior al mínimo legal. |
| `dgcp_calculadora_legal` | Modalidad y plazo mínimo según el monto, umbrales 2026, garantías, anticipo y reglas MIPYME, y si la modalidad usada es inferior a la legal. |

### Preparación de ofertas y defensa
| Herramienta | Qué hace |
|---|---|
| `dgcp_generador_propuesta_sncc` | Borradores de carta de presentación, declaración jurada (Arts. 38-39 Ley 47-25), oferta económica con ITBIS, garantías y checklist, con los datos reales del proceso. |
| `dgcp_simulador_puntuacion` | Escenarios de precio con la fórmula de proporcionalidad inversa y recomendación según tu margen mínimo. |
| `dgcp_auditoria_colusion` | Cruza cada oferente de un proceso con su ficha RPE y con la lista de inhabilitados: teléfonos, correos, dominios, domicilios o contactos compartidos, ofertas idénticas, empresas recién creadas. |
| `dgcp_auditor_pliego_trampa` | Marcas sin equivalencia, exclusividades, criterios subjetivos y plazos insuficientes; redacta la solicitud de aclaración (Art. 102). |
| `dgcp_generador_recurso_impugnacion` | Recurso de reconsideración (Arts. 204-205) o jerárquico impropio ante la DGCP (Arts. 207-208), con cálculo del vencimiento y medida cautelar opcional (Art. 211). |

Las herramientas jurídicas son asistencia técnica: el resultado debe revisarlo un abogado.

---

## Instalación

Requisitos: Node.js 20 o superior.

```bash
git clone https://github.com/edwin042331-hue/dgcp-mcp-server.git
cd dgcp-mcp-server
npm ci
npm run build
```

En Windows, `instalar.ps1` hace todo lo anterior, prueba la conexión con la API y registra el servidor en Claude Desktop y Gemini CLI:

```powershell
powershell -ExecutionPolicy Bypass -File .\instalar.ps1
```

### Claude Code
```bash
claude mcp add dgcp -- node /ruta/absoluta/dgcp-mcp-server/dist/index.js
```

### Claude Desktop, Cursor, Gemini CLI y otros clientes
```json
{
  "mcpServers": {
    "dgcp": {
      "command": "node",
      "args": ["/ruta/absoluta/dgcp-mcp-server/dist/index.js"]
    }
  }
}
```
Claude Desktop: `%APPDATA%\Claude\claude_desktop_config.json` (Windows) o `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS).

### Variables de entorno (opcionales)
| Variable | Default | Uso |
|---|---|---|
| `DGCP_PETICIONES_POR_MINUTO` | 120 | Tope propio de seguridad; además se pausa si la API avisa que quedan ≤3 peticiones. |
| `DGCP_CONCURRENCIA` | 6 | Peticiones simultáneas máximas. |
| `DGCP_TIMEOUT_MS` | 35000 | Timeout por intento HTTP. |
| `DGCP_REINTENTOS` | 3 | Reintentos ante 429, 5xx y errores de red. |
| `DGCP_CACHE_TTL_MS` | 600000 | Vida de la caché (los datos cambian 4 veces al día). |
| `DGCP_CACHE_MAX_MB` | 96 | Tope de memoria de la caché. |
| `DGCP_MAX_PAGINAS` | 6 | Páginas de 1000 registros por consulta. |

---

## Frescura de los datos

La API de la DGCP se alimenta de un Data Warehouse que se actualiza **a las 00:00, 07:00, 14:00 y 21:00 (hora RD)**. Lo publicado en el portal transaccional después del último corte aparece en el siguiente. Cada respuesta indica el corte vigente y el próximo, para que nunca se confunda ese desfase con un error.

## Cómo funciona por dentro

- **Filtros del servidor.** La API sí filtra por código de proceso, RPE, RNC, unidad de compra, estado, MIPYME y fechas; el servidor los usa en vez de descargar páginas a ciegas, y declara la cobertura de cada respuesta ("100% de 686 procesos").
- **Hora de República Dominicana.** La API rotula sus fechas con `Z` (UTC) pero son hora local RD. Interpretarlas como UTC adelanta cada cierre 4 horas; aquí se corrige en un solo lugar (`src/utils/fechas.ts`).
- **Resiliencia.** Limitador de tasa adaptativo (ventana deslizante, concurrencia acotada y pausa según `x-ratelimit-remaining`), reintentos con backoff exponencial y jitter que respetan `Retry-After`, deduplicación de peticiones idénticas en vuelo, caché LRU acotada por bytes, presupuestos de tiempo para herramientas pesadas y errores devueltos al modelo con `isError` y una sugerencia accionable.
- **Normativa verificada.** `src/normativa.ts` concentra cada umbral, plazo y porcentaje, cada uno atado al artículo que lo establece en los textos oficiales.

Detalle técnico de la API y sus particularidades: [docs/API-DGCP.md](docs/API-DGCP.md).

## Desarrollo

```bash
npm run check        # typecheck + pruebas unitarias (sin red)
npm run smoke:live   # compila y ejecuta las 17 herramientas contra la API real
npm run inspect      # MCP Inspector en el navegador
```

Las pruebas unitarias simulan `fetch` y el reloj: no dependen de la red ni de la hora. La prueba en vivo (`scripts/smoke-live.mjs`) sirve para validar cambios contra la API real antes de publicar.

Guía de contribución: [CONTRIBUTING.md](CONTRIBUTING.md). Cambios por versión: [CHANGELOG.md](CHANGELOG.md).

## Licencia y aviso

MIT. Iniciativa independiente de transparencia con datos públicos; no está afiliada a la DGCP. Los análisis, cálculos y borradores son asistencia técnica automatizada: no sustituyen el pliego de condiciones, las decisiones de los comités de contrataciones ni la asesoría legal.
