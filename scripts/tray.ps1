# Saved as UTF-8 with BOM for Windows PowerShell 5.1.
param(
    [Parameter(Mandatory = $true)][string]$MarkerPath,
    [Parameter(Mandatory = $true)][string]$LogsPath
)

$ErrorActionPreference = 'Stop'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$ReikaUrl = $env:REIKA_URL
$ControlToken = $env:REIKA_CONTROL_TOKEN
$InstanceId = $env:REIKA_INSTANCE_ID
$ConsoleWindow = [IntPtr]::new([Int64]$env:REIKA_CONSOLE_HANDLE)
Remove-Item Env:\REIKA_CONTROL_TOKEN -ErrorAction SilentlyContinue
if ($ReikaUrl -notmatch '^http://127\.0\.0\.1:[0-9]+$' -or [string]::IsNullOrEmpty($ControlToken)) {
    throw 'Недопустимые параметры трея.'
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ReikaWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
'@

function Invoke-ReikaRequest([string]$Route, [string]$Method = 'GET') {
    $Request = [Net.HttpWebRequest]::Create($ReikaUrl + $Route)
    $Request.Proxy = $null
    $Request.Timeout = 1500
    $Request.ReadWriteTimeout = 1500
    $Request.Method = $Method
    if ($Method -eq 'POST') {
        $Request.Headers.Add('X-Reika-Token', $ControlToken)
        $Request.ContentLength = 0
    }
    $Response = $null
    $Reader = $null
    try {
        $Response = $Request.GetResponse()
        $Reader = New-Object IO.StreamReader($Response.GetResponseStream(), $Utf8)
        return ($Reader.ReadToEnd() | ConvertFrom-Json)
    } finally {
        if ($null -ne $Reader) { $Reader.Dispose() }
        if ($null -ne $Response) { $Response.Dispose() }
    }
}

[Windows.Forms.Application]::EnableVisualStyles()
$Tray = New-Object Windows.Forms.NotifyIcon
$Menu = New-Object Windows.Forms.ContextMenuStrip
$Timer = New-Object Windows.Forms.Timer
$Bitmap = New-Object Drawing.Bitmap(32, 32)
$Canvas = [Drawing.Graphics]::FromImage($Bitmap)
$Canvas.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$BackgroundBrush = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#743E56'))
$MoonBrush = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#F4DFBA'))
$Canvas.FillEllipse($BackgroundBrush, 0, 0, 31, 31)
$Canvas.FillEllipse($MoonBrush, 6, 5, 20, 20)
$Canvas.FillEllipse($BackgroundBrush, 13, 3, 17, 17)
$IconHandle = $Bitmap.GetHicon()
$Icon = [Drawing.Icon]::FromHandle($IconHandle)
$Tray.Icon = $Icon
$Tray.Text = 'Рэйка Амацухара · Reika'

$OpenItem = $Menu.Items.Add('Открыть Reika')
$OpenItem.Add_Click({ Start-Process -FilePath $ReikaUrl })
$Menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator)) | Out-Null
$ShowItem = $Menu.Items.Add('Показать консоль')
$ShowItem.Add_Click({
    if ($ConsoleWindow -ne [IntPtr]::Zero) {
        [ReikaWindow]::ShowWindowAsync($ConsoleWindow, 9) | Out-Null
        [ReikaWindow]::SetForegroundWindow($ConsoleWindow) | Out-Null
    }
})
$HideItem = $Menu.Items.Add('Свернуть в трей')
$HideItem.Add_Click({
    if ($ConsoleWindow -ne [IntPtr]::Zero) {
        [ReikaWindow]::ShowWindowAsync($ConsoleWindow, 0) | Out-Null
    }
})
$LogsItem = $Menu.Items.Add('Открыть журналы')
$LogsItem.Add_Click({ Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $LogsPath + '"') })
$Menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator)) | Out-Null
$ExitItem = $Menu.Items.Add('Завершить Reika')
$ExitItem.Add_Click({
    try {
        Invoke-ReikaRequest -Route '/api/shutdown' -Method 'POST' | Out-Null
        $ExitItem.Enabled = $false
        $ExitItem.Text = 'Завершение…'
    } catch {
        $Tray.ShowBalloonTip(4000, 'Не удалось завершить Reika', 'Откройте консоль и нажмите Ctrl+C.', [Windows.Forms.ToolTipIcon]::Warning)
        [ReikaWindow]::ShowWindowAsync($ConsoleWindow, 9) | Out-Null
    }
})
$Tray.ContextMenuStrip = $Menu
$Tray.Add_DoubleClick({ Start-Process -FilePath $ReikaUrl })
$script:MissedChecks = 0
$Timer.Interval = 2000
$Timer.Add_Tick({
    if (Test-Path -LiteralPath ($MarkerPath + '.stop')) {
        [Windows.Forms.Application]::Exit()
        return
    }
    try {
        $State = Invoke-ReikaRequest -Route '/api/status'
        if ($State.instance_id -ne $InstanceId) { throw 'Другой экземпляр сервера.' }
        $script:MissedChecks = 0
    } catch {
        $script:MissedChecks++
        if ($script:MissedChecks -ge 3) { [Windows.Forms.Application]::Exit() }
    }
})

try {
    $Tray.Visible = $true
    $Timer.Start()
    [IO.File]::WriteAllText(($MarkerPath + '.ready'), 'ready', $Utf8)
    [Windows.Forms.Application]::Run()
} finally {
    $Timer.Stop()
    $Tray.Visible = $false
    $Tray.Dispose()
    $Timer.Dispose()
    $Menu.Dispose()
    $Icon.Dispose()
    [ReikaWindow]::DestroyIcon($IconHandle) | Out-Null
    $Canvas.Dispose()
    $Bitmap.Dispose()
    $BackgroundBrush.Dispose()
    $MoonBrush.Dispose()
    Remove-Item -LiteralPath ($MarkerPath + '.ready') -Force -ErrorAction SilentlyContinue
}
