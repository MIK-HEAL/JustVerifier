#requires -Version 5.1
<#
.SYNOPSIS
    Restore the private DACL on the Agnes home (AGH_HOME, default ~/.agh).

.DESCRIPTION
    The Agnes credential store only reads its files when every directory in the
    chain (~/.agh, ~/.agh/secrets, ~/.agh/secrets/<provider>, ...) contains
    nothing but SYSTEM, BUILTIN\Administrators and the current user. Any other
    Allow entry makes the store refuse to read and the CLI reports:

        local daemon scope resolution failed: The credential store is unavailable.

    A Codex sandbox setup may add "CodexSandboxUsers" read access to the home.
    This script removes ONLY that group's explicit Allow entries. Other foreign
    grants, inherited grants and unexpected owners are reported, never changed.

    Run it before launching agnes when the sandbox keeps re-granting access, or
    run agnes outside the Codex sandbox entirely to stop the grants at the source.

.PARAMETER AghHome
    The Agnes home to repair. Defaults to $env:AGH_HOME, then $env:USERPROFILE\.agh.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fix-agh-acl.ps1
#>
param(
    [string]$AghHome
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($AghHome)) { $AghHome = $env:AGH_HOME }
if ([string]::IsNullOrWhiteSpace($AghHome)) { $AghHome = $env:AGNES_HOME }
if ([string]::IsNullOrWhiteSpace($AghHome) -and -not [string]::IsNullOrWhiteSpace($env:HOME)) {
    $AghHome = Join-Path $env:HOME '.agh'
}
if ([string]::IsNullOrWhiteSpace($AghHome)) { $AghHome = Join-Path $env:USERPROFILE '.agh' }
$AghHome = [System.IO.Path]::GetFullPath($AghHome)
if ($AghHome.TrimEnd('\') -eq [System.IO.Path]::GetPathRoot($AghHome).TrimEnd('\') -or
    $AghHome.TrimEnd('\') -eq $env:USERPROFILE.TrimEnd('\')) {
    throw 'Refusing to modify ACLs on a drive root or user-profile root.'
}

if (-not (Test-Path -LiteralPath $AghHome)) {
    Write-Output "Agnes home does not exist yet; the runtime will create it: $AghHome"
    return
}

$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$trusted = @($me, 'S-1-5-18', 'S-1-5-32-544')
$sandboxSid = $null
try {
    $sandboxAccount = New-Object System.Security.Principal.NTAccount($env:COMPUTERNAME, 'CodexSandboxUsers')
    $sandboxSid = $sandboxAccount.Translate([System.Security.Principal.SecurityIdentifier]).Value
} catch [System.Security.Principal.IdentityNotMappedException] {
    # The group is absent on machines without the Codex Windows sandbox.
}

function Read-TargetAcl([string]$target) {
    $item = Get-Item -LiteralPath $target -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to repair ACLs through a reparse point: $target"
    }
    return Get-Acl -LiteralPath $target
}

# The credential store validates the home root plus secrets/auth/locks and the
# provider directories one level below them. Repair those, not the whole tree.
$targets = New-Object System.Collections.Generic.List[string]
$targets.Add($AghHome)
foreach ($base in @('secrets', 'auth', 'locks')) {
    $path = Join-Path $AghHome $base
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $targets.Add($path)
    Get-ChildItem -LiteralPath $path -Directory -Force -ErrorAction SilentlyContinue |
        ForEach-Object { $targets.Add($_.FullName) }
}

$removed = 0
foreach ($target in $targets) {
    $acl = Read-TargetAcl $target
    foreach ($ace in @($acl.Access)) {
        # Inherited foreign Allow entries are also unsafe, but modifying their
        # parent is outside the scope of this repair.
        if ($ace.IsInherited) { continue }
        if ($ace.AccessControlType -ne 'Allow') { continue }
        $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        if (-not $sandboxSid -or $sid -ne $sandboxSid) { continue }
        & icacls $target /remove:g "*$sid" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "ACL repair failed for $target (exit $LASTEXITCODE)" }
        Write-Output ("removed Allow for '{0}' from {1}" -f $ace.IdentityReference.Value, $target)
        $removed++
    }
}

foreach ($target in $targets) {
    $acl = Read-TargetAcl $target
    $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin @($me, 'S-1-5-32-544')) { throw "Untrusted owner on $target; owner was not changed." }
    foreach ($ace in @($acl.Access)) {
        if ($ace.AccessControlType -ne 'Allow' -or [int]$ace.FileSystemRights -eq 0) { continue }
        $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        if ($sid -notin $trusted) {
            throw "Foreign Allow entry '$($ace.IdentityReference.Value)' remains on $target (inherited=$($ace.IsInherited)); it was not changed."
        }
    }
}
Write-Output "done: removed $removed CodexSandboxUsers Allow ACE(s); directory ACL checks passed"
