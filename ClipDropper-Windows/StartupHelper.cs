using System.Diagnostics;
using Microsoft.Win32;

namespace ClipDropper;

internal static class StartupHelper
{
    private const string RunKey  = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string AppName = "ClipDropper";

    // Returns the real exe path, or null when running under `dotnet run`.
    private static string? RealExePath()
    {
        var path = Environment.ProcessPath;
        return path != null && path.EndsWith("ClipDropper.exe", StringComparison.OrdinalIgnoreCase)
            ? path : null;
    }

    public static void EnsureAutoStart()
    {
        var exePath = RealExePath();
        if (exePath is null) return;

        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
            if (key is null) return;
            if (key.GetValue(AppName) is string existing && existing == exePath) return;
            key.SetValue(AppName, exePath);
        }
        catch { /* registry unavailable — skip */ }
    }

    public static void RemoveAutoStart()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
            key?.DeleteValue(AppName, throwOnMissingValue: false);
        }
        catch { }
    }

    public static void EnsureSendToShortcut()
    {
        var exePath = RealExePath();
        if (exePath is null) return;

        var sendTo  = Environment.GetFolderPath(Environment.SpecialFolder.SendTo);
        var lnkPath = Path.Combine(sendTo, "ClipDropper.lnk");
        if (File.Exists(lnkPath)) return;

        try
        {
            var ps = $"$s=(New-Object -COM WScript.Shell).CreateShortcut('{lnkPath.Replace("'","''")}');" +
                     $"$s.TargetPath='{exePath.Replace("'","''")}';$s.Save()";
            using var proc = Process.Start(new ProcessStartInfo
            {
                FileName        = "powershell",
                Arguments       = $"-NoProfile -NonInteractive -Command \"{ps}\"",
                CreateNoWindow  = true,
                UseShellExecute = false,
            });
            proc?.WaitForExit();
        }
        catch { }
    }

    public static void EnsureFirewallRule()
    {
        var exePath = RealExePath();
        if (exePath is null) return;

        try
        {
            // Check if rule already exists (no elevation needed for show)
            using var check = Process.Start(new ProcessStartInfo
            {
                FileName               = "netsh",
                Arguments              = $"advfirewall firewall show rule name=\"{AppName}\"",
                CreateNoWindow         = true,
                UseShellExecute        = false,
                RedirectStandardOutput = true,
            });
            check?.WaitForExit();
            if (check?.ExitCode == 0) return; // rule already there

            // Add inbound rule — triggers one-time UAC prompt
            using var add = Process.Start(new ProcessStartInfo
            {
                FileName        = "netsh",
                Arguments       = $"advfirewall firewall add rule name=\"{AppName}\" " +
                                  $"dir=in action=allow protocol=TCP " +
                                  $"program=\"{exePath}\" enable=yes profile=any",
                UseShellExecute = true,
                Verb            = "runas",
            });
            add?.WaitForExit();
        }
        catch { /* elevation cancelled or netsh unavailable — skip */ }
    }
}
