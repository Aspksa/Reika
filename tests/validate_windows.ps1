# Saved as UTF-8 with BOM for Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
foreach ($Name in @('scripts\start.ps1', 'scripts\tray.ps1', 'tests\verify_bootstrap_windows.ps1')) {
    $ScriptFile = Join-Path $ProjectRoot $Name
    $Tokens = $null
    $ParseErrors = $null
    [Management.Automation.Language.Parser]::ParseFile($ScriptFile, [ref]$Tokens, [ref]$ParseErrors) | Out-Null
    if ($ParseErrors.Count -gt 0) {
        throw ($ParseErrors | Out-String)
    }
    $Bytes = [IO.File]::ReadAllBytes($ScriptFile)
    if ($Bytes[0] -ne 239 -or $Bytes[1] -ne 187 -or $Bytes[2] -ne 191) {
        throw ('Missing UTF-8 BOM: ' + $Name)
    }
}
Write-Host 'Windows PowerShell: scripts parsed successfully.'
