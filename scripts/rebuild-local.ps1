#requires -Version 5.1
<#
.SYNOPSIS
    Rebuild the Agnes local runtime safely, even after a leaked build lock.

.DESCRIPTION
    `build:local` publishes packages/cli/dist/local through a transaction owned by
    packages/base/tools/runtime-directory.ts. The lock (`local.build-lock`) is
    fail-closed: if a previous run commits but cannot delete its `previous` backup,
    the lock is intentionally preserved. On Windows that happens when a daemon
    started from dist/local keeps packages/cli/dist/local/node_modules/@agnes/
    system-node/dist/native/agnes-system.node mapped, because a loaded .node file
    cannot be deleted. The next build then fails with

        EEXIST: file already exists, mkdir '...\local.build-lock'

    This script performs the documented recovery (docs/guide/build-recovery.md):
      1. stop the local daemon so it releases the native module handle,
      2. quarantine a leftover `local.build-lock` as evidence instead of deleting it,
      3. run the build again and verify the produced entry point.

.PARAMETER DataDir
    Daemon data directory. Defaults to $env:AGH_HOME\data, else %USERPROFILE%\.agh\data.

.PARAMETER Profile
    Daemon profile. Defaults to $env:AGNES_PROFILE, else local-dev.

.PARAMETER Workspace
    Workspace passed to the daemon. Defaults to the agnes-harness directory.

.PARAMETER OutputDir
    Build into this absolute directory instead of packages/cli/dist/local.

.PARAMETER SkipStop
    Do not touch a running daemon (you have already stopped it).

.PARAMETER ForceStop
    If `daemon stop` cannot release the process, force-kill the daemon/worker.

.PARAMETER SkipBuild
    Only perform the stop + quarantine + verification steps.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rebuild-local.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rebuild-local.ps1 -ForceStop
#>
param(
    [string]$DataDir,
    [string]$Profile,
    [string]$Workspace,
    [string]$OutputDir,
    [switch]$SkipStop,
    [switch]$ForceStop,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

function Fail([string]$message) {
    Write-Host $message -ForegroundColor Red
    exit 1
}

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$HarnessDir = Join-Path $RepoRoot 'agnes-harness'
if (-not (Test-Path -LiteralPath $HarnessDir)) {
    Fail "agnes-harness not found under $RepoRoot"
}

if ([string]::IsNullOrWhiteSpace($DataDir)) {
    $aghHome = $env:AGH_HOME
    if ([string]::IsNullOrWhiteSpace($aghHome)) { $aghHome = $env:AGNES_HOME }
    if ([string]::IsNullOrWhiteSpace($aghHome) -and -not [string]::IsNullOrWhiteSpace($env:HOME)) {
        $aghHome = Join-Path $env:HOME '.agh'
    }
    if ([string]::IsNullOrWhiteSpace($aghHome)) { $aghHome = Join-Path $env:USERPROFILE '.agh' }
    $DataDir = Join-Path $aghHome 'data'
}
if ([string]::IsNullOrWhiteSpace($Profile)) {
    $Profile = if ([string]::IsNullOrWhiteSpace($env:AGNES_PROFILE)) { 'local-dev' } else { $env:AGNES_PROFILE }
}
if ([string]::IsNullOrWhiteSpace($Workspace)) { $Workspace = $HarnessDir }

$DistDir = Join-Path $HarnessDir 'packages\cli\dist'
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $TargetDir = Join-Path $DistDir 'local'
} else {
    $TargetDir = [System.IO.Path]::GetFullPath($OutputDir)
}
$LockDir = "$TargetDir.build-lock"
$Entry = Join-Path $TargetDir 'agnes.mjs'

Write-Output "repo    : $RepoRoot"
Write-Output "target  : $TargetDir"
Write-Output "scope   : profile=$Profile data-dir=$DataDir workspace=$Workspace"
Write-Output ''

function Get-OutputHolders([string]$directory) {
    $pattern = [regex]::Escape($directory) + '[\\/](daemon|worker|agnes)\.mjs'
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern }
}

# 1. stop the local daemon -----------------------------------------------------
if (-not $SkipStop) {
    $running = $false
    if (Test-Path -LiteralPath $Entry) {
        try {
            $raw = & node $Entry daemon status --data-dir $DataDir --profile $Profile --workspace $Workspace 2>$null
            $json = @($raw) | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1
            if ($json) { $running = [bool]((($json | ConvertFrom-Json)).running) }
        } catch {
            Write-Output "daemon status query failed: $($_.Exception.Message)"
        }
    }
    if ($running) {
        Write-Output 'stopping local daemon ...'
        & node $Entry daemon stop --data-dir $DataDir --profile $Profile --workspace $Workspace | Out-Null
    } else {
        Write-Output 'no daemon reported running for this scope'
    }
}

# 2. make sure nothing still holds the output ---------------------------------
$holders = @(Get-OutputHolders $TargetDir)
if ($holders.Count -gt 0 -and $ForceStop) {
    foreach ($p in $holders) {
        Write-Output ("force-killing pid {0}" -f $p.ProcessId)
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
    $holders = @(Get-OutputHolders $TargetDir)
}
if ($holders.Count -gt 0) {
    Fail ("a process still runs from $TargetDir : pid " + (($holders | ForEach-Object { $_.ProcessId }) -join ', ') +
        '. Stop it (agnes daemon stop, or Ctrl+C the serve terminal) and retry, or pass -ForceStop.')
}

# 3. quarantine a leftover lock as evidence -----------------------------------
if (Test-Path -LiteralPath $LockDir) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $quarantine = "$LockDir.orphan-$stamp"
    Write-Output "found leftover lock; moving evidence to $quarantine"
    Move-Item -LiteralPath $LockDir -Destination $quarantine
} else {
    Write-Output 'no leftover lock'
}
Get-ChildItem -LiteralPath $DistDir -Directory -Filter '*.tmp-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Output ("note: staging leftover kept as evidence: {0}" -f $_.FullName) }

if ($SkipBuild) {
    Write-Output ''
    Write-Output 'skipBuild set; stop + quarantine done'
    exit 0
}

# 4. rebuild ------------------------------------------------------------------
Push-Location $HarnessDir
try {
    if ([string]::IsNullOrWhiteSpace($OutputDir)) {
        & pnpm --filter '@agnes/cli' build:local
    } else {
        & pnpm --filter '@agnes/cli' exec tsx tools/build-local.ts --output-dir $TargetDir
    }
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($code -ne 0) { Fail "build failed with exit code $code" }

# 5. verify -------------------------------------------------------------------
if (-not (Test-Path -LiteralPath $Entry)) {
    Fail "build reported success but $Entry is missing"
}
& node $Entry --version

Write-Output ''
Write-Output "built and verified: $Entry"
