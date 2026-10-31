// Restore and activate a Windows Electron GUI by exact executable identity, never by a fuzzy title.
const path = require('node:path');
const { execFile } = require('node:child_process');
const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class PetWindowActivation {
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] static extern IntPtr GetLastActivePopup(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int size);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder title, int size);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  public static uint Pid(IntPtr window) { uint pid; GetWindowThreadProcessId(window, out pid); return pid; }
  public static IntPtr Find(int[] pids) {
    var allowed = new HashSet<int>(pids);
    IntPtr result = IntPtr.Zero;
    int best = -1;
    EnumWindows(delegate(IntPtr window, IntPtr data) {
      if (!allowed.Contains((int)Pid(window)) || GetWindow(window, 4) != IntPtr.Zero) return true;
      // Ignore Electron message-only, tooltip, DevTools and other auxiliary windows.
      var name = new StringBuilder(256);
      GetClassName(window, name, name.Capacity);
      if (name.ToString() != "Chrome_WidgetWin_1" || GetWindowTextLength(window) == 0 ||
          (GetWindowLong(window, -20) & 0x80) != 0) return true;
      var title = new StringBuilder(256);
      GetWindowText(window, title, title.Capacity);
      if (title.ToString().StartsWith("DevTools", StringComparison.OrdinalIgnoreCase)) return true;
      Rect rect;
      if (!GetWindowRect(window, out rect)) return true;
      bool minimized = IsIconic(window);
      if (!minimized && (rect.Right - rect.Left < 250 || rect.Bottom - rect.Top < 180)) return true;
      int score = IsWindowVisible(window) ? 4 : 0;
      if (!minimized) score += 2;
      if (window == GetForegroundWindow()) score += 8;
      if (score > best) { best = score; result = window; }
      return true;
    }, IntPtr.Zero);
    // Keep an existing approval/login/modal dialog in front of its parent.
    if (result != IntPtr.Zero) {
      var popup = GetLastActivePopup(result);
      if (popup != result && IsWindowVisible(popup) && allowed.Contains((int)Pid(popup))) return popup;
    }
    return result;
  }
  public static void Activate(IntPtr window) {
    // Restore a minimized window; preserve maximization for a merely tray-hidden window.
    if (IsIconic(window)) ShowWindowAsync(window, 9);
    else ShowWindowAsync(window, IsZoomed(window) ? 3 : 5);
    if (SetForegroundWindow(window)) return;
    // Windows may deny a background helper foreground access. Join input queues briefly,
    // always detach afterwards, and never synthesize keys or leave the app always-on-top.
    uint unused;
    uint current = GetCurrentThreadId();
    uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out unused);
    uint target = GetWindowThreadProcessId(window, out unused);
    bool joinedForeground = false, joinedTarget = false;
    try {
      if (foreground != 0 && foreground != current) joinedForeground = AttachThreadInput(current, foreground, true);
      if (target != 0 && target != current && target != foreground) joinedTarget = AttachThreadInput(current, target, true);
      SetForegroundWindow(window);
    } finally {
      if (joinedTarget) AttachThreadInput(current, target, false);
      if (joinedForeground) AttachThreadInput(current, foreground, false);
    }
  }
}
'@
$target = [IO.Path]::GetFullPath($env:CODEX_PET_WINDOW_EXE)
$name = [IO.Path]::GetFileNameWithoutExtension($target)
$watch = [Diagnostics.Stopwatch]::StartNew()
$limit = [int]$env:CODEX_PET_WINDOW_WAIT
while ($watch.ElapsedMilliseconds -lt $limit) {
  $ids = @(Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -and [IO.Path]::GetFullPath($_.Path).Equals($target, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
  } | ForEach-Object { $_.Id })
  if ($ids.Count -gt 0) {
    $window = [PetWindowActivation]::Find([int[]]$ids)
    if ($window -ne [IntPtr]::Zero) {
      [PetWindowActivation]::Activate($window)
      Start-Sleep -Milliseconds 120
      if ([PetWindowActivation]::GetForegroundWindow() -eq $window -and
          [PetWindowActivation]::IsWindowVisible($window) -and -not [PetWindowActivation]::IsIconic($window)) {
        @{pid=[PetWindowActivation]::Pid($window);window=$window.ToInt64();visible=$true;minimized=$false;foreground=$true} | ConvertTo-Json -Compress
        exit 0
      }
    }
  }
  Start-Sleep -Milliseconds 180
}
[Console]::Error.WriteLine('Harness window activation timed out')
exit 2
`;
const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
async function activateWindow(executable, env = process.env, waitMs = 18000) {
  if (process.platform !== 'win32') return;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedCommand], {
      env: {...env, CODEX_PET_WINDOW_EXE: executable, CODEX_PET_WINDOW_WAIT: String(waitMs)},
      windowsHide: true, timeout: waitMs + 7000, maxBuffer: 128 * 1024, encoding: 'utf8'
    }, (error, stdout) => {
      if (error) return reject(new Error('Harness 已尝试启动，但未能显示到前台。请检查 Harness 是否正在启动、弹出提示，或与桌宠的管理员权限不同。'));
      try {
        const result = JSON.parse(stdout.trim());
        if (!result.visible || result.minimized || !result.foreground) throw new Error('window not activated');
        resolve(result);
      } catch { reject(new Error('未能确认 Harness 窗口已显示到前台，请重新点击打开。')); }
    });
  });
}
module.exports = { activateWindow };
