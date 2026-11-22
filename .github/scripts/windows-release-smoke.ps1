$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:SMOKE_PROFILE -notin 'runner','standard') { throw 'Unexpected Windows smoke profile.' }
if ($env:RELEASE_SHA256 -notmatch '\A[0-9a-fA-F]{64}\z') { throw 'A 64-digit release SHA-256 is required.' }

$url = 'https://github.com/SherrySherry-1230/HaemaAI_SherrySherry/releases/download/console-installers/haema-ai-windows-20261122-r2.zip'
$id = [guid]::NewGuid().ToString('N').Substring(0, 12)
$stage = Join-Path $env:ProgramData "hm-$id"
$account = "hm$id"
$user = $null
$process = $null
try {
    New-Item -ItemType Directory -Path $stage | Out-Null
    $zip = Join-Path $stage 'windows.zip'
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
    if ($hash -ine $env:RELEASE_SHA256) { throw 'The downloaded release hash differs from the requested SHA-256.' }
    Write-Host "Verified anonymous download: $hash"
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = Join-Path $stage 'archive'
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $archive)
    $stores = @(Get-ChildItem -LiteralPath $archive -Directory)
    if ($stores.Count -ne 1) { throw 'Unexpected archive layout.' }
    $node = Join-Path $stores[0].FullName '.haema\node\win-x64\node.exe'
    $script = Join-Path $stage 'smoke.mjs'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-release-smoke.mjs') -Destination $script
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-console-browser.mjs') -Destination $stage

    Write-Host 'STEP HOSTED_RUNNER_BUNDLED_CSPRNG'
    & $node -e "require('node:crypto').randomBytes(16)"
    if ($LASTEXITCODE -ne 0) { throw "Bundled Node RNG failed in the hosted runner profile (exit $LASTEXITCODE)." }
    Write-Host 'PASS HOSTED_RUNNER_BUNDLED_CSPRNG'
    $report = Join-Path $stage 'status.txt'
    [IO.File]::WriteAllText($report, 'WAITING')
    if ($env:SMOKE_PROFILE -eq 'runner') {
        $arguments = '"{0}" "{1}" "{2}" runner' -f $script, $stores[0].FullName, $report
        $process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $stage -PassThru
    } else {
        $nativeScript = Join-Path $stage 'user-env.ps1'
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-user-environment.ps1') -Destination $nativeScript
        $password = ConvertTo-SecureString ('aA1!' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')) -AsPlainText -Force
        $user = New-LocalUser -Name $account -Password $password
        $users = Get-LocalGroup -SID 'S-1-5-32-545'
        if (-not (Get-LocalGroupMember -Group $users.Name | Where-Object SID -eq $user.SID)) {
            Add-LocalGroupMember -Group $users.Name -Member $user
        }
        $sid = '*' + $user.SID.Value
        & icacls.exe $stage /grant ("${sid}:(OI)(CI)RX") | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not grant read access to test inputs.' }
        & icacls.exe $report /grant ("${sid}:M") | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not grant write access to the test report.' }
        $credential = [pscredential]::new("$env:COMPUTERNAME\$account", $password)
        $arguments = '-NoProfile -NonInteractive -File "{0}" "{1}" "{2}"' -f $nativeScript,$stores[0].FullName,$report
        $powershell = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
        Write-Host 'STEP LAUNCH_STANDARD_POWERSHELL'
        Start-Service -Name seclogon
        try {
            $process = Start-Process -FilePath $powershell -ArgumentList $arguments -WorkingDirectory $stage -Credential $credential -LoadUserProfile -PassThru
        } catch {
            $cause = $_.Exception
            while ($cause.InnerException) { $cause = $cause.InnerException }
            if ($cause -is [ComponentModel.Win32Exception]) { Write-Host "Standard-user launch Win32 code: $($cause.NativeErrorCode)" }
            throw 'Could not launch the standard Windows profile.'
        }
    }
    Write-Host "Started $($env:SMOKE_PROFILE) test process $($process.Id)."
    $started = [datetime]::UtcNow
    $last = ''
    do {
        $process.Refresh()
        $status = [IO.File]::ReadAllText($report).Trim()
        if ($status -match '\A(?:STEP|FAIL|PASS) [A-Z0-9_]{1,96}\z' -and $status -ne $last) {
            Write-Host $status
            $last = $status
        }
        if ($process.HasExited) {
            $status = [IO.File]::ReadAllText($report).Trim()
            $exitCode = $process.ExitCode
            if ($null -ne $exitCode -and $exitCode -ne 0) { throw "Test process exited with code $exitCode." }
            # The wrapper reads the child exit code under its own Windows identity.
            if ($env:SMOKE_PROFILE -eq 'standard' -and $status -ceq 'PASS STANDARD_PROCESS_EXITED') { return }
            if ($env:SMOKE_PROFILE -eq 'runner' -and $exitCode -eq 0 -and $status -ceq 'PASS STOPPED') { return }
            throw 'Windows smoke process ended without passing.'
        }
        if ($status -match '\AFAIL ') { [void]$process.WaitForExit(10000); throw 'Windows smoke failed during the reported phase.' }
        if (-not $last -and ([datetime]::UtcNow - $started).TotalSeconds -gt 45) { throw 'The launched process did not report its first phase.' }
        Start-Sleep -Seconds 2
    } while (([datetime]::UtcNow - $started).TotalMinutes -lt 8)
    throw 'Timed out during the last reported Windows smoke phase.'
} finally {
    if ($null -ne $process) {
        if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
        $process.Dispose()
    }
    if ($null -ne $user) { Remove-LocalUser -SID $user.SID -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
