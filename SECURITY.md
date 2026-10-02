# Política de Seguridad y Divulgación Responsable

La seguridad de este software de datos abiertos y la protección de los datos de la comunidad es una prioridad absoluta.

## Reporte de Vulnerabilidades

Si descubres una vulnerabilidad de seguridad o un problema de exposición de datos en este repositorio:

1. **NO** abras un Issue público en GitHub.
2. Utiliza la función de [Reporte Privado de Seguridad de GitHub (Security Advisories)](https://github.com/edwin042331-hue/dgcp-mcp-server/security/advisories/new) para que el equipo mantenedor pueda evaluar el informe de manera privada.
3. Incluye una descripción detallada del problema, los pasos para reproducirlo y el impacto potencial.

## Medidas de Seguridad Activas en este Repositorio

- **Secret Scanning & Push Protection:** Activado a nivel de GitHub para bloquear cualquier intento de subir claves privadas, tokens o contraseñas.
- **Dependabot Security Updates:** Monitoreo diario automático de dependencias de NPM para parches de vulnerabilidades conocidas (CVEs).
- **Protección de Rama Principal (`main`):** Requiere revisión de código por Pull Request y paso obligatorio del 100% de las pruebas automatizadas (Vitest) antes de cualquier fusión.
- **Auditoría de Datos Públicos:** El servidor únicamente interactúa con endpoints de solo lectura de la API oficial de datos abiertos de la DGCP. No almacena datos personales ni credenciales de usuario.
