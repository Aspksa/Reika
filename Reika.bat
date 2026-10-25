@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul 2>&1
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
set "REIKA_EXIT_CODE=%ERRORLEVEL%"
if not "%REIKA_EXIT_CODE%"=="0" pause >nul
exit /b %REIKA_EXIT_CODE%
