param([switch]$CloseRunning, [switch]$NoBackup)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json
if ($package.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid package version' }
$portable = Join-Path $workspace ('Codex-dafeiyu-v' + $package.version + '-windows-x64')
$source = Join-Path $workspace 'app'
$target = Join-Path $portable 'resources\app'
$exe = Join-Path $portable 'Codex-dafeiyu.exe'
function Assert-Within([string]$Path, [string]$Root) {
  $absolute = [IO.Path]::GetFullPath($Path)
  $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  if (-not $absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Path escaped target: $Path" }
  # A plain file can still escape through a junction in one of its parent directories.
  $boundary = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $cursor = $absolute
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) { Assert-Plain $cursor }
    if ($cursor.Equals($boundary, [StringComparison]::OrdinalIgnoreCase)) { break }
    $cursor = [IO.Path]::GetDirectoryName($cursor)
  }
}
function Assert-Plain([string]$Path) {
  if ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing symlink/junction: $Path" }
}
Assert-Plain $workspace
foreach ($path in @($source, $portable, (Join-Path $portable 'resources'), $target, $exe)) { Assert-Within $path $workspace; Assert-Plain $path }
$changes = @()
foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse) {
  Assert-Plain $file.FullName
  $relative = $file.FullName.Substring($source.Length + 1)
  $destination = Join-Path $target $relative
  Assert-Within $destination $target
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  $oldHash = $null
  if (Test-Path -LiteralPath $destination) { Assert-Plain $destination; $oldHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash }
  if ($hash -ne $oldHash) { $changes += [pscustomobject]@{ relative=$relative; source=$file.FullName; destination=$destination; oldHash=$oldHash; newHash=$hash; remove=$false } }
}
# This one retired module has no remaining source counterpart. Never remove arbitrary user files.
$retired = Join-Path $target 'backend\runtime\codex-reset.mjs'
Assert-Within $retired $target
if (Test-Path -LiteralPath $retired) {
  Assert-Plain $retired
  $changes += [pscustomobject]@{ relative='backend\runtime\codex-reset.mjs'; source=$null; destination=$retired; oldHash=(Get-FileHash -LiteralPath $retired).Hash; newHash=$null; remove=$true }
}
if (-not $changes.Count) { Write-Output 'Local portable program already matches app source.'; exit 0 }
function Running-Portable {
  @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($portable + '\', [StringComparison]::OrdinalIgnoreCase) })
}
if ((Running-Portable).Count) {
  if (-not $CloseRunning) { throw 'Exit the desktop pet first, or pass -CloseRunning to close this exact portable instance gracefully.' }
  # Single-instance --quit shuts down only this product; no broad process-name kills.
  $quit = Start-Process -FilePath $exe -ArgumentList '--quit' -WorkingDirectory $portable -WindowStyle Hidden -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ((Running-Portable).Count -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 400 }
  if ((Running-Portable).Count) { throw 'The local program is still running. Exit it manually and retry; no files were changed.' }
}
if (-not $NoBackup) {
  $backupRoot = Join-Path $workspace 'backups'
  if (Test-Path -LiteralPath $backupRoot) { Assert-Plain $backupRoot }
  $backup = Join-Path $backupRoot ('local-update-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
  Assert-Within $backup $workspace
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  # Back up every existing target before overwriting any file.
  foreach ($change in $changes) {
    if ($change.oldHash) {
      $saved = Join-Path $backup $change.relative
      Assert-Within $saved $backup
      New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($saved)) -Force | Out-Null
      Copy-Item -LiteralPath $change.destination -Destination $saved
    }
  }
  $changes | Select-Object relative,oldHash,newHash,remove | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $backup 'manifest.json') -Encoding utf8
}
foreach ($change in $changes) {
  Assert-Within $change.destination $target
  if ($change.remove) { Remove-Item -LiteralPath $change.destination }
  else {
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($change.destination)) -Force | Out-Null
    Copy-Item -LiteralPath $change.source -Destination $change.destination -Force
    if ((Get-FileHash -LiteralPath $change.destination).Hash -ne $change.newHash) { throw "Copy verification failed: $($change.relative)" }
  }
}
Write-Output "Updated $($changes.Count) program files: $target"
if ($NoBackup) { Write-Output 'Backup skipped (-NoBackup).' }
else { Write-Output "Recoverable backup: $backup" }
Write-Output 'Personal data and secrets were not read or changed. The program is not auto-started; reopen the same EXE when ready.'
