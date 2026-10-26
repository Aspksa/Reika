# Saved as UTF-8 with BOM for Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TempRoot = Join-Path ([IO.Path]::GetTempPath()) ('Reika Windows bootstrap ' + [Guid]::NewGuid().ToString('N'))
$SourceArchive = Join-Path $TempRoot 'source.zip'
$TargetRoot = Join-Path $TempRoot 'Рэйка & ! (без Python)'
$PreviousForce = $env:REIKA_PYTHON_FORCE_BOOTSTRAP
$PreviousArchive = $env:REIKA_PYTHON_ARCHIVE
$PreviousDisable = $env:REIKA_NO_PYTHON_DOWNLOAD
try {
    [IO.Directory]::CreateDirectory($TempRoot) | Out-Null
    [IO.Directory]::CreateDirectory($TargetRoot) | Out-Null
    & git -C $ProjectRoot archive --format=zip ('-o=' + $SourceArchive) HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать архив исходников для проверки.' }
    Expand-Archive -LiteralPath $SourceArchive -DestinationPath $TargetRoot -Force
    $env:REIKA_PYTHON_FORCE_BOOTSTRAP = '1'
    Remove-Item Env:\REIKA_PYTHON_ARCHIVE -ErrorAction SilentlyContinue
    Remove-Item Env:\REIKA_NO_PYTHON_DOWNLOAD -ErrorAction SilentlyContinue

    $Launcher = Join-Path $TargetRoot 'Reika.bat'
    & $Launcher --check --no-browser --no-tray
    if ($LASTEXITCODE -ne 0) {
        throw ('Reika.bat завершился с кодом ' + $LASTEXITCODE + ' при автоматической подготовке Python.')
    }
    $EmbeddedPython = Join-Path $TargetRoot '.runtime\python\python.exe'
    if (-not (Test-Path -LiteralPath $EmbeddedPython -PathType Leaf)) {
        throw 'После автоматической установки отсутствует встроенный Python.'
    }
    $StartupLog = [IO.File]::ReadAllText((Join-Path $TargetRoot 'logs\startup.log'))
    if (-not $StartupLog.Contains('Подготовлен автономный Python 3.12.10')) {
        throw 'В журнале нет подтверждения автоматической установки Python.'
    }

    # A second launch must use the existing verified runtime without downloading again.
    $env:REIKA_NO_PYTHON_DOWNLOAD = '1'
    & $Launcher --check --no-browser --no-tray
    if ($LASTEXITCODE -ne 0) { throw 'Повторный автономный запуск не прошёл.' }
    Write-Host 'Windows: автоматическая установка Python и повторный автономный запуск прошли.'
} finally {
    if ($null -eq $PreviousForce) { Remove-Item Env:\REIKA_PYTHON_FORCE_BOOTSTRAP -ErrorAction SilentlyContinue }
    else { $env:REIKA_PYTHON_FORCE_BOOTSTRAP = $PreviousForce }
    if ($null -eq $PreviousArchive) { Remove-Item Env:\REIKA_PYTHON_ARCHIVE -ErrorAction SilentlyContinue }
    else { $env:REIKA_PYTHON_ARCHIVE = $PreviousArchive }
    if ($null -eq $PreviousDisable) { Remove-Item Env:\REIKA_NO_PYTHON_DOWNLOAD -ErrorAction SilentlyContinue }
    else { $env:REIKA_NO_PYTHON_DOWNLOAD = $PreviousDisable }
    Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
