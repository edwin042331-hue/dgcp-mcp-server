# mapear-endpoints.ps1
# Descarga un registro real de cada endpoint y muestra sus campos.
# Sirve para mapear /contratos, /ofertas y /proveedores, que aun no lo estan.

$ErrorActionPreference = "Continue"
$base = "https://datosabiertos.dgcp.gob.do/api-dgcp/v1"
$destino = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) "esquema-endpoints.txt"
$buffer = @()

foreach ($ep in @("procesos","contratos","ofertas","proveedores")) {
    $uri = "$base/$ep" + "?page=1&limit=1"
    Write-Host ""
    Write-Host "=== /$ep ===" -ForegroundColor Cyan
    $buffer += ""
    $buffer += "=== /$ep ==="
    try {
        $r = Invoke-WebRequest -Uri $uri -Headers @{Accept="application/json"} -TimeoutSec 25 -UseBasicParsing
        $j = $r.Content | ConvertFrom-Json
        $linea = "totalResults: $($j.totalResults) | pages: $($j.pages)"
        Write-Host $linea
        $buffer += $linea

        $reg = $j.payload.content[0]
        if ($null -eq $reg) {
            Write-Host "Sin registros." -ForegroundColor Yellow
            $buffer += "Sin registros."
            continue
        }
        foreach ($campo in $reg.PSObject.Properties) {
            $tipo = if ($null -eq $campo.Value) { "null" } else { $campo.Value.GetType().Name }
            $val  = "$($campo.Value)"
            if ($val.Length -gt 70) { $val = $val.Substring(0,70) + "..." }
            $linea = ("  {0,-34} {1,-8} = {2}" -f $campo.Name, $tipo, $val)
            Write-Host $linea
            $buffer += $linea
        }
    } catch {
        $linea = "ERROR: $($_.Exception.Message)"
        Write-Host $linea -ForegroundColor Red
        $buffer += $linea
    }
}

$buffer | Set-Content $destino -Encoding UTF8
Write-Host ""
Write-Host "Guardado en: $destino" -ForegroundColor Green
