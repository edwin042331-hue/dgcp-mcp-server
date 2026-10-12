# Guía de Contribución al Servidor MCP DGCP

¡Bienvenido a la iniciativa comunitaria de datos abiertos y contrataciones públicas de la República Dominicana!

Este proyecto tiene como objetivo **centralizar, transparentar y poner al alcance de la ciudadanía y los desarrolladores dominicanos la información del Sistema Nacional de Compras y Contrataciones Públicas (DGCP)** mediante el estándar oficial del **Model Context Protocol (MCP)**.

---

## 🛡️ Política de Contribución mediante Pull Requests (PR)

Para preservar la estabilidad, seguridad y exactitud legal de la suite, **la rama `main` está protegida**. Nadie puede subir código directamente a `main`. Todas las mejoras se integran mediante **Pull Requests**.

### Reglas Clave para que tu PR sea Aprobado:

1. **TypeScript Estricto:** Todo código nuevo debe estar en TypeScript con esquemas de validación Zod.
2. **Pruebas Obligatorias:** Cada herramienta o corrección de bug debe incluir sus respectivas pruebas en la carpeta `tests/`.
3. **CI en Verde:** GitHub Actions ejecuta typecheck, pruebas, compilación y una verificación de arranque del servidor en Node 20, 22 y 24. Si algo falla, el PR no se integra.
4. **Respeto a la API Oficial:** usa los filtros del servidor que la API sí soporta (proceso, RPE, unidad de compra, estado, fechas) a través de `dgcpListar`/`dgcpGet`, que ya aplican límite de tasa (la API corta en 60 peticiones/minuto), reintentos y caché. Nunca llames a `fetch` directamente ni recorras decenas de páginas a ciegas. Lee [docs/API-DGCP.md](docs/API-DGCP.md) antes de tocar la capa de datos.
5. **Fechas:** la API rotula como UTC horas que son de República Dominicana. Usa siempre `parseFechaDGCP` y los formateadores de `src/utils/fechas.ts`; nunca `Date.parse` sobre un campo de la API.
6. **Rigor Normativo:** toda cifra o artículo legal va en `src/normativa.ts`, citando el texto oficial (Ley 47-25, Decreto 52-26, resoluciones de umbrales vigentes; Ley 340-06 solo para el régimen transitorio), con su prueba en `tests/normativa.test.ts` y el aviso de revisión humana.

---

## 🛠️ Entorno de Desarrollo Local

```bash
# 1. Clona tu fork del repositorio
git clone https://github.com/TU_USUARIO/dgcp-mcp-server.git
cd dgcp-mcp-server

# 2. Instala dependencias
npm install

# 3. Verifica tipos y ejecuta las pruebas unitarias (sin red)
npm run check

# 4. Prueba las 17 herramientas contra la API real
npm run smoke:live

# 5. Inspector visual en el navegador
npm run inspect
```

---

## 📬 ¿Tienes una idea o encontraste un bug?
Abre un **Issue** en el repositorio describiendo la propuesta o el comportamiento inesperado antes de enviar un cambio grande. ¡Gracias por hacer más transparente a la República Dominicana!
