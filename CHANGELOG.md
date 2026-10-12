# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [5.0.0] - 2026-10-12

### Corregido
- **"La última licitación" devolvía procesos viejos ya cerrados.** La búsqueda ordenaba por fecha de cierre ascendente sobre una muestra de los 500 procesos más recientes, así que lo primero era lo que cerró hace días. Ahora el orden por defecto es "más reciente publicado primero" y existe `dgcp_ultimas_licitaciones`.
- **Cierres desplazados 4 horas.** La API rotula como UTC (`Z`) horas que son de República Dominicana; un proceso que cierra a las 18:00 se daba por cerrado a las 14:00. Todas las fechas se interpretan y muestran en hora RD.
- **Cuellos de botella por el límite de 60 peticiones/minuto.** Herramientas que descargaban 30-40 páginas por llamada agotaban el cupo y las siguientes consultas esperaban o fallaban. Ahora se usan los filtros del servidor (una consulta exacta en vez de decenas de páginas) con limitador de tasa, reintentos y caché.
- **Auditoría de colusión con falso negativo sistemático.** Buscaba a los oferentes entre los primeros 1,500 proveedores del RPE, que vienen ordenados por RPE ascendente (registros de 2005), y casi nunca encontraba sus fichas. Ahora consulta cada RPE de forma exacta.
- **Radiografía de proveedor y scorecard con datos parciales.** Pasan a consultar todos los contratos por RPE o por código de unidad de compra, en vez de buscar coincidencias en una muestra.
- Una falla de red en la primera página se reportaba como "no hay resultados"; ahora es un error explícito. Las fallas parciales se declaran en la cobertura.
- Procesos con estado "publicado" pero plazo vencido aparecían como abiertos.
- Estados reales de la API sin contemplar (`Sobres estan abriendose`, `Suspendido`).

### Cambiado
- **Marco legal actualizado a la Ley 47-25** (vigente desde enero de 2026), su Reglamento (Decreto 52-26) y los umbrales 2026 (Resolución PNP-03-2026), con régimen transitorio para procesos convocados bajo la Ley 340-06. Se corrigieron afirmaciones que ya no aplican o no tenían base:
  - MIPYMES: sin garantía de seriedad (Art. 175) y con anticipo obligatorio del 30% (Art. 174).
  - Recursos: reconsideración ante la institución y luego jerárquico impropio ante la DGCP, 10 días hábiles cada uno (Arts. 204-208); la cautelar es instancia separada (Art. 211) y los recursos no suspenden el acto (Art. 201).
  - Marcas en especificaciones: Art. 91 P. II; fraccionamiento: Art. 81; plazos mínimos: Art. 101; aclaraciones: Art. 102; pago en 30 días: Art. 148 P. III.
  - El Decreto 416-23 era el reglamento de la Ley 340-06 (no "medidas MIPYME") y quedó derogado; se eliminaron referencias al Decreto 543-12.
  - Se retiraron del simulador recomendaciones sin fuente ("rango ganador 92-96%", "Art. 30 precio temerario").
- `dgcp_buscar_contratos`, `dgcp_buscar_ofertas` y `dgcp_buscar_proveedores` usan filtros exactos del servidor; las instituciones se resuelven a su código oficial.
- `dgcp_inteligencia_proceso` arma un expediente completo: artículos UNSPSC con precios estimados, documentos del pliego, ofertas, adjudicación, historial de la institución y control de legalidad.
- Cada respuesta informa su cobertura y el corte de datos de la DGCP.
- Requiere Node.js 20 o superior.

### Añadido
- `dgcp_ultimas_licitaciones`: lo último publicado, con hora RD y cuenta regresiva.
- `dgcp_oportunidades_para_mi`: licitaciones abiertas que encajan con los rubros UNSPSC registrados de una empresa.
- `dgcp_precios_referencia`: precios unitarios adjudicados por código UNSPSC (mediana y percentiles).
- `dgcp_plan_compras`: Plan Anual de Compras (PACC) de una institución.
- Alertas de proveedores inhabilitados o suspendidos según la lista oficial de la DGCP.
- Auditoría del plazo de convocatoria (Art. 101) en expediente, scorecard y auditor de pliegos.
- Pruebas: 89 unitarias sin red (cliente HTTP, fechas, normativa, forense, servidor MCP) y prueba en vivo de las 17 herramientas (`npm run smoke:live`).
- CI en Node 20, 22 y 24 con verificación de arranque del servidor.
- `docs/API-DGCP.md` con las particularidades verificadas de la API.

### Eliminado
- `genericosTools.ts` (código muerto que no se registraba).
- `LEEME.md` (duplicaba el README), `esquema-endpoints.txt` y `mapear-endpoints.ps1` (reemplazados por `docs/API-DGCP.md`).

## [4.1.0]
Versión inicial publicada.
