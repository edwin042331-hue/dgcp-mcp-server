# Guía de Contribución al Servidor MCP DGCP

¡Bienvenido a la iniciativa comunitaria de datos abiertos y contrataciones públicas de la República Dominicana!

Este proyecto tiene como objetivo **centralizar, transparentar y poner al alcance de la ciudadanía y los desarrolladores dominicanos la información del Sistema Nacional de Compras y Contrataciones Públicas (DGCP)** mediante el estándar oficial del **Model Context Protocol (MCP)**.

---

## 🛡️ Política de Contribución mediante Pull Requests (PR)

Para preservar la estabilidad, seguridad y exactitud legal de la suite, **la rama `main` está protegida**. Nadie puede subir código directamente a `main`. Todas las mejoras se integran mediante **Pull Requests**.

### Reglas Clave para que tu PR sea Aprobado:

1. **TypeScript Estricto:** Todo código nuevo debe estar en TypeScript con esquemas de validación Zod.
2. **Pruebas Obligatorias:** Cada herramienta o corrección de bug debe incluir sus respectivas pruebas en la carpeta `tests/`.
3. **CI en Verde:** GitHub Actions ejecutará automáticamente `npm test` y `npm run build` en tu PR. Si alguna prueba falla, el PR no podrá ser integrado.
4. **Respeto a la API Oficial:** La API de la DGCP (`https://datosabiertos.dgcp.gob.do/api-dgcp/v1`) no filtra del lado del servidor. Toda lógica de ordenamiento y filtrado debe realizarse en el cliente local con manejo de caché y concurrencia.
5. **Rigor Normativo:** Si agregas funciones jurídicas, debes citar la base legal oficial (Ley 340-06, Decreto 543-12, Decreto 416-23 o Resoluciones vigentes de la DGCP) e incluir la cláusula de advertencia de revisión humana.

---

## 🛠️ Entorno de Desarrollo Local

```bash
# 1. Clona tu fork del repositorio
git clone https://github.com/TU_USUARIO/dgcp-mcp-server.git
cd dgcp-mcp-server

# 2. Instala dependencias
npm install

# 3. Ejecuta las pruebas automatizadas
npm test

# 4. Inicia el inspector visual en tu navegador
npm run inspect

# 5. Compila el proyecto
npm run build
```

---

## 📬 ¿Tienes una idea o encontraste un bug?
Abre un **Issue** en el repositorio describiendo la propuesta o el comportamiento inesperado antes de enviar un cambio grande. ¡Gracias por hacer más transparente a la República Dominicana!
