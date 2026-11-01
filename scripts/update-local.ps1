param([switch]$CloseRunning, [switch]$NoBackup, [string]$PortableDirectory)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json
if ($package.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid package version' }
# Directory names can lag the installed version; prefer an explicitly selected checkout.
$portable = if ($PortableDirectory) {
  (Resolve-Path -LiteralPath $PortableDirectory -ErrorAction Stop).Path
} else {
  Join-Path $workspace ('Codex-dafeiyu-v' + $package.version + '-windows-x64')
}
if (-not (Test-Path -LiteralPath $portable -PathType Container)) {
  throw 'Portable directory not found. Pass -PortableDirectory with the exact directory containing the EXE you use.'
}
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
# Explicit retired app modules only; never remove arbitrary files or personal data.
$retiredFiles = @(
  'backend\runtime\codex-reset.mjs', 'project-reports-panel.js', 'project-reports-panel.css',
  'backend\runtime\electron-helper\project-reports.js', 'bili-panel.js', 'bili-login.cjs',
  'backend\runtime\bili\api.mjs',
  'backend\runtime\bili\feed.mjs',
  'backend\runtime\bili\frames.mjs',
  'backend\runtime\bili\grabber-preload.cjs',
  'backend\runtime\bili\grabber.cjs',
  'backend\runtime\bili\grabber.html',
  'backend\runtime\bili\grabber.js',
  'backend\runtime\bili\life.mjs',
  'backend\runtime\bili\prompts.mjs',
  'backend\runtime\bili\watch.mjs'
)
foreach ($relative in $retiredFiles) {
  $retired = Join-Path $target $relative
  Assert-Within $retired $target
  if (Test-Path -LiteralPath $retired) {
    Assert-Plain $retired
    $changes += [pscustomobject]@{ relative=$relative; source=$null; destination=$retired; oldHash=(Get-FileHash -LiteralPath $retired).Hash; newHash=$null; remove=$true }
  }
}
# Remove only dependencies retired with QR login, never arbitrary node_modules or user data.
$retiredDirectories = @('backend\runtime\bili',
  'node_modules\ansi-regex',
  'node_modules\ansi-styles',
  'node_modules\camelcase',
  'node_modules\cliui',
  'node_modules\color-convert',
  'node_modules\color-name',
  'node_modules\decamelize',
  'node_modules\dijkstrajs',
  'node_modules\emoji-regex',
  'node_modules\find-up',
  'node_modules\get-caller-file',
  'node_modules\is-fullwidth-code-point',
  'node_modules\locate-path',
  'node_modules\p-limit',
  'node_modules\p-locate',
  'node_modules\p-try',
  'node_modules\path-exists',
  'node_modules\pngjs',
  'node_modules\qrcode',
  'node_modules\require-directory',
  'node_modules\require-main-filename',
  'node_modules\set-blocking',
  'node_modules\string-width',
  'node_modules\strip-ansi',
  'node_modules\which-module',
  'node_modules\wrap-ansi',
  'node_modules\y18n',
  'node_modules\yargs',
  'node_modules\yargs-parser'
)
# Use the bundled Node parser: lockfiles have an empty root key unsupported by Windows PowerShell.
$installedDependencies = @(& (Join-Path $target 'node.exe') -e "console.log(Object.keys(require(process.argv[1]).packages).join('\n'))" (Join-Path $workspace 'package-lock.json'))
if ($LASTEXITCODE -ne 0) { throw 'Could not read package-lock.json' }
$emptyDirectories = @()
foreach ($relative in $retiredDirectories) {
  # A later feature may legitimately reintroduce one of these shared packages.
  if ($installedDependencies -contains $relative.Replace('\', '/')) { continue }
  $retired = Join-Path $target $relative
  Assert-Within $retired $target
  if (-not (Test-Path -LiteralPath $retired)) { continue }
  Assert-Plain $retired
  $emptyDirectories += $retired
  foreach ($entry in Get-ChildItem -LiteralPath $retired -Recurse -Force) {
    Assert-Within $entry.FullName $target
    Assert-Plain $entry.FullName
    if ($entry.PSIsContainer) { $emptyDirectories += $entry.FullName }
    elseif (-not ($changes | Where-Object destination -EQ $entry.FullName)) {
      $changes += [pscustomobject]@{ relative=$entry.FullName.Substring($target.Length + 1); source=$null; destination=$entry.FullName; oldHash=(Get-FileHash -LiteralPath $entry.FullName).Hash; newHash=$null; remove=$true }
    }
  }
}
if (-not $changes.Count -and -not $emptyDirectories.Count) { Write-Output 'Local portable program already matches app source.'; exit 0 }
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
# Children first, without recursive deletion: unexpected new files cause a safe failure.
foreach ($directory in $emptyDirectories | Sort-Object Length -Descending) {
  Assert-Within $directory $target
  Assert-Plain $directory
  if (@(Get-ChildItem -LiteralPath $directory -Force).Count) { throw "Retired directory is not empty: $directory" }
  [IO.Directory]::Delete($directory)
}
Write-Output "Updated $($changes.Count) program files: $target"
if ($NoBackup) { Write-Output 'Backup skipped (-NoBackup).' }
else { Write-Output "Recoverable backup: $backup" }
Write-Output 'Personal data and secrets were not read or changed. The program is not auto-started; reopen the same EXE when ready.'
