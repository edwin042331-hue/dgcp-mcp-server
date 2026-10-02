# instalar.ps1 - Instala el servidor MCP DGCP en esta PC.
# No asume ninguna ruta ni nombre de usuario: usa la carpeta donde esta este script.
# Uso:  powershell -ExecutionPolicy Bypass -File .\instalar.ps1

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host ""
Write-Host "=== Instalador servidor MCP DGCP ===" -ForegroundColor Cyan
Write-Host "Carpeta del servidor: $raiz"
Write-Host ""

# --- 1. Node ---------------------------------------------------------------
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "ERROR: Node.js no esta instalado o no esta en el PATH." -ForegroundColor Red
    Write-Host "Instalalo desde https://nodejs.org (version 18 o superior) y vuelve a correr este script."
    exit 1
}
$nodeExe = $nodeCmd.Source
$nodeVer = (& $nodeExe --version)
Write-Host "Node encontrado: $nodeVer" -ForegroundColor Green
Write-Host "Ejecutable: $nodeExe"

$major = [int](($nodeVer -replace '^v','') -split '\.')[0]
if ($major -lt 18) {
    Write-Host "ERROR: se necesita Node 18 o superior. Tienes $nodeVer." -ForegroundColor Red
    exit 1
}

# --- 2. Dependencias -------------------------------------------------------
Write-Host ""
Write-Host "Instalando dependencias (npm install)..." -ForegroundColor Cyan
Push-Location $raiz
try {
    & npm install --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { throw "npm install fallo con codigo $LASTEXITCODE" }

    Write-Host "Compilando TypeScript..." -ForegroundColor Cyan
    & npx tsc
    if ($LASTEXITCODE -ne 0) { throw "La compilacion fallo con codigo $LASTEXITCODE" }
} finally {
    Pop-Location
}

$entrada = Join-Path $raiz "dist\index.js"
if (-not (Test-Path $entrada)) {
    Write-Host "ERROR: no se genero dist\index.js" -ForegroundColor Red
    exit 1
}
Write-Host "Compilado OK: $entrada" -ForegroundColor Green

# --- 3. Prueba de arranque -------------------------------------------------
Write-Host ""
Write-Host "Probando que el servidor arranca..." -ForegroundColor Cyan
try {
    $proc = Start-Process -FilePath $nodeExe -ArgumentList $entrada -NoNewWindow -PassThru -RedirectStandardError "startup_err.log"
    Start-Sleep -Seconds 1
    if (-not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force
    }
    $salida = if (Test-Path "startup_err.log") { Get-Content "startup_err.log" -Raw } else { "" }
    Remove-Item "startup_err.log" -ErrorAction SilentlyContinue
    if ($salida -match "DGCP") {
        Write-Host "El servidor arranca correctamente." -ForegroundColor Green
    } else {
        Write-Host "Aviso en arranque: $salida" -ForegroundColor Yellow
    }
} catch {
    Write-Host "Aviso al probar arranque: $($_.Exception.Message)" -ForegroundColor Yellow
}

# --- 4. Prueba de conexion a la API ---------------------------------------
Write-Host ""
Write-Host "Probando conexion a la API de la DGCP..." -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "https://datosabiertos.dgcp.gob.do/api-dgcp/v1/procesos?page=1&limit=1" `
                           -Headers @{Accept="application/json"} -TimeoutSec 20 -UseBasicParsing
    $j = $r.Content | ConvertFrom-Json
    Write-Host ("API OK. Procesos disponibles: " + $j.totalResults) -ForegroundColor Green
} catch {
    Write-Host "AVISO: no se pudo conectar a la API DGCP desde esta red." -ForegroundColor Yellow
    Write-Host "  $($_.Exception.Message)"
    Write-Host "  Si estas en una red corporativa con proxy o firewall, el servidor"
    Write-Host "  quedara instalado pero no podra consultar datos hasta resolverlo."
}

# --- 5. Configuracion -------------------------------------------------------
function Merge-McpConfig {
    param([string]$ruta, [hashtable]$entradaServidor, [string]$etiqueta)

    $dir = Split-Path -Parent $ruta
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    if (Test-Path $ruta) {
        Copy-Item $ruta "$ruta.bak" -Force
        try { $cfg = Get-Content $ruta -Raw | ConvertFrom-Json } catch { $cfg = [PSCustomObject]@{} }
    } else {
        $cfg = [PSCustomObject]@{}
    }

    if (-not $cfg.PSObject.Properties.Name.Contains("mcpServers")) {
        $cfg | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue ([PSCustomObject]@{}) -Force
    }
    $cfg.mcpServers | Add-Member -NotePropertyName "dgcp" `
        -NotePropertyValue ([PSCustomObject]$entradaServidor) -Force

    $cfg | ConvertTo-Json -Depth 10 | Set-Content $ruta -Encoding UTF8
    Write-Host "$etiqueta configurado: $ruta" -ForegroundColor Green
}

$entradaServidor = @{
    command = $nodeExe
    args    = @($entrada)
    cwd     = $raiz
}

Write-Host ""
Write-Host "Configurando clientes..." -ForegroundColor Cyan

# Claude Desktop
$claudeCfg = Join-Path $env:APPDATA "Claude\claude_desktop_config.json"
if (Test-Path (Split-Path -Parent $claudeCfg)) {
    Merge-McpConfig -ruta $claudeCfg -entradaServidor $entradaServidor -etiqueta "Claude Desktop"
} else {
    Write-Host "Claude Desktop no detectado. Se omite." -ForegroundColor DarkGray
}

# Gemini CLI
$geminiDir = Join-Path $env:USERPROFILE ".gemini"
$geminiCfg = Join-Path $geminiDir "settings.json"
$entradaGemini = $entradaServidor.Clone()
$entradaGemini["timeout"] = 60000
$entradaGemini["trust"]   = $true
Merge-McpConfig -ruta $geminiCfg -entradaServidor $entradaGemini -etiqueta "Gemini CLI"


# --- 6. Resumen -------------------------------------------------------------
Write-Host ""
Write-Host "=== LISTO ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Servidor:  $entrada"
Write-Host "Node:      $nodeExe"
Write-Host ""
Write-Host "Siguiente paso:"
Write-Host "  - Claude Desktop: cierralo por completo y vuelve a abrirlo."
Write-Host "  - Gemini CLI:     abre 'gemini' y escribe /mcp para ver el servidor dgcp."
Write-Host ""
Write-Host "Prueba: 'Que licitaciones de tecnologia estan abiertas ahora mismo?'"
Write-Host ""
