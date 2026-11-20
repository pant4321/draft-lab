$ErrorActionPreference = 'Stop'
$installer = $env:DRAFTEDGE_UPDATE_INSTALLER
$executable = $env:DRAFTEDGE_UPDATE_EXE
$directory = [IO.Path]::GetDirectoryName($installer)
$installDirectory = [IO.Path]::GetDirectoryName($executable)
$ready = Join-Path $directory 'ready'
$installed = $false
$restarted = $false

try {
    # PyInstaller's bootloader also holds the original executable open.
    $running = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($executable)) -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $executable }
    [IO.File]::WriteAllText($ready, '')
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    foreach ($process in $running) {
        $remaining = [Math]::Max(0, 30000 - $deadline.ElapsedMilliseconds)
        if (-not $process.WaitForExit([int]$remaining)) {
            throw 'The companion did not exit.'
        }
    }

    $setup = Start-Process -FilePath $installer -ArgumentList @(
        '/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART',
        '/NOCLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS', ('/DIR=' + [char]34 + $installDirectory + [char]34)
    ) -WorkingDirectory $directory -WindowStyle Hidden -Wait -PassThru
    $installed = $setup.ExitCode -eq 0
} catch {
    $installed = $false
} finally {
    # A failed installer should still return the user to the previous app if it is available.
    try {
        Start-Process -FilePath $executable -WorkingDirectory $installDirectory -WindowStyle Normal
        $restarted = $true
    } catch {}

    try {
        [IO.File]::Delete($installer)
        [IO.File]::Delete($ready)
        [IO.Directory]::Delete($directory)
    } catch {}
}

if (-not $installed -or -not $restarted) {
    Add-Type -AssemblyName System.Windows.Forms
    $message = if (-not $installed) {
        'The update could not be completed. Try again from DraftEdge Companion or run the installer from GitHub.'
    } else {
        'The update installed, but DraftEdge Companion could not reopen. Open it from Start.'
    }
    [void][Windows.Forms.MessageBox]::Show($message, 'DraftEdge Companion')
    exit 1
}
