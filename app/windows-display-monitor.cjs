'use strict';
// One hidden, read-only Win32 watcher. No per-tick process launches or native binaries.
const { spawn } = require('node:child_process');
const path = require('node:path');
const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PetDisplayProbe {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT monitor, work; public int flags; }
  [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO info);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", EntryPoint="GetWindowLong")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
  public static void Init() { try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { } }
  public static int CursorHidden() {
    var info = new CURSORINFO(); info.cbSize = Marshal.SizeOf(info);
    return GetCursorInfo(ref info) ? ((info.flags & 1) == 0 ? 1 : 0) : -1;
  }
  public static bool Fullscreen(int[] ownPids) {
    var hwnd = GetForegroundWindow();
    if (hwnd == IntPtr.Zero || !IsWindowVisible(hwnd) || IsIconic(hwnd)) return false;
    uint pid; GetWindowThreadProcessId(hwnd, out pid);
    foreach (var own in ownPids) if (pid == own) return false;
    var name = new StringBuilder(256); GetClassName(hwnd, name, name.Capacity);
    var cls = name.ToString();
    if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return false;
    var info = new MONITORINFO(); info.cbSize = Marshal.SizeOf(info);
    RECT rect;
    if (!GetWindowRect(hwnd, out rect) || !GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref info)) return false;
    var bounds = info.monitor;
    bool covers = rect.left <= bounds.left + 2 && rect.top <= bounds.top + 2 && rect.right >= bounds.right - 2 && rect.bottom >= bounds.bottom - 2;
    if (!covers) return false;
    // Normal maximized windows (including an auto-hidden taskbar) are not fullscreen.
    int state; bool exclusive = SHQueryUserNotificationState(out state) == 0 && state == 3;
    return exclusive || (GetWindowLong(hwnd, -16) & 0x00C40000) == 0;
  }
}
'@
[PetDisplayProbe]::Init()
$own = [int[]]@($env:CODEX_PET_PROBE_PIDS.Split(',') | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })
$parentPid = [int]$env:CODEX_PET_PROBE_PARENT
while (Get-Process -Id $parentPid -ErrorAction SilentlyContinue) {
  $cursor = [PetDisplayProbe]::CursorHidden()
  @{fullscreen=[PetDisplayProbe]::Fullscreen($own);cursorHidden=($cursor -eq 1);cursorKnown=($cursor -ge 0)} | ConvertTo-Json -Compress
  Start-Sleep -Milliseconds 150
}
`;
const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
function parseProbeLine(line) {
  try {
    const value = JSON.parse(line);
    if (typeof value.fullscreen !== 'boolean' || typeof value.cursorHidden !== 'boolean' || typeof value.cursorKnown !== 'boolean') return null;
    return { fullscreen: value.fullscreen, cursorHidden: value.cursorKnown && value.cursorHidden };
  } catch { return null; }
}
function createDisplayMonitor({ onChange = () => {}, onError = () => {}, ownPids = [], platform = process.platform, spawnProcess = spawn } = {}) {
  let child = null, retry = null, stopped = true, lastAt = 0, startedAt = 0;
  let state = { fullscreen: false, cursorHidden: false };
  function publish(next) {
    const changed = state.fullscreen !== next.fullscreen || state.cursorHidden !== next.cursorHidden;
    state = next;
    if (changed) onChange({ ...state });
  }
  function launch() {
    if (stopped || platform !== 'win32' || child) return;
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const proc = spawnProcess(powershell, ['-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',encodedCommand], {
      windowsHide: true, stdio: ['ignore','pipe','pipe'],
      env: { ...process.env, CODEX_PET_PROBE_PARENT: String(process.pid), CODEX_PET_PROBE_PIDS: [process.pid, ...ownPids].filter(Number.isInteger).join(',') }
    });
    child = proc; startedAt = Date.now();
    let buffer = '', errors = '', ended = false;
    proc.stdout.on('data', data => {
      buffer += data.toString('utf8');
      const lines = buffer.split(/\r?\n/); buffer = lines.pop().slice(-4096);
      for (const line of lines) { const next = parseProbeLine(line); if (next && !stopped && child === proc) { lastAt = Date.now(); publish(next); } }
    });
    proc.stderr.on('data', data => { errors = (errors + data.toString()).slice(-1000); });
    const failed = error => {
      if (ended) return; ended = true;
      if (child === proc) child = null;
      if (stopped) return;
      lastAt = 0; publish({ fullscreen: false, cursorHidden: false });
      onError(error?.message || errors || 'Windows 显示检测暂不可用');
      retry = setTimeout(launch, 60000); retry.unref?.();
    };
    proc.once('error', failed); proc.once('exit', () => failed());
  }
  return {
    start() { if (!stopped) return; stopped = false; launch(); },
    stop() { stopped = true; clearTimeout(retry); retry = null; const proc = child; child = null; if (proc) proc.kill(); lastAt = 0; publish({ fullscreen: false, cursorHidden: false }); },
    current() {
      const stale = child && Date.now() - (lastAt || startedAt) > (lastAt ? 3000 : 15000);
      if (stale) { lastAt = 0; publish({ fullscreen: false, cursorHidden: false }); child?.kill(); }
      return { ...state };
    }
  };
}
module.exports = { createDisplayMonitor, parseProbeLine };
