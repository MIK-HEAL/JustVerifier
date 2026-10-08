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

.PARAMETER KeepGeneratedProfile
    Keep the installed profile package state. By default a legacy generated
    research-verifier snapshot (the old sidebar.workspaces client) is removed
    together with its lock entry so the rebuilt bundle is installed fresh.

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
    [switch]$SkipBuild,
    [switch]$KeepGeneratedProfile
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

function Read-OwnerRecord([string]$dataDir) {
    $ownerFile = Join-Path $dataDir 'daemon\owner.json'
    if (-not (Test-Path -LiteralPath $ownerFile -PathType Leaf)) { return $null }
    try {
        $owner = Get-Content -LiteralPath $ownerFile -Raw | ConvertFrom-Json
        if ($owner.pid -isnot [int] -and $owner.pid -isnot [long]) { return $null }
        if ([int64]$owner.pid -le 0) { return $null }
        if ([string]::IsNullOrWhiteSpace([string]$owner.processStartId)) { return $null }
        return $owner
    } catch {
        return $null
    }
}

function Get-OwnerProcess($owner) {
    if ($null -eq $owner) { return $null }
    try {
        $process = Get-Process -Id ([int]$owner.pid) -ErrorAction Stop
        $expected = [regex]::Match([string]$owner.processStartId, '^win32:[0-9]+:([0-9]+)$').Groups[1].Value
        if ([string]::IsNullOrWhiteSpace($expected)) { return $null }
        $actual = $process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()
        if ($actual -ne $expected) { return $null }
        if ([string]::IsNullOrWhiteSpace($process.Path) -or
            [System.IO.Path]::GetFileName($process.Path) -ine 'node.exe') { return $null }
        return $process
    } catch {
        return $null
    }
}

function Remove-StaleDaemonRecords([string]$dataDir) {
    $daemonDir = Join-Path $dataDir 'daemon'
    if (-not (Test-Path -LiteralPath $daemonDir -PathType Container)) { return }
    $owner = Read-OwnerRecord $dataDir
    if ($null -ne (Get-OwnerProcess $owner)) {
        Fail ("daemon owner pid {0} is still alive; refusing to remove its records" -f $owner.pid)
    }
    foreach ($name in @(
            'owner.json',
            'discovery.json',
            'web-credential.json',
            'stop-request.json',
            'mutation-lock.db-journal',
            'mutation-lock.db-wal',
            'mutation-lock.db-shm',
            'startup-lock.db-journal',
            'startup-lock.db-wal',
            'startup-lock.db-shm')) {
        $path = Join-Path $daemonDir $name
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Write-Output ("removing stale daemon record: {0}" -f $path)
            $removed = $false
            for ($attempt = 0; $attempt -lt 50 -and -not $removed; $attempt++) {
                try {
                    # These records are created with the native private-file
                    # primitive. PowerShell's provider can be refused by that
                    # handle even after the owner exits; cmd's delete path
                    # requests the same delete access and works with the
                    # private DACL. The path cannot contain a quote on Windows.
                    $command = 'del /f /q "' + $path + '"'
                    & $env:ComSpec /d /c $command 2>$null | Out-Null
                    if (Test-Path -LiteralPath $path -PathType Leaf) {
                        Remove-Item -LiteralPath $path -Force -ErrorAction Stop
                    }
                    $removed = -not (Test-Path -LiteralPath $path -PathType Leaf)
                } catch {
                    if ($attempt -eq 49) { throw }
                    Start-Sleep -Milliseconds 200
                }
            }
        }
    }
}

function Remove-GeneratedDirectory([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) { return }
    Write-Output ("removing generated runtime cache: {0}" -f $path)
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        try {
            Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
        } catch {
            # A private runtime cache can be held briefly by a worker while its
            # parent daemon is shutting down. Use the native Windows directory
            # deletion path, then retry before treating it as a real failure.
            $command = 'rmdir /s /q "' + $path + '"'
            & $env:ComSpec /d /c $command 2>$null | Out-Null
        }
        if (-not (Test-Path -LiteralPath $path -PathType Container)) { return }
        Start-Sleep -Milliseconds 200
    }
    throw "generated runtime cache could not be removed: $path"
}

function Reset-GeneratedClientModules([string]$dataDir, [string]$profile) {
    $clientRoot = Join-Path $dataDir "daemon\client-modules\$profile"
    Remove-GeneratedDirectory $clientRoot
    $roster = Join-Path $clientRoot '..\_client-modules.json'
    if (Test-Path -LiteralPath $roster -PathType Leaf) {
        Write-Output ("removing generated client roster: {0}" -f $roster)
        $rosterPath = [System.IO.Path]::GetFullPath($roster)
        for ($attempt = 0; $attempt -lt 50; $attempt++) {
            try {
                $command = 'del /f /q "' + $rosterPath + '"'
                & $env:ComSpec /d /c $command 2>$null | Out-Null
                if (Test-Path -LiteralPath $rosterPath -PathType Leaf) {
                    Remove-Item -LiteralPath $rosterPath -Force -ErrorAction Stop
                }
                if (-not (Test-Path -LiteralPath $rosterPath -PathType Leaf)) { break }
            } catch {
                if ($attempt -eq 49) { throw }
            }
            Start-Sleep -Milliseconds 200
        }
    }
}

function Write-JsonNoBom([string]$file, $value) {
    $json = $value | ConvertTo-Json -Depth 100
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($file, "$json`r`n", $utf8)
}

function Reset-LegacyGeneratedVerifier {
    if ($KeepGeneratedProfile) {
        Write-Output 'keeping generated profile package state'
        return
    }

    $homeDir = Split-Path -Parent $DataDir
    $profileDir = Join-Path $homeDir "profiles\$Profile"
    $packageRoot = Join-Path $DataDir "profiles\$Profile\packages"
    $lockFile = Join-Path $profileDir 'agnes-lock.json'
    $verifierId = '@agnes/research-verifier'
    $packageDir = Join-Path $packageRoot '@agnes__research-verifier'
    $legacy = $false
    $snapshotIds = @()

    $stopRequest = Join-Path $DataDir 'daemon\stop-request.json'
    if (Test-Path -LiteralPath $stopRequest -PathType Leaf) {
        try {
            $request = Get-Content -LiteralPath $stopRequest -Raw | ConvertFrom-Json
            $process = if ($request.pid) { Get-Process -Id ([int]$request.pid) -ErrorAction SilentlyContinue } else { $null }
            if ($request.command -eq 'stop' -and $null -eq $process) {
                Write-Output "removing stale daemon stop request: $stopRequest"
                Remove-Item -LiteralPath $stopRequest -Force
            }
        } catch {
            Write-Output "ignoring unreadable daemon stop request: $($_.Exception.Message)"
        }
    }

    if (Test-Path -LiteralPath $lockFile -PathType Leaf) {
        $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
        $entry = $lock.packages.PSObject.Properties[$verifierId].Value
        if ($null -ne $entry) {
            $legacy = ($entry.integrity -eq 'sha256-0d396fb74f3f92bcccddd1bb2fd5cd9949c38fa4482d9d92e66a56444862d3c5')
            foreach ($contribution in @($entry.contributions)) {
                if ($contribution.kind -eq 'client' -and @($contribution.client.slots) -contains 'sidebar.workspaces') {
                    $legacy = $true
                }
            }
            if ($legacy) {
                $lock.packages.PSObject.Properties.Remove($verifierId)
                Write-JsonNoBom $lockFile $lock
            }
        }
    }

    $runtimeFile = Join-Path $profileDir '.agnes-runtime-snapshots.json'
    if (Test-Path -LiteralPath $runtimeFile -PathType Leaf) {
        $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
        foreach ($snapshot in @($runtime.snapshots.PSObject.Properties)) {
            if ($snapshot.Value.packageId -eq $verifierId) {
                $snapshotIds += $snapshot.Name
                $runtime.snapshots.PSObject.Properties.Remove($snapshot.Name)
            }
        }
        foreach ($pin in @($runtime.pins.PSObject.Properties)) {
            if ($pin.Value.packageId -eq $verifierId -or $snapshotIds -contains $pin.Value.snapshotId) {
                $runtime.pins.PSObject.Properties.Remove($pin.Name)
            }
        }
        if ($legacy) { Write-JsonNoBom $runtimeFile $runtime }
    }

    $runtimeTargetScript = Join-Path $PSScriptRoot 'reset-runtime-target.mjs'
    $runtimeTargetDatabase = Join-Path $DataDir 'tables\_40agnes_2fdaemon.db'
    $runtimeTargetModule = Join-Path $HarnessDir 'packages\plugin-runtime\dist\src\runtime-target.js'
    if ((Test-Path -LiteralPath $runtimeTargetScript -PathType Leaf) -and
        (Test-Path -LiteralPath $runtimeTargetDatabase -PathType Leaf) -and
        (Test-Path -LiteralPath $runtimeTargetModule -PathType Leaf)) {
        & node $runtimeTargetScript $runtimeTargetDatabase $Profile
        if ($LASTEXITCODE -ne 0) { Fail "runtime target cleanup failed with exit code $LASTEXITCODE" }
    }

    if (-not $legacy) {
        Write-Output 'no legacy generated verifier snapshot detected'
        return
    }

    if (Test-Path -LiteralPath $packageDir) {
        Write-Output "removing legacy generated verifier: $packageDir"
        Remove-Item -LiteralPath $packageDir -Recurse -Force
    }
    foreach ($snapshotId in $snapshotIds) {
        $snapshotDir = Join-Path $packageRoot ".runtime-snapshots\$snapshotId"
        if (Test-Path -LiteralPath $snapshotDir) { Remove-Item -LiteralPath $snapshotDir -Recurse -Force }
    }
    $helperState = Join-Path $profileDir 'default-helpers\state.json'
    if (Test-Path -LiteralPath $helperState) {
        Write-Output "resetting generated helper receipt: $helperState"
        Remove-Item -LiteralPath $helperState -Force
    }
}

# 1. stop the local daemon -----------------------------------------------------
if (-not $SkipStop) {
    $running = $false
    $ownerProcess = Get-OwnerProcess (Read-OwnerRecord $DataDir)
    if (Test-Path -LiteralPath $Entry) {
        try {
            $raw = & node $Entry daemon status --data-dir $DataDir --profile $Profile --workspace $Workspace 2>$null
            $json = @($raw) | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1
            if ($json) { $running = [bool]((($json | ConvertFrom-Json)).running) }
        } catch {
            Write-Output "daemon status query failed: $($_.Exception.Message)"
        }
    }
    # On Windows an active daemon can hold the private daemon directory while
    # the status/stop command is validating discovery.json. In that brief
    # sharing window the control command reports a discovery error even though
    # owner.json still identifies a live daemon. Use the generation-bound owner
    # record as a safe fallback so a rebuild never starts a second daemon in the
    # same scope and then misreports its readiness failure.
    if (-not $running -and $null -ne $ownerProcess) {
        $running = $true
        Write-Output ("daemon status unavailable; found live owner pid {0}" -f $ownerProcess.Id)
    }
    if ($running) {
        Write-Output 'stopping local daemon ...'
        $stopped = $false
        try {
            & node $Entry daemon stop --data-dir $DataDir --profile $Profile --workspace $Workspace | Out-Null
            $stopped = ($LASTEXITCODE -eq 0)
        } catch {
            Write-Output "daemon stop command failed: $($_.Exception.Message)"
        }
        if (-not $stopped -and $null -ne $ownerProcess) {
            Write-Output ("control path unavailable; stopping recorded daemon pid {0}" -f $ownerProcess.Id)
            Stop-Process -Id $ownerProcess.Id -Force -ErrorAction Stop
            $deadline = (Get-Date).AddSeconds(10)
            do {
                Start-Sleep -Milliseconds 100
                $stillRunning = Get-Process -Id $ownerProcess.Id -ErrorAction SilentlyContinue
            } while ($null -ne $stillRunning -and (Get-Date) -lt $deadline)
            if ($null -ne $stillRunning) { Fail ("daemon pid {0} did not exit" -f $ownerProcess.Id) }
        }
    } else {
        Write-Output 'no daemon reported running for this scope'
    }
    Start-Sleep -Milliseconds 250
    Remove-StaleDaemonRecords $DataDir
    Reset-GeneratedClientModules $DataDir $Profile
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

# 3. remove the known stale generated verifier state --------------------------
Reset-LegacyGeneratedVerifier

# 4. quarantine a leftover lock as evidence -----------------------------------
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

# 5. clear the generated output before rebuilding ------------------------------
if (Test-Path -LiteralPath $TargetDir) {
    Write-Output "clearing generated build output: $TargetDir"
    Remove-Item -LiteralPath $TargetDir -Recurse -Force
}

# 6. rebuild ------------------------------------------------------------------
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

# 7. verify -------------------------------------------------------------------
if (-not (Test-Path -LiteralPath $Entry)) {
    Fail "build reported success but $Entry is missing"
}
& node $Entry --version

Write-Output ''
Write-Output "built and verified: $Entry"
