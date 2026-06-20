# Paper Baker CLI installer for Windows (PowerShell).
#
#   powershell -ExecutionPolicy ByPass -c "irm https://paper-baker.web.app/install.ps1 | iex"
#
# (Fallback before the web app is deployed:
#   irm https://raw.githubusercontent.com/Cy-47/Paper-Baker/main/install.ps1 | iex )
#
# Downloads a self-contained `pb.exe` from GitHub Releases and
# installs it into %USERPROFILE%\.local\bin. Per-user only: never needs admin —
# it writes your home dir and the HKCU (current-user) PATH, not system locations.
#
# Environment overrides:
#   PB_VERSION          release tag to install (default: latest)
#   PB_INSTALL_DIR      install directory      (default: %USERPROFILE%\.local\bin)
#   PB_NO_MODIFY_PATH   set to 1 to skip editing the user PATH

$ErrorActionPreference = "Stop"
# Invoke-WebRequest renders a progress overlay that both clutters output and, on
# Windows PowerShell 5.1, slows large downloads to a crawl. Silence it.
$ProgressPreference = "SilentlyContinue"
# Windows PowerShell 5.1 may default to an older protocol; GitHub requires TLS 1.2.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Repo    = "Cy-47/Paper-Baker"
$BinName = "pb.exe"
$Version = if ($env:PB_VERSION) { $env:PB_VERSION } else { "latest" }
$InstallDir = if ($env:PB_INSTALL_DIR) { $env:PB_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".local\bin" }

# --- detect platform -------------------------------------------------------
# Resolve the *OS* architecture even from a 32-bit (WOW64) PowerShell, where
# PROCESSOR_ARCHITECTURE reads "x86" but PROCESSOR_ARCHITEW6432 holds the real one.
$rawArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
switch ($rawArch) {
  "AMD64" { $cpu = "x64" }
  "ARM64" {
    # No native ARM64 build yet; the x64 binary runs under Windows' emulation.
    $cpu = "x64"
    Write-Host "  (no native ARM64 build yet; installing the x64 binary, which runs under emulation)"
  }
  default {
    Write-Error "unsupported architecture '$rawArch' (need 64-bit Windows)"
    exit 1
  }
}

$asset = "pb-windows-$cpu.exe"

# --- resolve download URL --------------------------------------------------
if ($Version -eq "latest") {
  $url = "https://github.com/$Repo/releases/latest/download/$asset"
} else {
  $url = "https://github.com/$Repo/releases/download/$Version/$asset"
}

# --- download --------------------------------------------------------------
Write-Host "Installing Paper Baker CLI ($asset, $Version)..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$tmp    = Join-Path ([System.IO.Path]::GetTempPath()) ("pb-" + [System.IO.Path]::GetRandomFileName() + ".exe")
$sumTmp = "$tmp.sha256"

try {
  Write-Host "Downloading $asset..."
  Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing

  # --- verify checksum -----------------------------------------------------
  # Each release publishes <asset>.sha256 next to the binary. Verify when it's
  # available; a mismatch is FATAL. A release without one falls back to transport
  # (TLS) integrity only, with a note.
  $haveSum = $false
  try {
    Invoke-WebRequest -Uri "$url.sha256" -OutFile $sumTmp -UseBasicParsing
    $haveSum = $true
  } catch {
    Write-Host "note: no published checksum for this release; skipping verification"
  }
  if ($haveSum) {
    $expected = ((Get-Content $sumTmp -Raw).Trim() -split '\s+')[0]
    $actual   = (Get-FileHash -Algorithm SHA256 -Path $tmp).Hash
    if ($expected -ieq $actual) {
      Write-Host "Checksum verified."
    } else {
      Write-Error "checksum mismatch for $asset`n  expected: $expected`n  actual:   $actual"
      exit 1
    }
  }

  $dest = Join-Path $InstallDir $BinName
  Move-Item -Force -Path $tmp -Destination $dest
  Write-Host "Installed to $dest"
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $tmp, $sumTmp
}

# --- PATH setup ------------------------------------------------------------
# Persist the install dir on the *user* PATH in the registry (HKCU\Environment),
# which needs no admin. SetEnvironmentVariable(..,"User") also broadcasts a
# settings-change so newly launched processes pick it up; existing shells need a
# restart. Idempotent: we only append when the dir isn't already listed. Opt out
# with PB_NO_MODIFY_PATH=1 to get the manual hint instead.
function Test-OnUserPath($dir) {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $userPath) { return $false }
  foreach ($p in $userPath.Split(';')) {
    if ($p -and ($p.TrimEnd('\') -ieq $dir.TrimEnd('\'))) { return $true }
  }
  return $false
}

Write-Host ""
if ($env:PB_NO_MODIFY_PATH -eq "1") {
  Write-Host "Add $InstallDir to your PATH:"
  Write-Host "  `$env:Path = `"$InstallDir;`$env:Path`""
} elseif (Test-OnUserPath $InstallDir) {
  # Already persisted — nothing to do, but make sure THIS session sees it too.
  if (($env:Path -split ';') -notcontains $InstallDir) {
    $env:Path = "$InstallDir;$env:Path"
  }
} else {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $newPath  = if ([string]::IsNullOrEmpty($userPath)) { $InstallDir } else { $userPath.TrimEnd(';') + ";" + $InstallDir }
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  # Put it on PATH for THIS session too, so the sign-in step below works and the
  # user can run `pb` immediately without reopening their terminal.
  $env:Path = "$InstallDir;$env:Path"
  Write-Host "Added $InstallDir to your user PATH (set PB_NO_MODIFY_PATH=1 to skip)."
  Write-Host "Open a new terminal, or run this to use pb now:"
  Write-Host "  `$env:Path = `"$InstallDir;`$env:Path`""
}

$pb = Join-Path $InstallDir $BinName

# --- offer sign-in ---------------------------------------------------------
# Login is optional — the CLI works locally without an account. Only prompt when
# we have a real interactive console (a scripted/CI run has redirected input).
Write-Host ""
if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
  $answer = Read-Host "Sign in to sync with your account now? [Y/n]"
  if ($answer -match '^[Nn]') {
    Write-Host "Skipped. Run 'pb login' whenever you're ready."
  } else {
    try { & $pb login } catch { Write-Host "Login didn't complete. Run 'pb login' to try again." }
  }
} else {
  Write-Host "Optional: run 'pb login' to sync with your account (works locally without it)."
}

Write-Host ""
Write-Host "Run 'pb --help' to get started."
