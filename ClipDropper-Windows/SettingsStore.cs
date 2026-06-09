using Microsoft.Win32;

namespace ClipDropper;

internal static class SettingsStore
{
    private const string Key       = @"Software\ClipDropper";
    private const string PairedKey = @"Software\ClipDropper\Paired";

    public static bool AutoStart
    {
        get => Read("AutoStart", defaultValue: true);
        set
        {
            Write("AutoStart", value);
            if (value) StartupHelper.EnsureAutoStart();
            else       StartupHelper.RemoveAutoStart();
        }
    }

    public static bool Notifications
    {
        get => Read("Notifications", defaultValue: true);
        set => Write("Notifications", value);
    }

    public static bool ContextMenu
    {
        get => Read("ContextMenu", defaultValue: true);
        set
        {
            Write("ContextMenu", value);
            StartupHelper.EnsureContextMenu(value);
        }
    }

    public static void SavePairedDevice(string deviceId, string deviceName)
    {
        try
        {
            using var k = Registry.CurrentUser.CreateSubKey(PairedKey);
            k?.SetValue(deviceId, deviceName, RegistryValueKind.String);
        }
        catch { }
    }

    public static Dictionary<string, string> GetPairedDevices()
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(PairedKey);
            if (k is null) return result;
            foreach (var name in k.GetValueNames())
                if (k.GetValue(name) is string val)
                    result[name] = val;
        }
        catch { }
        return result;
    }

    public static void RevokeDevice(string deviceId)
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(PairedKey, writable: true);
            k?.DeleteValue(deviceId, throwOnMissingValue: false);
        }
        catch { }
    }

    private static bool Read(string name, bool defaultValue)
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(Key);
            return k?.GetValue(name) is int v ? v != 0 : defaultValue;
        }
        catch { return defaultValue; }
    }

    private static void Write(string name, bool value)
    {
        try
        {
            using var k = Registry.CurrentUser.CreateSubKey(Key);
            k?.SetValue(name, value ? 1 : 0, RegistryValueKind.DWord);
        }
        catch { }
    }
}
