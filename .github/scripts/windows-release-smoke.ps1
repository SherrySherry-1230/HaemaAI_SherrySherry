$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:RELEASE_SHA256 -notmatch '\A[0-9a-fA-F]{64}\z') { throw 'A 64-digit release SHA-256 is required.' }

$url = 'https://github.com/SherrySherry-1230/HaemaAI_SherrySherry/releases/download/console-installers/haema-ai-windows.zip'
$id = [guid]::NewGuid().ToString('N').Substring(0, 12)
$stage = Join-Path $env:ProgramData "hm-$id"
$account = "hm$id"
$task = "HaemaSmoke-$id"
$user = $null
$registered = $false
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

    # The hosted runner is elevated. Use a new local account with a non-elevated
    # token and its own HKCU, profile and TEMP for installation and native actions.
    $password = 'aA1!' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    $user = New-LocalUser -Name $account -Password (ConvertTo-SecureString $password -AsPlainText -Force)
    $users = Get-LocalGroup -SID 'S-1-5-32-545'
    if (-not (Get-LocalGroupMember -Group $users.Name | Where-Object SID -eq $user.SID)) {
        Add-LocalGroupMember -Group $users.Name -Member $user
    }
    $report = Join-Path $stage 'status.txt'
    [IO.File]::WriteAllText($report, 'WAITING')
    $sid = '*' + $user.SID.Value
    & icacls.exe $stage /grant ("${sid}:(OI)(CI)RX") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not grant read access to test inputs.' }
    & icacls.exe $report /grant ("${sid}:M") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not grant write access to the test report.' }

    # Paths come from the fixed digest-verified archive and this ephemeral staging area.
    $action = New-ScheduledTaskAction -Execute $node -Argument ('"{0}" "{1}" "{2}"' -f $script, $stores[0].FullName, $report) -WorkingDirectory $stage
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 8)
    Register-ScheduledTask -TaskName $task -User "$env:COMPUTERNAME\$account" -Password $password -RunLevel Limited -Action $action -Settings $settings | Out-Null
    $registered = $true
    $password = $null
    Start-ScheduledTask -TaskName $task
    $finish = [datetime]::UtcNow.AddMinutes(8)
    $last = ''
    do {
        Start-Sleep -Seconds 3
        $status = [IO.File]::ReadAllText($report).Trim()
        if ($status -match '\A(?:STEP|FAIL|PASS) [A-Z0-9_]{1,64}\z' -and $status -ne $last) {
            Write-Host $status
            $last = $status
        }
        if ($status -ceq 'PASS STOPPED') { return }
        if ($status -match '\AFAIL ') { throw 'Windows release smoke failed. See the last reported phase.' }
        $info = Get-ScheduledTaskInfo -TaskName $task
        if ($info.LastRunTime.Year -gt 2000 -and (Get-ScheduledTask -TaskName $task).State -eq 'Ready') {
            if ([IO.File]::ReadAllText($report).Trim() -ceq 'PASS STOPPED') { Write-Host 'PASS STOPPED'; return }
            throw "Test process exited without success (Windows result $($info.LastTaskResult))."
        }
    } while ([datetime]::UtcNow -lt $finish)
    throw 'Timed out waiting for the standard-user smoke test.'
} finally {
    if ($registered) {
        Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
    }
    if ($null -ne $user) { Remove-LocalUser -SID $user.SID -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
