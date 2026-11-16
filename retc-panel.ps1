param(
  [int]$Port = 4791,
  [int]$Width = 460,
  [int]$Height = 940,
  [switch]$NoTopMost
)

$ErrorActionPreference = "Stop"
$url = "http://127.0.0.1:$Port/"

try {
  $null = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/health" -TimeoutSec 3
} catch {
  Write-Host "retc 面板没有在 $Port 端口响应。" -ForegroundColor Yellow
  Write-Host "请确认 OpenCode 已完全重启，并且 opencode.json 的 plugin 里有 retc。" -ForegroundColor Yellow
  exit 1
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
} catch {
  $area = $null
}
if ($area) {
  $posX = [Math]::Max(0, $area.Right - $Width - 12)
  $posY = $area.Top + 24
} else {
  $posX = 1200
  $posY = 60
}

$edge = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $edge) {
  Write-Host "没找到 Edge，用默认浏览器打开。" -ForegroundColor Yellow
  Start-Process $url
  exit 0
}

$proc = Start-Process -FilePath $edge -ArgumentList "--app=$url", "--window-size=$Width,$Height", "--window-position=$posX,$posY", "--disable-features=msEdgeSidebarV2" -PassThru

if ($NoTopMost) { exit 0 }

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RetcWin32 {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
"@
$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 200
  $win = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*retc*" } | Select-Object -First 1
  if ($win) { $hwnd = $win.MainWindowHandle; break }
}
if ($hwnd -ne [IntPtr]::Zero) {
  [RetcWin32]::SetWindowPos($hwnd, [IntPtr](-1), $posX, $posY, $Width, $Height, 0x0040) | Out-Null
}
