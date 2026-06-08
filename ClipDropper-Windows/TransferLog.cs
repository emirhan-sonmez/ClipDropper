namespace ClipDropper;

internal static class TransferLog
{
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "ClipDropper", "transfers.log");

    public static void Write(string direction, string detail)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
            File.AppendAllText(LogPath,
                $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  [{direction}]  {detail}{Environment.NewLine}");
        }
        catch { /* never crash the app over logging */ }
    }

    public static string FilePath => LogPath;
    public static bool   Exists   => File.Exists(LogPath);
}
