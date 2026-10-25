# Saved as UTF-8 with BOM for Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ForwardArguments = @($args)
$Utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8
[Console]::InputEncoding = $Utf8
$OutputEncoding = $Utf8
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

function Show-StartupConsole {
    try {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ReikaStartupWindow {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
}
'@
        [ReikaStartupWindow]::ShowWindowAsync([ReikaStartupWindow]::GetConsoleWindow(), 9) | Out-Null
    } catch {
    }
}

function Write-StartupLog([string]$Text) {
    try {
        $LogDirectory = Join-Path $ProjectRoot 'logs'
        [IO.Directory]::CreateDirectory($LogDirectory) | Out-Null
        $LogFile = Join-Path $LogDirectory 'startup.log'
        if ((Test-Path -LiteralPath $LogFile) -and (Get-Item -LiteralPath $LogFile).Length -gt 1MB) {
            Move-Item -LiteralPath $LogFile -Destination ($LogFile + '.1') -Force
        }
        [IO.File]::AppendAllText($LogFile, ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $Text + [Environment]::NewLine), $Utf8)
    } catch {
        # A log-sharing conflict must not prevent a second launch.
    }
}

function Test-Python([string]$Executable, [string[]]$Prefix) {
    $Probe = New-Object System.Diagnostics.Process
    try {
        $Probe.StartInfo.FileName = $Executable
        $PrefixText = ($Prefix -join ' ')
        $ProbeCode = "import sys,http.server,socket,ctypes,ssl,json; print(sys.version.split()[0]); sys.exit(0 if sys.version_info >= (3,10) else 3)"
        $Probe.StartInfo.Arguments = $PrefixText + ' -X utf8 -c "' + $ProbeCode + '"'
        $Probe.StartInfo.UseShellExecute = $false
        $Probe.StartInfo.CreateNoWindow = $true
        $Probe.StartInfo.RedirectStandardOutput = $true
        $Probe.StartInfo.RedirectStandardError = $true
        if (-not $Probe.Start()) { return $false }
        if (-not $Probe.WaitForExit(5000)) {
            $Probe.Kill()
            return $false
        }
        $Version = $Probe.StandardOutput.ReadToEnd().Trim()
        if ($Probe.ExitCode -ne 0) { return $false }
        Write-StartupLog ('Python ' + $Version + ': ' + $Executable)
        return $true
    } catch {
        return $false
    } finally {
        $Probe.Dispose()
    }
}

try {
    Set-Location -LiteralPath $ProjectRoot
    Write-Host '✦ Рэйка Амацухара · Подготовка' -ForegroundColor Magenta
    Write-StartupLog 'Подготовка запуска Reika.'
    $Candidates = @()
    foreach ($RelativePath in @('.runtime\python\python.exe', '.venv\Scripts\python.exe')) {
        $LocalPython = Join-Path $ProjectRoot $RelativePath
        if (Test-Path -LiteralPath $LocalPython -PathType Leaf) {
            $Candidates += [PSCustomObject]@{ Executable = $LocalPython; Prefix = @() }
        }
    }
    foreach ($CommandName in @('py.exe', 'python.exe', 'python3.exe')) {
        $Command = Get-Command $CommandName -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $Command) {
            $PythonPrefix = @()
            if ($CommandName -eq 'py.exe') { $PythonPrefix = @('-3') }
            $Candidates += [PSCustomObject]@{ Executable = $Command.Source; Prefix = $PythonPrefix }
        }
    }
    $SelectedPython = $null
    foreach ($Candidate in $Candidates) {
        if (Test-Python -Executable $Candidate.Executable -Prefix $Candidate.Prefix) {
            $SelectedPython = $Candidate
            break
        }
    }
    if ($null -eq $SelectedPython) {
        throw 'Не найден рабочий Python 3.10 или новее. Установите Python с https://www.python.org/downloads/windows/ или распакуйте официальный embedded Python в .runtime\python. После установки снова запустите Reika.bat.'
    }
    $RunArguments = @($SelectedPython.Prefix) + @('-X', 'utf8', '-B', (Join-Path $ProjectRoot 'run.py')) + $ForwardArguments
    & $SelectedPython.Executable @RunArguments
    $RunExitCode = $LASTEXITCODE
    if ($RunExitCode -ne 0) {
        Show-StartupConsole
        Write-StartupLog ('Reika завершилась с кодом ' + $RunExitCode)
        Write-Host '✕ Reika завершилась с ошибкой. Журналы находятся в папке logs.' -ForegroundColor Red
        Write-Host 'Нажмите любую клавишу, чтобы закрыть окно.'
    }
    exit $RunExitCode
} catch {
    Show-StartupConsole
    Write-StartupLog ('Ошибка: ' + $_.Exception.Message)
    Write-Host ('✕ ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Нажмите любую клавишу, чтобы закрыть окно.'
    exit 1
}
