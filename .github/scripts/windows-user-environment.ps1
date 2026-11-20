param([string]$Source, [string]$Report)
$ErrorActionPreference = 'Stop'
$phase = 'WINDOWS_USER_ENVIRONMENT'
try {
    [IO.File]::WriteAllText($Report, "STEP $phase")
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Unexpected token' }
    # The new account's loaded profile and machine variables come from Windows,
    # independently of the action runner. No provider keys are supplied.
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SmokeEnvironment {
    [DllImport("userenv.dll", SetLastError=true)]
    public static extern bool CreateEnvironmentBlock(out IntPtr block, IntPtr token, bool inherit);
    [DllImport("userenv.dll")]
    public static extern bool DestroyEnvironmentBlock(IntPtr block);
    [DllImport("kernel32.dll", EntryPoint="GetWindowsDirectoryW", CharSet=CharSet.Unicode)]
    public static extern uint GetWindowsDirectory(StringBuilder result, uint size);
    [DllImport("bcrypt.dll")]
    public static extern int BCryptGenRandom(IntPtr provider, byte[] buffer, int bytes, int flags);
}
'@
    $windows = [Text.StringBuilder]::new(512)
    $length = [SmokeEnvironment]::GetWindowsDirectory($windows, $windows.Capacity)
    if ($length -eq 0 -or $length -ge $windows.Capacity) { throw 'Windows directory unavailable' }
    $node = Join-Path $Source '.haema\node\win-x64\node.exe'
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $node
    $info.WorkingDirectory = $PSScriptRoot
    $info.UseShellExecute = $false
    $info.EnvironmentVariables.Clear()
    $block = [IntPtr]::Zero
    if (-not [SmokeEnvironment]::CreateEnvironmentBlock([ref]$block,$identity.Token,$false)) { throw 'Windows user environment unavailable' }
    try {
        $cursor = $block
        while ([Runtime.InteropServices.Marshal]::ReadInt16($cursor) -ne 0) {
            $entry = [Runtime.InteropServices.Marshal]::PtrToStringUni($cursor)
            $cursor = [IntPtr]::Add($cursor, 2 * ($entry.Length + 1))
            $separator = $entry.IndexOf('=')
            if ($separator -gt 0) { $info.EnvironmentVariables[$entry.Substring(0,$separator)] = $entry.Substring($separator + 1) }
        }
    } finally { [void][SmokeEnvironment]::DestroyEnvironmentBlock($block) }
    $info.EnvironmentVariables['SystemRoot'] = $windows.ToString()
    $info.EnvironmentVariables['WINDIR'] = $windows.ToString()

    $phase = 'WINDOWS_BCRYPT'
    [IO.File]::WriteAllText($Report, "STEP $phase")
    $buffer = New-Object byte[] 16
    if ([SmokeEnvironment]::BCryptGenRandom([IntPtr]::Zero, $buffer, $buffer.Length, 2) -ne 0) { throw 'Windows native RNG failed' }
    $phase = 'BUNDLED_NODE_CSPRNG'
    [IO.File]::WriteAllText($Report, "STEP $phase")
    $info.Arguments = '-e "require(''node:crypto'').randomBytes(16)"'
    $probe = [Diagnostics.Process]::Start($info)
    if (-not $probe.WaitForExit(15000)) { $probe.Kill(); throw 'Node probe timed out' }
    if ($probe.ExitCode -ne 0) { throw 'Node RNG unavailable' }
    $probe.Dispose()

    $phase = 'LAUNCH_UPGRADED_USER_ENV'
    [IO.File]::WriteAllText($Report, "STEP $phase")
    $info.Arguments = '"{0}" "{1}" "{2}" standard' -f (Join-Path $PSScriptRoot 'smoke.mjs'),$Source,$Report
    $child = [Diagnostics.Process]::Start($info)
    $child.WaitForExit()
    $exitCode = $child.ExitCode
    $child.Dispose()
    if ($null -eq $exitCode -or $exitCode -ne 0 -or
        [IO.File]::ReadAllText($Report).Trim() -cne 'PASS STOPPED') {
        throw 'Child did not complete the release check.'
    }
    [IO.File]::WriteAllText($Report, 'PASS STANDARD_PROCESS_EXITED')
    exit 0
} catch {
    [IO.File]::WriteAllText($Report, "FAIL $phase")
    exit 1
}
