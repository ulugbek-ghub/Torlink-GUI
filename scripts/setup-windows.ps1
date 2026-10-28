# First-run installer for Torlink GUI on Windows.
#
# It finds (or downloads) a portable Node.js 22 runtime, installs the app's
# dependencies, builds the frontend, and creates Desktop / Start Menu shortcuts.
# It is called by "Setup Torlink.bat" and automatically by Torlink.vbs the first
# time the app is opened.

[CmdletBinding()]
param(
    [switch]$NoLaunch,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-TorlinkRoot
$setupLog = Join-Path (Get-TorlinkLogsDir) 'setup.log'

function Write-Setup {
    param([string]$Message)
    Write-Host $Message
    Write-TorlinkLog -Name 'setup' -Message $Message
}

function Invoke-TorlinkNpm {
    param(
        [string]$Npm,
        [string[]]$Arguments
    )
    if (-not $Npm -or -not (Test-Path -LiteralPath $Npm)) {
        throw 'npm was not found next to Node.js. Re-run setup or install Node.js 22 from nodejs.org.'
    }

    $npmLog = Join-Path (Get-TorlinkLogsDir) 'setup-npm.log'
    $previousPreference = $ErrorActionPreference
    $code = 0

    Push-Location -LiteralPath $root
    try {
        Write-TorlinkLog -Name 'setup' -Message ('Running: npm ' + ($Arguments -join ' '))
        # npm writes warnings to stderr even on success. Continue on stderr and
        # judge success from the exit code instead of PowerShell's error stream.
        $ErrorActionPreference = 'Continue'
        & $Npm @Arguments 2>&1 | Tee-Object -FilePath $npmLog -Append | ForEach-Object {
            Write-Host $_
        }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
        Pop-Location
    }

    if ($code -ne 0) {
        throw ('npm ' + ($Arguments -join ' ') + ' failed with exit code ' + $code + '. See ' + $npmLog)
    }
}

function Install-PortableNode {
    Write-Setup 'Node.js 22 or newer was not found. Downloading a portable copy...'

    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'Torlink requires 64-bit Windows 10 or newer.'
    }

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    } catch {
        # Newer .NET versions already default to TLS 1.2+.
    }

    $runtime = Get-TorlinkPath @('.runtime')
    $downloads = Join-Path $runtime 'downloads'
    New-Item -ItemType Directory -Force -Path $downloads | Out-Null

    $base = 'https://nodejs.org/dist/latest-v22.x'
    $shasums = Join-Path $downloads 'SHASUMS256.txt'

    Write-Setup ('Fetching ' + $base + '/SHASUMS256.txt')
    try {
        Invoke-WebRequest -Uri ($base + '/SHASUMS256.txt') -OutFile $shasums -UseBasicParsing
    } catch {
        throw ('Could not reach nodejs.org. Check your internet connection, then run setup again. Details: ' + $_.Exception.Message)
    }

    $line = Get-Content -LiteralPath $shasums |
        Where-Object { $_ -match '^\s*([0-9a-fA-F]{64})\s+\*?(node-v[\d\.]+-win-x64\.zip)\s*$' } |
        Select-Object -First 1
    if (-not $line) {
        throw 'Could not find the Windows x64 download in Node.js SHASUMS256.txt.'
    }
    if (-not ($line -match '^\s*([0-9a-fA-F]{64})\s+\*?(node-v[\d\.]+-win-x64\.zip)\s*$')) {
        throw 'Could not parse the Node.js download checksum.'
    }
    $expectedHash = $matches[1].ToLowerInvariant()
    $fileName = $matches[2]
    $zipPath = Join-Path $downloads $fileName

    if (-not (Test-Path -LiteralPath $zipPath)) {
        Write-Setup ('Downloading ' + $fileName + ' (about 30 MB, one time)...')
        try {
            Invoke-WebRequest -Uri ($base + '/' + $fileName) -OutFile $zipPath -UseBasicParsing
        } catch {
            throw ('Could not download Node.js. Check your internet connection, then run setup again. Details: ' + $_.Exception.Message)
        }
    }

    Write-Setup 'Verifying the download...'
    $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
        throw 'The Node.js download was corrupted (checksum mismatch). Run setup again.'
    }

    $extract = Join-Path $runtime 'node-extract'
    if (Test-Path -LiteralPath $extract) {
        Remove-Item -LiteralPath $extract -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $extract | Out-Null

    try {
        Write-Setup 'Extracting Node.js...'
        Expand-Archive -LiteralPath $zipPath -DestinationPath $extract -Force
        $inner = Get-ChildItem -LiteralPath $extract -Directory |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe') } |
            Select-Object -First 1
        if (-not $inner) {
            throw 'The Node.js archive did not contain node.exe.'
        }

        $target = Get-TorlinkPath @('.runtime', 'node')
        if (Test-Path -LiteralPath $target) {
            Remove-Item -LiteralPath $target -Recurse -Force
        }
        Move-Item -LiteralPath $inner.FullName -Destination $target
    } finally {
        if (Test-Path -LiteralPath $extract) {
            Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue

    $portable = Get-TorlinkPath @('.runtime', 'node', 'node.exe')
    $version = Get-TorlinkNodeVersion $portable
    if (-not $version -or $version -lt [version]'22.0.0') {
        throw 'The downloaded Node.js runtime could not be started.'
    }

    $dir = Split-Path -Parent $portable
    Write-Setup ('Installed portable Node.js ' + $version.ToString() + '.')
    return [pscustomobject]@{
        Exe     = $portable
        Dir     = $dir
        Npm     = (Join-Path $dir 'npm.cmd')
        Version = $version
    }
}

function New-TorlinkShortcut {
    param(
        [string]$Path,
        [string]$Target,
        [string]$Arguments,
        [string]$Icon
    )
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $Target
    $shortcut.Arguments = $Arguments
    $shortcut.WorkingDirectory = $root
    $shortcut.Description = 'Torlink GUI - search, download and stream torrents'
    if ($Icon -and (Test-Path -LiteralPath $Icon)) {
        $shortcut.IconLocation = $Icon + ',0'
    }
    $shortcut.Save()
}

function Install-TorlinkShortcuts {
    param([string]$NodeExe)

    try {
        $vbs = Get-TorlinkPath @('Torlink.vbs')
        if (-not (Test-Path -LiteralPath $vbs)) {
            Write-Setup 'Warning: Torlink.vbs is missing, so shortcuts could not be created.'
            return
        }

        $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
        $icon = Get-TorlinkPath @('assets', 'torlink.ico')
        if (-not (Test-Path -LiteralPath $icon)) { $icon = $NodeExe }
        $arguments = '"' + $vbs + '"'

        $desktop = [Environment]::GetFolderPath('Desktop')
        if ($desktop) {
            New-TorlinkShortcut `
                -Path (Join-Path $desktop 'Torlink.lnk') `
                -Target $wscript `
                -Arguments $arguments `
                -Icon $icon
        }

        $programs = [Environment]::GetFolderPath('Programs')
        if ($programs) {
            $folder = Join-Path $programs 'Torlink'
            New-TorlinkShortcut `
                -Path (Join-Path $folder 'Torlink.lnk') `
                -Target $wscript `
                -Arguments $arguments `
                -Icon $icon

            $stopBat = Get-TorlinkPath @('Stop Torlink.bat')
            if (Test-Path -LiteralPath $stopBat) {
                New-TorlinkShortcut `
                    -Path (Join-Path $folder 'Stop Torlink.lnk') `
                    -Target $env:ComSpec `
                    -Arguments ('/c ""' + $stopBat + '""') `
                    -Icon $icon
            }
        }

        Write-Setup 'Created Desktop and Start Menu shortcuts.'
    } catch {
        Write-Setup ('Warning: shortcuts could not be created: ' + $_.Exception.Message)
    }
}

function Write-TorlinkInstallMarker {
    param($Node)
    $runtime = Get-TorlinkPath @('.runtime')
    if (-not (Test-Path -LiteralPath $runtime)) {
        New-Item -ItemType Directory -Force -Path $runtime | Out-Null
    }

    $info = [ordered]@{
        installedAt = (Get-Date).ToString('o')
        node        = $Node.Exe
        nodeVersion = $Node.Version.ToString()
        root        = $root
    }
    $json = $info | ConvertTo-Json
    Set-Content -LiteralPath (Get-TorlinkPath @('.runtime', 'installed')) -Value $json -Encoding UTF8
    Set-Content -LiteralPath (Get-TorlinkPath @('.runtime', 'node.txt')) -Value $Node.Exe -Encoding UTF8
}

try {
    Write-Host ''
    Write-Host '  Torlink GUI - Windows setup' -ForegroundColor Cyan
    Write-Host '  ---------------------------' -ForegroundColor DarkGray
    Write-Host ''

    Write-TorlinkLog -Name 'setup' -Message ('Setup started in ' + $root)

    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'Torlink requires 64-bit Windows 10 or newer.'
    }

    $node = Resolve-TorlinkNode
    if (-not $node -or -not $node.Npm -or -not (Test-Path -LiteralPath $node.Npm)) {
        $node = Install-PortableNode
    } else {
        Write-Setup ('Using Node.js ' + $node.Version.ToString() + ' from ' + $node.Exe)
    }

    Set-TorlinkPath $node
    if (-not (Test-Path -LiteralPath $node.Npm)) {
        throw 'npm was not found. Install Node.js 22 from https://nodejs.org and run setup again.'
    }

    $torlnkCli = Get-TorlinkPath @('node_modules', 'torlnk', 'dist', 'cli.cjs')
    $needInstall = $Force -or
        -not (Test-Path -LiteralPath (Get-TorlinkPath @('.runtime', 'installed'))) -or
        -not (Test-Path -LiteralPath (Get-TorlinkPath @('node_modules'))) -or
        -not (Test-Path -LiteralPath $torlnkCli) -or
        -not (Test-Path -LiteralPath (Get-TorlinkPath @('node_modules', 'express')))

    if ($needInstall) {
        Write-Setup 'Installing app dependencies (this can take a few minutes)...'
        Invoke-TorlinkNpm -Npm $node.Npm -Arguments @('install', '--no-audit', '--no-fund', '--loglevel=error')
    } else {
        Write-Setup 'Dependencies are already installed.'
    }

    if ($Force -or (Test-TorlinkNeedsBuild)) {
        Write-Setup 'Building the Torlink interface...'
        Invoke-TorlinkNpm -Npm $node.Npm -Arguments @('run', 'build')
    } else {
        Write-Setup 'The interface is already built.'
    }

    if (-not (Test-TorlinkFilesReady)) {
        throw 'Setup finished, but some required files are still missing. Check the log for details.'
    }

    Write-TorlinkInstallMarker -Node $node
    Install-TorlinkShortcuts -NodeExe $node.Exe

    Write-TorlinkLog -Name 'setup' -Message 'Setup completed successfully.'
    Write-Host ''
    Write-Host '  Setup complete.' -ForegroundColor Green
    Write-Host '  Open Torlink from the Desktop shortcut, or double-click Torlink.vbs.'
    Write-Host ''

    if (-not $NoLaunch) {
        $launcher = Get-TorlinkPath @('scripts', 'launch-windows.ps1')
        $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $launcher + '"'
        Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -Wait | Out-Null
    }

    exit 0
} catch {
    $message = $_.Exception.Message
    Write-TorlinkLog -Name 'setup' -Message ('Setup failed: ' + $message)
    Write-Host ''
    Write-Host ('  Setup failed: ' + $message) -ForegroundColor Red
    Write-Host ('  Log: ' + $setupLog)
    Write-Host ''
    exit 1
}
