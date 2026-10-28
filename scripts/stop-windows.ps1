# Stops Torlink GUI, its server, and the torrent engine it started.
# Called by "Stop Torlink.bat".

[CmdletBinding()]
param(
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '_common.ps1')

function Write-Stop {
    param([string]$Message)
    if (-not $Quiet) { Write-Host $Message }
}

$stopped = $false
Write-TorlinkLog -Name 'launcher' -Message 'Stop requested.'

# 1. Ask the server to stop cleanly. Its shutdown endpoint also stops the
#    torlnk serve/files children.
$health = Get-TorlinkHealth
if ($health) {
    Write-Stop 'Stopping Torlink...'
    try {
        Invoke-RestMethod `
            -Uri 'http://127.0.0.1:4040/api/shutdown' `
            -Method Post `
            -TimeoutSec 3 `
            -ErrorAction Stop | Out-Null
    } catch {
        # The server may close the connection before replying; that is fine.
    }
    $stopped = $true

    for ($i = 0; $i -lt 12; $i++) {
        Start-Sleep -Milliseconds 300
        if (-not (Get-TorlinkHealth -TimeoutSec 1)) { break }
    }
}

# 2. If the server is still alive (hung or force-closed), kill its process tree.
$processId = Get-TorlinkPid
if ($processId -and (Test-TorlinkServerProcess $processId)) {
    Write-Stop ('Stopping server process ' + $processId + '...')
    Stop-TorlinkProcessTree -ProcessId $processId
    $stopped = $true
}
Remove-TorlinkPid

# 3. Catch a server started outside the launcher (or a leftover after a crash).
foreach ($process in Get-TorlinkProjectProcesses) {
    $id = [int]$process.ProcessId
    if (Test-TorlinkProcessAlive $id) {
        Write-Stop ('Stopping leftover server process ' + $id + '...')
        Stop-TorlinkProcessTree -ProcessId $id
        $stopped = $true
    }
}

# 4. Stop engine processes that were started from this project's folder. A
#    torlnk engine the user started elsewhere is left untouched.
foreach ($id in Get-TorlinkEngineProcessIds) {
    if (Test-TorlinkProcessAlive ([int]$id)) {
        Write-Stop ('Stopping torrent engine process ' + $id + '...')
        Stop-TorlinkProcessTree -ProcessId ([int]$id)
        $stopped = $true
    }
}

Remove-TorlinkPid

# 5. Give Windows a moment to release the ports, then report.
for ($i = 0; $i -lt 10; $i++) {
    if (-not (Get-TorlinkHealth -TimeoutSec 1)) { break }
    Start-Sleep -Milliseconds 300
}

if (Get-TorlinkHealth -TimeoutSec 1) {
    Write-TorlinkLog -Name 'launcher' -Message 'Stop failed: the server is still responding.'
    if (-not $Quiet) {
        Write-Host 'Torlink is still responding. Close the app window and try again, or sign out of Windows.' -ForegroundColor Red
    }
    exit 1
}

if ($stopped) {
    Write-TorlinkLog -Name 'launcher' -Message 'Torlink stopped.'
    Write-Stop 'Torlink has stopped.'
} else {
    Write-Stop 'Torlink is not running.'
}

exit 0
