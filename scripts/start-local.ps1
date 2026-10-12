#requires -Version 5.1
<#
.SYNOPSIS
    Repair the known Agnes-home ACL issue, then run the local Web workbench.
.DESCRIPTION
    Uses the existing local build by default. -Rebuild invokes rebuild-local.ps1
    before startup. Only CodexSandboxUsers explicit Allow ACLs are removed;
    credentials, configuration, sessions and package trust checks are preserved.
    Run in a normal PowerShell terminal, outside the Codex command sandbox.
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-local.ps1
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-local.ps1 -Rebuild
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-local.ps1 -Diagnose
#>
param(
    [switch]$Rebuild,
    [switch]$Diagnose,
    [ValidateRange(1, 65535)][int]$Port = 4180,
    [string]$Profile,
    [string]$AghHome,
    [string]$OutputDir
)

$ErrorActionPreference = 'Stop'
$HarnessDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\agnes-harness'))
if ([string]::IsNullOrWhiteSpace($AghHome)) { $AghHome = $env:AGH_HOME }
if ([string]::IsNullOrWhiteSpace($AghHome)) { $AghHome = $env:AGNES_HOME }
if ([string]::IsNullOrWhiteSpace($AghHome) -and -not [string]::IsNullOrWhiteSpace($env:HOME)) {
    $AghHome = Join-Path $env:HOME '.agh'
}
if ([string]::IsNullOrWhiteSpace($AghHome)) { $AghHome = Join-Path $env:USERPROFILE '.agh' }
$AghHome = [System.IO.Path]::GetFullPath($AghHome)
if ([string]::IsNullOrWhiteSpace($Profile)) {
    $Profile = if ($env:AGNES_PROFILE) { $env:AGNES_PROFILE } else { 'local-dev' }
}
if ([string]::IsNullOrWhiteSpace($OutputDir)) { $OutputDir = Join-Path $HarnessDir 'packages\cli\dist\local' }
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$Entry = Join-Path $OutputDir 'agnes.mjs'
$DataDir = Join-Path $AghHome 'data'
$previousAghHome = $env:AGH_HOME
$previousMcpLoopbackHttp = $env:AGNES_MCP_ALLOW_LOOPBACK_HTTP

Push-Location -LiteralPath $HarnessDir
try {
    $env:AGH_HOME = $AghHome
    if ($null -eq $env:AGNES_MCP_ALLOW_LOOPBACK_HTTP) {
        $env:AGNES_MCP_ALLOW_LOOPBACK_HTTP = '1'
    }
    if ($Rebuild) {
        & (Join-Path $PSScriptRoot 'rebuild-local.ps1') -DataDir $DataDir -Profile $Profile -Workspace $HarnessDir -OutputDir $OutputDir
        if ($LASTEXITCODE -ne 0) { throw "Local build failed (exit $LASTEXITCODE)." }
    }
    if (-not (Test-Path -LiteralPath $Entry -PathType Leaf)) {
        throw "Local build missing: $Entry. Run this script with -Rebuild."
    }
    & (Join-Path $PSScriptRoot 'fix-agh-acl.ps1') -AghHome $AghHome
    Write-Output "starting: profile=$Profile home=$AghHome build=$OutputDir"
    if ($Diagnose) {
        # Foreground startup exposes the daemon's original error, unlike the
        # detached CLI launcher, which reports only a readiness/exit failure.
        & node (Join-Path $OutputDir 'daemon.mjs') --profile $Profile --workspace $HarnessDir --data-dir $DataDir
    } else {
        & node $Entry serve --port $Port --profile $Profile --cwd $HarnessDir --data-dir $DataDir
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Agnes exited with code $LASTEXITCODE. Run scripts\start-local.ps1 -Diagnose to see the daemon's original error."
    }
} finally {
    $env:AGH_HOME = $previousAghHome
    $env:AGNES_MCP_ALLOW_LOOPBACK_HTTP = $previousMcpLoopbackHttp
    Pop-Location
}
