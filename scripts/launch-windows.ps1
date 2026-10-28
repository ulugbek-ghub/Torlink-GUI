# Starts Torlink GUI in the background and opens it in the default browser.
#
# Called by Torlink.vbs (hidden), "Start Torlink.bat -Foreground" (visible log)
# and setup-windows.ps1 after a successful first run.

[CmdletBinding()]
param(
    [switch]$Foreground,
    [switch]$NoBrowser,
    [int]$TimeoutSeconds = 75
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-TorlinkRoot
$serverFile = Get-TorlinkPath @('server', 'index.js')
$serverUrl = 'http://127.0.0.1:4040'
$outLog = Get-TorlinkPath @('.runtime', 'logs', 'server.out.log')
$errLog = Get-TorlinkPath @('.runtime', 'logs', 'server.err.log')

function Test-TorlinkPortListening {
    param([int]$Port)
    try {
        $connections = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
        return ($connections.Count -gt 0)
    } catch {
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
            $connected = $async.AsyncWaitHandle.WaitOne(250)
            if ($connected) { $client.EndConnect($async) }
            $client.Close()
            return $connected
        } catch {
            return $false
        }
    }
}

function Wait-TorlinkServer {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSec = 75
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $health = Get-TorlinkHealth -TimeoutSec 2
        if ($health) { return $health }
        if ($Process -and $Process.HasExited) { return $null }
        Start-Sleep -Milliseconds 400
    }
    return $null
}

function Get-TorlinkFailureText {
    param([string]$Message)
    $lines = @(
        $Message,
        '',
        ('Log folder: ' + (Get-TorlinkLogsDir))
    )

    $out = Get-TorlinkLogTail -Path $outLog -Lines 30
    $err = Get-TorlinkLogTail -Path $errLog -Lines 30
    if ($out) {
        $lines += ''
        $lines += 'Server output:'
        $lines += $out
    }
    if ($err) {
        $lines += ''
        $lines += 'Server errors:'
        $lines += $err
    }
    return ($lines -join [Environment]::NewLine)
}

function Show-TorlinkLaunchFailure {
    param([string]$Message)
    $details = Get-TorlinkFailureText -Message $Message
    Write-TorlinkLog -Name 'launcher' -Message ('Launch failed: ' + $Message)
    if ($Foreground) {
        Write-Host ''
        Write-Host $details -ForegroundColor Red
    } else {
        Show-TorlinkError -Message $details
    }
}

function Open-TorlinkBrowser {
    if ($NoBrowser) { return }
    try {
        Start-Process -FilePath $serverUrl | Out-Null
    } catch {
        Write-Host ('Open ' + $serverUrl + ' in your browser.')
    }
}

$mutex = New-Object -TypeName System.Threading.Mutex -ArgumentList @($false, 'Local\TorlinkGUI-Launcher')
$acquired = $false

try {
    try {
        $acquired = $mutex.WaitOne(0, $false)
    } catch [System.Threading.AbandonedMutexException] {
        $acquired = $true
    }

    if (-not $acquired) {
        # Another launch is already in progress. Give it a moment, then just
        # open the browser if it succeeded.
        $health = Wait-TorlinkHealth -TimeoutSec 30
        if ($health) {
            Open-TorlinkBrowser
            exit 0
        }
        Show-TorlinkLaunchFailure 'Another Torlink launch is still in progress. Wait a moment and try again.'
        exit 1
    }

    if (-not (Test-Path -LiteralPath $serverFile)) {
        Show-TorlinkLaunchFailure 'server\index.js is missing. Re-download Torlink and run Setup Torlink.bat.'
        exit 1
    }

    if (-not (Test-TorlinkInstalled)) {
        Show-TorlinkLaunchFailure 'Torlink is not set up yet. Double-click "Setup Torlink.bat", then try again.'
        exit 1
    }

    $node = Resolve-TorlinkNode
    if (-not $node) {
        Show-TorlinkLaunchFailure 'Node.js 22 or newer was not found. Run Setup Torlink.bat to install it.'
        exit 1
    }
    Set-TorlinkPath $node

    $health = Get-TorlinkHealth
    if ($health) {
        # Already running (perhaps from another shortcut). Just show the app.
        Open-TorlinkBrowser
        exit 0
    }

    # Clean up a server that crashed or was suspended without releasing its PID.
    $oldProcessId = Get-TorlinkPid
    if ($oldProcessId -and (Test-TorlinkServerProcess $oldProcessId)) {
        $health = Wait-TorlinkHealth -TimeoutSec 10
        if ($health) {
            Open-TorlinkBrowser
            exit 0
        }
        Write-TorlinkLog -Name 'launcher' -Message ('Stopping unresponsive server process ' + $oldProcessId + '.')
        Stop-TorlinkProcessTree -ProcessId $oldProcessId
    }
    Remove-TorlinkPid

    if (Test-TorlinkPortListening -Port 4040) {
        Show-TorlinkLaunchFailure 'Port 4040 is already used by another program. Close that program and try again.'
        exit 1
    }

    $arguments = '"' + $serverFile + '"'
    Get-TorlinkLogsDir | Out-Null

    if ($Foreground) {
        Write-Host ''
        Write-Host ('  Starting Torlink GUI on ' + $serverUrl) -ForegroundColor Cyan
        Write-Host '  Press Ctrl+C to stop the app and the torrent engine.'
        Write-Host ''

        $process = Start-Process -FilePath $node.Exe `
            -ArgumentList $arguments `
            -WorkingDirectory $root `
            -NoNewWindow `
            -PassThru
    } else {
        $process = Start-Process -FilePath $node.Exe `
            -ArgumentList $arguments `
            -WorkingDirectory $root `
            -WindowStyle Hidden `
            -RedirectStandardOutput $outLog `
            -RedirectStandardError $errLog `
            -PassThru
    }

    if (-not $process -or -not $process.Id) {
        Show-TorlinkLaunchFailure 'Windows could not start the Torlink server process.'
        exit 1
    }

    Set-TorlinkPid -ProcessId $process.Id
    Write-TorlinkLog -Name 'launcher' -Message ('Started server process ' + $process.Id + ' using ' + $node.Exe)

    $health = Wait-TorlinkServer -Process $process -TimeoutSec $TimeoutSeconds
    if (-not $health) {
        Stop-TorlinkProcessTree -ProcessId $process.Id
        Remove-TorlinkPid
        Show-TorlinkLaunchFailure ('Torlink did not start within ' + $TimeoutSeconds + ' seconds.')
        exit 1
    }

    Open-TorlinkBrowser

    if ($Foreground) {
        Write-Host ''
        Write-Host ('  Torlink is running at ' + $serverUrl) -ForegroundColor Green
        Write-Host '  Close this window (or press Ctrl+C) to stop it.'
        Write-Host ''
        Wait-Process -Id $process.Id
        $process.Refresh()
        $code = $process.ExitCode
        Remove-TorlinkPid
        exit $code
    }

    exit 0
} finally {
    if ($acquired) {
        try { $mutex.ReleaseMutex() } catch { }
    }
    try { $mutex.Dispose() } catch { }
}
