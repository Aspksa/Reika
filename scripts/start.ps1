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

function Install-EmbeddedPython {
    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'Автоматическая установка поддерживает Windows x64. Установите Python 3.10+ вручную.'
    }

    $RuntimeRoot = Join-Path $ProjectRoot '.runtime'
    $RuntimePath = Join-Path $RuntimeRoot 'python'
    $RuntimeExecutable = Join-Path $RuntimePath 'python.exe'
    [IO.Directory]::CreateDirectory($RuntimeRoot) | Out-Null

    # A named mutex prevents two launchers from replacing the runtime simultaneously.
    $Sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $RootHash = [BitConverter]::ToString(
            $Sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($ProjectRoot.ToLowerInvariant()))
        ).Replace('-', '')
    } finally {
        $Sha256.Dispose()
    }
    $Mutex = New-Object System.Threading.Mutex($false, ('Local\ReikaPython-' + $RootHash))
    $HasLock = $false
    try {
        try {
            $HasLock = $Mutex.WaitOne(120000)
        } catch [System.Threading.AbandonedMutexException] {
            $HasLock = $true
        }
        if (-not $HasLock) {
            throw 'Не удалось дождаться завершения установки Python в другом окне Reika.'
        }
        if ((Test-Path -LiteralPath $RuntimeExecutable -PathType Leaf) -and
            (Test-Python -Executable $RuntimeExecutable -Prefix @())) {
            return $RuntimeExecutable
        }

        if ($env:REIKA_NO_PYTHON_DOWNLOAD -eq '1' -and
            [string]::IsNullOrWhiteSpace($env:REIKA_PYTHON_ARCHIVE)) {
            throw 'Python не найден, автоматическая загрузка отключена. Скачайте готовый архив в GitHub Releases.'
        }

        # Same official archive and pinned SHA-256 as scripts/package_release.py.
        $Version = '3.12.10'
        $ArchiveName = 'python-' + $Version + '-embed-amd64.zip'
        $DownloadUrl = 'https://www.python.org/ftp/python/' + $Version + '/' + $ArchiveName
        $ExpectedHash = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'
        $Id = [Guid]::NewGuid().ToString('N')
        $ArchiveFile = Join-Path $RuntimeRoot ('.python-' + $Id + '.zip')
        $StagePath = Join-Path $RuntimeRoot ('.python-stage-' + $Id)
        $BackupPath = $null
        try {
            if (-not [string]::IsNullOrWhiteSpace($env:REIKA_PYTHON_ARCHIVE)) {
                Write-Host '◈ Проверка локального архива Python...' -ForegroundColor Cyan
                Copy-Item -LiteralPath $env:REIKA_PYTHON_ARCHIVE -Destination $ArchiveFile -ErrorAction Stop
            } else {
                Write-Host '↻ Python не найден. Загружаю официальный Python 3.12.10 (Windows x64)...' -ForegroundColor Yellow
                [Net.ServicePointManager]::SecurityProtocol = (
                    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
                )
                try {
                    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ArchiveFile -UseBasicParsing -TimeoutSec 90 -ErrorAction Stop | Out-Null
                } catch {
                    throw ('Не удалось загрузить Python с python.org: ' + $_.Exception.Message +
                        '. Проверьте интернет или скачайте готовый Reika-X.Y.Z.zip из GitHub Releases.')
                }
            }

            if ((Get-Item -LiteralPath $ArchiveFile).Length -gt 16MB) {
                throw 'Архив Python превышает ожидаемый размер.'
            }
            $ActualHash = (Get-FileHash -LiteralPath $ArchiveFile -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($ActualHash -ne $ExpectedHash) {
                throw 'SHA-256 архива Python не совпадает с официальной закреплённой суммой. Установка отменена.'
            }
            [IO.Directory]::CreateDirectory($StagePath) | Out-Null
            Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
            [IO.Compression.ZipFile]::ExtractToDirectory($ArchiveFile, $StagePath)
            foreach ($FileName in @('python.exe', 'python312.dll', 'python312.zip', 'python312._pth', 'LICENSE.txt')) {
                if (-not (Test-Path -LiteralPath (Join-Path $StagePath $FileName) -PathType Leaf)) {
                    throw ('В архиве Python отсутствует ' + $FileName)
                }
            }
            # The embedded interpreter is isolated; add the Reika project root to its search path.
            [IO.File]::AppendAllText((Join-Path $StagePath 'python312._pth'), "`r`n..\..`r`n", $Utf8)
            if (-not (Test-Python -Executable (Join-Path $StagePath 'python.exe') -Prefix @())) {
                throw 'Загруженный Python не прошёл проверку версии и стандартных модулей.'
            }
            if (Test-Path -LiteralPath $RuntimePath) {
                $BackupPath = Join-Path $RuntimeRoot ('python.previous-' + $Id)
                Move-Item -LiteralPath $RuntimePath -Destination $BackupPath -ErrorAction Stop
                Write-StartupLog ('Нерабочий Python сохранён в ' + $BackupPath)
            }
            try {
                Move-Item -LiteralPath $StagePath -Destination $RuntimePath -ErrorAction Stop
            } catch {
                if ($BackupPath -and -not (Test-Path -LiteralPath $RuntimePath)) {
                    Move-Item -LiteralPath $BackupPath -Destination $RuntimePath -ErrorAction SilentlyContinue
                }
                throw
            }
            Write-StartupLog ('Подготовлен автономный Python ' + $Version)
            Write-Host '✓ Автономный Python готов. Продолжаю запуск Reika.' -ForegroundColor Green
            return $RuntimeExecutable
        } finally {
            Remove-Item -LiteralPath $ArchiveFile -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $StagePath -Recurse -Force -ErrorAction SilentlyContinue
        }
    } finally {
        if ($HasLock) { $Mutex.ReleaseMutex() }
        $Mutex.Dispose()
    }
}

try {
    Set-Location -LiteralPath $ProjectRoot
    $VersionRegistry = [IO.File]::ReadAllText((Join-Path $ProjectRoot 'versions.json'), $Utf8) | ConvertFrom-Json
    Write-Host ('✦ Рэйка Амацухара · v' + $VersionRegistry.project + ' · Подготовка') -ForegroundColor Magenta
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
        $LocalExecutable = Install-EmbeddedPython
        $SelectedPython = [PSCustomObject]@{ Executable = $LocalExecutable; Prefix = @() }
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
