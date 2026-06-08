using System.Drawing.Imaging;

namespace ClipDropper;

internal sealed class MainForm : Form
{
    private readonly NotifyIcon _trayIcon;
    private readonly ToolStripMenuItem _statusItem;
    private ClipboardMonitor? _clipboardMonitor;
    private BlePeripheral? _ble;
    private HttpServer? _http;
    private volatile bool _suppressNext;

    public MainForm()
    {
        ShowInTaskbar   = false;
        WindowState     = FormWindowState.Minimized;
        FormBorderStyle = FormBorderStyle.None;
        Size            = new Size(1, 1);

        _statusItem = new ToolStripMenuItem("Starting…") { Enabled = false };

        var menu = new ContextMenuStrip();
        menu.Items.Add(_statusItem);
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

        StartupHelper.EnsureAutoStart();
        StartupHelper.EnsureFirewallRule();

        _http = new HttpServer();
        _http.FileReceived += OnFileReceived;

        _clipboardMonitor = new ClipboardMonitor();
        _clipboardMonitor.TextCopied  += OnLocalText;
        _clipboardMonitor.ImageCopied += OnLocalImage;

        _ble = new BlePeripheral();
        _ble.SetHttpEndpoint(_http.Endpoint);
        _ble.TextReceived      += OnRemoteText;
        _ble.ConnectionChanged += OnConnectionChanged;

        try
        {
            var ok = await _ble.StartAsync();
            SetStatus(ok ? "Advertising…" : "Bluetooth unavailable — check adapter");
        }
        catch (Exception ex)
        {
            SetStatus($"BLE error: {ex.Message}");
        }
    }

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
            _trayIcon.ShowBalloonTip(2000, "ClipDropper", "Text received from iPhone", ToolTipIcon.Info);
        });
    }

    private void OnFileReceived(byte[] bytes, string filename)
    {
        var downloads = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        var dest = UniqueFilePath(downloads, filename);
        File.WriteAllBytes(dest, bytes);

        if (!IsDisposed && IsHandleCreated)
            Invoke(() => _trayIcon.ShowBalloonTip(
                3000, "ClipDropper", $"File saved: {filename}", ToolTipIcon.Info));
    }

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

    private static Icon MakeIcon(bool connected)
    {
        using var bmp = new Bitmap(16, 16);
        using var g   = Graphics.FromImage(bmp);
        g.Clear(Color.Transparent);
        using var brush = new SolidBrush(connected ? Color.LimeGreen : Color.DimGray);
        g.FillEllipse(brush, 2, 2, 12, 12);
        return Icon.FromHandle(bmp.GetHicon());
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        _clipboardMonitor?.Dispose();
        _ble?.Dispose();
        _http?.Dispose();
        base.OnFormClosed(e);
    }
}
