# Shared helpers for the Windows launcher scripts.
# Dot-source this file from setup-windows.ps1, launch-windows.ps1 and
# stop-windows.ps1:  . "$PSScriptRoot\_common.ps1"
#
# The scripts intentionally avoid PowerShell 7-only syntax so they also run on
# the Windows PowerShell 5.1 that ships with Windows 10 and 11.

$ErrorActionPreference = 'Stop'
$script:TorlinkRoot = $null

function Get-TorlinkRoot {
    if ($script:TorlinkRoot) { return $script:TorlinkRoot }
    $here = $PSScriptRoot
    if (-not $here) {
        $here = Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    $script:TorlinkRoot = Split-Path -Parent $here
    return $script:TorlinkRoot
}

function Get-TorlinkPath {
    param([string[]]$Child)
    $path = Get-TorlinkRoot
    if ($Child) {
        foreach ($part in $Child) {
            if ($part) { $path = Join-Path $path $part }
        }
    }
    return $path
}

function Get-TorlinkLogsDir {
    $dir = Get-TorlinkPath @('.runtime', 'logs')
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    return $dir
}

function Write-TorlinkLog {
    param(
        [string]$Name = 'launcher',
        [string]$Message = ''
    )
    try {
        $dir = Get-TorlinkLogsDir
        $line = '[' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '] ' + $Message
        Add-Content -LiteralPath (Join-Path $dir ($Name + '.log')) -Value $line -Encoding UTF8
    } catch {
        # Logging must never be the reason a launch fails.
    }
}

function Get-TorlinkLogTail {
    param(
        [string]$Path,
        [int]$Lines = 40
    )
    try {
        if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return '' }
        $content = Get-Content -LiteralPath $Path -Tail $Lines -ErrorAction Stop
        return ($content -join [Environment]::NewLine)
    } catch {
        return ''
    }
}

function Show-TorlinkError {
    param(
        [string]$Message = 'Torlink could not start.',
        [string]$Title = 'Torlink'
    )
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        [System.Windows.Forms.MessageBox]::Show(
            $Message,
            $Title,
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    } catch {
        Write-Host $Message
    }
}

function Get-TorlinkNodeVersion {
    param([string]$Exe)
    if (-not $Exe -or -not (Test-Path -LiteralPath $Exe)) { return $null }
    try {
        $raw = & $Exe -p "process.versions.node" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
        $text = ([string]$raw).Trim()
        return [version]$text
    } catch {
        return $null
    }
}

# Find a usable Node.js >= 22. The portable runtime downloaded by setup wins,
# then an explicitly configured path, then whatever is installed system-wide.
function Resolve-TorlinkNode {
    $candidates = New-Object System.Collections.Generic.List[string]

    if ($env:TORLINK_NODE) { $candidates.Add($env:TORLINK_NODE) }
    $candidates.Add((Get-TorlinkPath @('.runtime', 'node', 'node.exe')))

    foreach ($name in @('node.exe', 'node')) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command -and $command.Source) { $candidates.Add($command.Source) }
    }

    if ($env:ProgramFiles) {
        $candidates.Add((Join-Path $env:ProgramFiles 'nodejs\node.exe'))
    }
    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if ($programFilesX86) {
        $candidates.Add((Join-Path $programFilesX86 'nodejs\node.exe'))
    }
    if ($env:LOCALAPPDATA) {
        $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'))
        $candidates.Add((Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\node.exe'))
    }
    if ($env:NVM_SYMLINK) {
        $candidates.Add((Join-Path $env:NVM_SYMLINK 'node.exe'))
    }
    if ($env:ProgramData) {
        $candidates.Add((Join-Path $env:ProgramData 'chocolatey\bin\node.exe'))
    }

    $seen = @{}
    foreach ($candidate in $candidates) {
        if (-not $candidate) { continue }
        $key = $candidate.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true

        $version = Get-TorlinkNodeVersion $candidate
        if (-not $version -or $version -lt [version]'22.0.0') { continue }

        $dir = Split-Path -Parent $candidate
        $npm = Join-Path $dir 'npm.cmd'
        if (-not (Test-Path -LiteralPath $npm)) {
            $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
            if (-not $npmCommand) { $npmCommand = Get-Command npm -ErrorAction SilentlyContinue }
            if ($npmCommand -and $npmCommand.Source) { $npm = $npmCommand.Source }
        }

        return [pscustomobject]@{
            Exe     = $candidate
            Dir     = $dir
            Npm     = $npm
            Version = $version
        }
    }

    return $null
}

function Set-TorlinkPath {
    param($Node)
    if (-not $Node -or -not $Node.Dir) { return }
    $parts = @($env:Path -split ';')
    if ($parts -notcontains $Node.Dir) {
        $env:Path = $Node.Dir + ';' + $env:Path
    }
}

function Get-TorlinkHealth {
    param([int]$TimeoutSec = 2)
    try {
        $result = Invoke-RestMethod `
            -Uri 'http://127.0.0.1:4040/api/health' `
            -TimeoutSec $TimeoutSec `
            -ErrorAction Stop
        if ($null -ne $result -and $result.ok -eq $true) { return $result }
    } catch {
        # Not running yet.
    }
    return $null
}

function Wait-TorlinkHealth {
    param([int]$TimeoutSec = 60)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $health = Get-TorlinkHealth -TimeoutSec 2
        if ($health) { return $health }
        Start-Sleep -Milliseconds 400
    }
    return $null
}

function Test-TorlinkFilesReady {
    $required = @(
        (Get-TorlinkPath @('server', 'index.js')),
        (Get-TorlinkPath @('node_modules', 'torlnk', 'dist', 'cli.cjs')),
        (Get-TorlinkPath @('dist', 'index.html'))
    )
    foreach ($file in $required) {
        if (-not (Test-Path -LiteralPath $file)) { return $false }
    }
    return $true
}

function Test-TorlinkInstalled {
    if (-not (Test-Path -LiteralPath (Get-TorlinkPath @('.runtime', 'installed')))) {
        return $false
    }
    return (Test-TorlinkFilesReady)
}

function Test-TorlinkNeedsBuild {
    $index = Get-TorlinkPath @('dist', 'index.html')
    if (-not (Test-Path -LiteralPath $index)) { return $true }
    $builtAt = (Get-Item -LiteralPath $index).LastWriteTimeUtc

    $inputs = @(
        (Get-TorlinkPath @('src')),
        (Get-TorlinkPath @('server')),
        (Get-TorlinkPath @('package.json')),
        (Get-TorlinkPath @('package-lock.json')),
        (Get-TorlinkPath @('vite.config.js'))
    )

    foreach ($inputPath in $inputs) {
        if (-not (Test-Path -LiteralPath $inputPath)) { continue }
        $item = Get-Item -LiteralPath $inputPath
        if ($item.PSIsContainer) {
            $newer = Get-ChildItem -LiteralPath $inputPath -Recurse -File -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTimeUtc -gt $builtAt } |
                Select-Object -First 1
            if ($newer) { return $true }
        } elseif ($item.LastWriteTimeUtc -gt $builtAt) {
            return $true
        }
    }
    return $false
}

function Get-TorlinkPid {
    $file = Get-TorlinkPath @('.runtime', 'torlink.pid')
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    try {
        $text = (Get-Content -LiteralPath $file -Raw -ErrorAction Stop).Trim()
        if (-not $text) { return $null }
        return [int]$text
    } catch {
        return $null
    }
}

function Set-TorlinkPid {
    param([int]$ProcessId)
    $runtime = Get-TorlinkPath @('.runtime')
    if (-not (Test-Path -LiteralPath $runtime)) {
        New-Item -ItemType Directory -Force -Path $runtime | Out-Null
    }
    Set-Content -LiteralPath (Get-TorlinkPath @('.runtime', 'torlink.pid')) -Value $ProcessId -Encoding ASCII
}

function Remove-TorlinkPid {
    $file = Get-TorlinkPath @('.runtime', 'torlink.pid')
    if (Test-Path -LiteralPath $file) {
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    }
}

function Test-TorlinkProcessAlive {
    param([int]$ProcessId)
    if (-not $ProcessId -or $ProcessId -le 0) { return $false }
    try {
        Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

# True only when the PID really is this project's server. Used before acting
# on a PID file, which could otherwise point at an unrelated process after a
# reboot or a Windows PID reuse.
function Test-TorlinkServerProcess {
    param([int]$ProcessId)
    if (-not (Test-TorlinkProcessAlive $ProcessId)) { return $false }
    try {
        $process = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $ProcessId) -ErrorAction Stop
    } catch {
        return $false
    }
    if (-not $process) { return $false }
    $root = ConvertTo-TorlinkWindowsPath (Get-TorlinkRoot)
    $command = ConvertTo-TorlinkWindowsPath ([string]$process.CommandLine)
    if (-not $command) { return $false }
    if ($command.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
    return ($command -match 'server[\\/]+index\.js')
}

function Stop-TorlinkProcessTree {
    param([int]$ProcessId)
    if (-not (Test-TorlinkProcessAlive $ProcessId)) { return }
    $taskkill = Join-Path $env:WINDIR 'System32\taskkill.exe'
    try {
        Start-Process -FilePath $taskkill `
            -ArgumentList @('/PID', [string]$ProcessId, '/T', '/F') `
            -WindowStyle Hidden -Wait | Out-Null
    } catch {
        try { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue } catch { }
    }
}

function ConvertTo-TorlinkWindowsPath {
    param([string]$Value)
    if (-not $Value) { return '' }
    return ($Value -replace '/', '\')
}

# Processes running this project's server/index.js (used by Stop Torlink to
# clean up after a crash where the PID file went stale).
function Get-TorlinkProjectProcesses {
    $root = ConvertTo-TorlinkWindowsPath (Get-TorlinkRoot)
    $result = @()
    try {
        $processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop
    } catch {
        return $result
    }
    foreach ($process in $processes) {
        $command = ConvertTo-TorlinkWindowsPath ([string]$process.CommandLine)
        if (-not $command) { continue }
        if ($command.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
        if ($command -notmatch 'server[\\/]+index\.js') { continue }
        $result += $process
    }
    return $result
}

# torlnk serve / torlnk files processes started from this project's folder.
# A user's own engine started in another folder is deliberately left alone.
function Get-TorlinkEngineProcessIds {
    $root = ConvertTo-TorlinkWindowsPath (Get-TorlinkRoot)
    $ids = @()
    try {
        $connections = Get-NetTCPConnection -State Listen -LocalPort 9160, 9161 -ErrorAction Stop
    } catch {
        return $ids
    }
    foreach ($connection in $connections) {
        $processId = [int]$connection.OwningProcess
        if (-not $processId) { continue }
        try {
            $process = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $processId) -ErrorAction Stop
        } catch {
            continue
        }
        $command = ConvertTo-TorlinkWindowsPath ([string]$process.CommandLine)
        if ($command -and $command.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $ids += $processId
        }
    }
    return ($ids | Select-Object -Unique)
}
