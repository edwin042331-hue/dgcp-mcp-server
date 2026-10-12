# API de datos abiertos DGCP: referencia práctica

Base: `https://datosabiertos.dgcp.gob.do/api-dgcp/v1`. Todo lo de esta página está verificado con peticiones reales (octubre 2026). La documentación oficial está en `https://datosabiertos.dgcp.gob.do/docs/index.html`.

## Particularidades que rompen integraciones

| Tema | Comportamiento real | Cómo lo maneja el servidor |
|---|---|---|
| Zona horaria | Las fechas vienen como `2026-10-12T08:00:40.03Z`, pero son **hora RD (UTC-4)**: el portal muestra ese proceso publicado el `12/10/2026 08:00:40 (UTC-04:00)`. | `parseFechaDGCP` reemplaza la `Z` por `-04:00`. |
| Frescura | El Data Warehouse se actualiza a las 00:00, 07:00, 14:00 y 21:00 RD. | Cada respuesta muestra el último y el próximo corte. |
| Límite de tasa | Anuncia `x-ratelimit-limit: 60` por minuto, pero el contador es por nodo del balanceador: 70 peticiones seguidas nunca bajaron de 48 restantes ni dieron 429. | Tope propio de 120/min; pausa si `x-ratelimit-remaining` ≤ 3 y ante `429` según `Retry-After` / `x-ratelimit-reset`. |
| Sin resultados | `payload.content` es `null` y falta `totalResults`. | Se trata como cero resultados. |
| `enddate` | Es **exclusivo**: `startdate=2026-10-12&enddate=2026-10-12` no devuelve nada. | Se envía `enddate` = día siguiente. |
| `estado` | Igualdad exacta (`estado=publicado` no devuelve nada). | Se usan los valores exactos de la tabla de abajo. |
| Orden | `/procesos` viene aproximadamente por fecha de publicación pero **no ordenado dentro de la página**; `/proveedores` viene por RPE ascendente (las empresas de 2005 primero). | Se ordena localmente; nunca se buscan proveedores recorriendo páginas. |
| `limit` | Hasta 1000 por página. | Se usa 1000. |
| "Publicado" vencido | Unos 150 procesos siguen con estado `Proceso publicado` aunque su plazo ya venció. | `estado: "abierto"` exige además fecha de cierre futura. |
| Evaluación de ofertas | `estado_evaluacion` es casi siempre `Pendiente`. | El ganador se obtiene de `/contratos`. |
| Consultas pesadas | `/procesos/articulos?familia=...` puede tardar más de 20 s, y el backend sigue procesándola aunque el cliente la cancele, lo que retrasa las consultas siguientes. | Las oportunidades se calculan paginando artículos recientes (índice por fecha, ~0.4 s por página) y cruzando rubros localmente. |

## Valores exactos

- **estado_proceso:** `Proceso publicado`, `Sobres abiertos o aperturados`, `Sobres estan abriendose`, `Proceso con etapa cerrada`, `Proceso adjudicado y celebrado`, `Proceso desierto`, `Cancelado`, `Suspendido`.
- **modalidad:** `Compras por Debajo del Umbral`, `Contratación Menor`, `Comparación de Precios`, `Licitación Pública Nacional`, `Licitación Pública Abreviada`, `Subasta Inversa`, `Procesos de Excepción`.
- **estado_contrato:** `Activo`, `Cerrado`, `Cancelado`, `Rescindido`, `Modificado`, `Flujo en aprobación`.
- **plazo_pago_factura:** `15 días`, `30 días`, `60 días`, `90 días`, `120 días`, `No especificado`.

## Endpoints usados

| Endpoint | Filtros del servidor |
|---|---|
| `/procesos` | `proceso`, `unidad_compra`, `modalidad`, `estado`, `mipyme`, `mipyme_mujer`, `startdate`, `enddate` |
| `/procesos/articulos` | `proceso`, `familia`, `clase`, `subclase` |
| `/procesos/documentos` | `proceso` (sin paginación) |
| `/procesos/mipymes/cuota_institucion` | `unidad_compra`, `año` |
| `/contratos` | `proceso`, `rpe`, `unidad_compra`, `contrato` |
| `/contratos/articulos` | `proceso`, `contrato`, `familia`, `clase`, `subclase` |
| `/ofertas` | `proceso`, `rpe`, `unidad_compra` |
| `/proveedores` | `rpe`, `numero_documento`, `estado`, `pais`, `region`, `provincia`, `municipio` |
| `/proveedores/rubro` | `rpe`, `rubro` |
| `/unidades_compra` | `codigo_unidad_compra` (765 instituciones) |
| `/pacc/adquisiciones` | `unidad_compra`, `año`, `pacc_id` |
| `/tablas/proveedores?inhabilitados=true&Type=csv` | Lista oficial de proveedores inhabilitados o suspendidos (CSV, ~1 MB). |

Otros disponibles: `/catalogo`, `/ocds/releases?ocid=ocds-6550wx-CODIGO`, `/ocds/releases/all` (solo devuelve `ocid` y `url`), `/procesos/agrupados`, `/procesos/mipymes/cuota_global`, `/proveedores/estadisticas-mujeres`, `/tablas/*` (archivos completos; el de proveedores pesa ~80 MB).

## Cifras de rendimiento observadas

- Consulta filtrada típica: 0.1 a 0.3 s.
- Página de 1000 registros: 0.4 a 2 s (1.5 MB en `/procesos`).
- Universo de procesos publicados: ~690 registros, una sola página.
