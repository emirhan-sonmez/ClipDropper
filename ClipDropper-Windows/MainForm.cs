using System.Drawing.Imaging;
using System.IO.Compression;
using System.IO.Pipes;

namespace ClipDropper;

internal sealed class MainForm : Form
{
    // ── tray ──────────────────────────────────────────────────────────────
    private readonly NotifyIcon         _trayIcon;
    private readonly ToolStripMenuItem  _statusItem;
    private readonly ToolStripMenuItem  _autoStartItem;
    private readonly ToolStripMenuItem  _notificationsItem;
    private readonly ToolStripMenuItem  _recentMenu;
    private readonly ToolStripMenuItem  _openLogItem;
    private readonly ToolStripMenuItem  _contextMenuToggleItem;

    // ── services ──────────────────────────────────────────────────────────
    private ClipboardMonitor? _clipboardMonitor;
    private BlePeripheral?    _ble;
    private HttpServer?       _http;

    // ── state ─────────────────────────────────────────────────────────────
    private volatile bool _suppressNext;
    private readonly CancellationTokenSource _pipeCts = new();
    private readonly Queue<(string label, string? rawText)> _history = new();
    private const int HistoryMax = 3;

    public MainForm()
    {
        ShowInTaskbar   = false;
        WindowState     = FormWindowState.Minimized;
        FormBorderStyle = FormBorderStyle.None;
        Size            = new Size(1, 1);

        _statusItem        = new ToolStripMenuItem("Starting…") { Enabled = false };
        _autoStartItem     = new ToolStripMenuItem("Auto-start with Windows")
                             { Checked = SettingsStore.AutoStart, CheckOnClick = true };
        _notificationsItem = new ToolStripMenuItem("Show notifications")
                             { Checked = SettingsStore.Notifications, CheckOnClick = true };
        _recentMenu        = new ToolStripMenuItem("Recent");
        _openLogItem       = new ToolStripMenuItem("Open transfer log");

        _autoStartItem.Click     += (_, _) => SettingsStore.AutoStart     = _autoStartItem.Checked;
        _notificationsItem.Click += (_, _) => SettingsStore.Notifications = _notificationsItem.Checked;
        _openLogItem.Click       += (_, _) =>
        {
            if (TransferLog.Exists)
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(TransferLog.FilePath) { UseShellExecute = true });
            else
                System.Windows.Forms.MessageBox.Show("No transfers logged yet.", "ClipDropper");
        };

        _contextMenuToggleItem = new ToolStripMenuItem("Explorer context menu (right-click)")
                                 { Checked = SettingsStore.ContextMenu, CheckOnClick = true };
        _contextMenuToggleItem.Click += (_, _) => SettingsStore.ContextMenu = _contextMenuToggleItem.Checked;

        RefreshHistoryMenu();

        var menu = new ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_autoStartItem);
        menu.Items.Add(_notificationsItem);
        menu.Items.Add(_contextMenuToggleItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_recentMenu);
        menu.Items.Add(_openLogItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => Application.Exit());

        _trayIcon = new NotifyIcon
        {
            ContextMenuStrip = menu,
            Text             = "ClipDropper",
            Icon             = MakeIcon(false),
            Visible          = true,
        };
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);

        if (SettingsStore.AutoStart) StartupHelper.EnsureAutoStart();
        StartupHelper.EnsureFirewallRule();
        StartupHelper.EnsureSendToShortcut();
        StartupHelper.EnsureContextMenu(SettingsStore.ContextMenu);

        _http = new HttpServer();
        _http.FileReceived += OnFileReceived;

        _clipboardMonitor = new ClipboardMonitor();
        _clipboardMonitor.TextCopied  += OnLocalText;
        _clipboardMonitor.ImageCopied += OnLocalImage;

        _ble = new BlePeripheral();
        _ble.SetHttpEndpoint(_http.Endpoint);
        _ble.TextReceived      += OnRemoteText;
        _ble.ConnectionChanged += OnConnectionChanged;

        _ = Task.Run(() => RunPipeServerAsync(_pipeCts.Token));

        try
        {
            var ok = await _ble.StartAsync();
            SetStatus(ok ? "Advertising…" : "Bluetooth unavailable");
        }
        catch (Exception ex)
        {
            SetStatus($"BLE error: {ex.Message}");
        }
    }

    // ── pipe server (B1) ──────────────────────────────────────────────────

    private async Task RunPipeServerAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(
                    Program.PipeName, PipeDirection.In,
                    NamedPipeServerStream.MaxAllowedServerInstances,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                await pipe.WaitForConnectionAsync(ct);
                using var reader = new StreamReader(pipe);
                string? line;
                while ((line = await reader.ReadLineAsync(ct)) != null)
                {
                    if (File.Exists(line) && IsHandleCreated)
                    {
                        var path = line;
                        Invoke(() => _ = SendLocalFileToiOSAsync(path));
                    }
                    else if (Directory.Exists(line) && IsHandleCreated)
                    {
                        var path = line;
                        Invoke(() => _ = SendLocalFolderToiOSAsync(path));
                    }
                }
            }
            catch (OperationCanceledException) { break; }
            catch { /* pipe reset — restart */ }
        }
    }

    private async Task SendLocalFileToiOSAsync(string filePath)
    {
        if (_http is null || _ble is null)
        {
            Notify("ClipDropper", "Not connected to iPhone");
            return;
        }
        var bytes    = await File.ReadAllBytesAsync(filePath);
        var filename = Path.GetFileName(filePath);
        _http.SetPendingFile(bytes, filename);
        await _ble.NotifyFileAvailableAsync(filename);
        Notify("ClipDropper", $"Sending {filename}…");
        AddHistory($"→ {filename}", null);
        TransferLog.Write("→", filename);
    }

    // F2: zip a folder and send it as a single file
    private async Task SendLocalFolderToiOSAsync(string folderPath)
    {
        if (_http is null || _ble is null)
        {
            Notify("ClipDropper", "Not connected to iPhone");
            return;
        }
        var folderName = Path.GetFileName(folderPath);
        var zipName    = folderName + ".zip";
        Notify("ClipDropper", $"Zipping {folderName}…");
        using var ms = new MemoryStream();
        await Task.Run(() =>
        {
            using var archive = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true);
            foreach (var file in Directory.GetFiles(folderPath, "*", SearchOption.AllDirectories))
                archive.CreateEntryFromFile(file, Path.GetRelativePath(folderPath, file));
        });
        _http.SetPendingFile(ms.ToArray(), zipName);
        await _ble.NotifyFileAvailableAsync(zipName);
        Notify("ClipDropper", $"Sending {zipName}…");
        AddHistory($"→ {zipName}", null);
        TransferLog.Write("→", zipName);
    }

    // ── clipboard events ──────────────────────────────────────────────────

    private void OnLocalText(string text)
    {
        if (_suppressNext) { _suppressNext = false; return; }
        _ = _ble?.SendTextAsync(text);
    }

    private void OnLocalImage(Bitmap bmp)
    {
        using var ms = new MemoryStream();
        bmp.Save(ms, ImageFormat.Png);
        _http?.SetImage(ms.ToArray());
        _ = _ble?.NotifyImageAvailableAsync();
    }

    private void OnRemoteText(string text)
    {
        _suppressNext = true;
        if (IsDisposed || !IsHandleCreated) return;
        Invoke(() =>
        {
            Clipboard.SetText(text);
            var preview = text.Length > 30 ? text[..30] + "…" : text;
            Notify("ClipDropper", $"✓ Text: {preview}");
            AddHistory($"\"{preview}\"", text);
            TransferLog.Write("←", $"text: {preview}");
        });
    }

    private void OnFileReceived(byte[] bytes, string filename)
    {
        var downloads = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        var dest = UniqueFilePath(downloads, filename);
        File.WriteAllBytes(dest, bytes);

        if (!IsDisposed && IsHandleCreated)
            Invoke(() =>
            {
                Notify("ClipDropper", $"✓ {filename} saved");
                AddHistory($"↓ {filename}", null);
                TransferLog.Write("←", filename);
            });
    }

    // ── history (B3) ─────────────────────────────────────────────────────

    private void AddHistory(string label, string? rawText)
    {
        while (_history.Count >= HistoryMax) _history.Dequeue();
        _history.Enqueue((label, rawText));
        RefreshHistoryMenu();
    }

    private void RefreshHistoryMenu()
    {
        _recentMenu.DropDownItems.Clear();
        if (_history.Count == 0)
        {
            _recentMenu.DropDownItems.Add(new ToolStripMenuItem("No recent items") { Enabled = false });
            return;
        }
        foreach (var (label, rawText) in _history.Reverse())
        {
            var item = new ToolStripMenuItem(label);
            if (rawText is not null)
            {
                var capture = rawText;
                item.Click += (_, _) => Clipboard.SetText(capture);
            }
            _recentMenu.DropDownItems.Add(item);
        }
    }

    // ── notification helper ───────────────────────────────────────────────

    private void Notify(string title, string text)
    {
        if (!SettingsStore.Notifications) return;
        _trayIcon.ShowBalloonTip(1500, title, text, ToolTipIcon.None);
    }

    // ── connection ────────────────────────────────────────────────────────

    private void OnConnectionChanged(bool connected)
    {
        if (IsDisposed || !IsHandleCreated) return;
        Invoke(() =>
        {
            SetStatus(connected ? "Connected to iPhone" : "Advertising…");
            var old = _trayIcon.Icon;
            _trayIcon.Icon = MakeIcon(connected);
            old?.Dispose();
        });
    }

    private void SetStatus(string s)
    {
        _statusItem.Text = s;
        var tooltip = $"ClipDropper — {s}";
        _trayIcon.Text = tooltip.Length > 63 ? tooltip[..63] : tooltip;
    }

    // ── helpers ───────────────────────────────────────────────────────────

    private static string UniqueFilePath(string folder, string filename)
    {
        var path = Path.Combine(folder, filename);
        if (!File.Exists(path)) return path;
        var name = Path.GetFileNameWithoutExtension(filename);
        var ext  = Path.GetExtension(filename);
        for (var i = 2; ; i++)
        {
            path = Path.Combine(folder, $"{name} ({i}){ext}");
            if (!File.Exists(path)) return path;
        }
    }

    private static Icon MakeIcon(bool connected)
    {
        var stream = System.Reflection.Assembly
            .GetExecutingAssembly()
            .GetManifestResourceStream("ClipDropper.icon_16.ico");

        Bitmap bmp;
        if (stream is not null)
        {
            using var baseIcon = new Icon(stream);
            bmp = baseIcon.ToBitmap();
        }
        else
        {
            // Fallback if icon resource is missing
            bmp = new Bitmap(16, 16);
            using var g0 = Graphics.FromImage(bmp);
            g0.Clear(Color.Transparent);
        }

        // Overlay a small connection-state dot in the bottom-right corner
        using var g   = Graphics.FromImage(bmp);
        using var dot = new SolidBrush(connected ? Color.LimeGreen : Color.FromArgb(90, 90, 90));
        g.FillEllipse(dot, 10, 10, 5, 5);

        var hicon = bmp.GetHicon();
        bmp.Dispose();
        return Icon.FromHandle(hicon);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _pipeCts.Cancel();
        _pipeCts.Dispose();
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        _clipboardMonitor?.Dispose();
        _ble?.Dispose();
        _http?.Dispose();
        base.OnFormClosed(e);
    }
}
