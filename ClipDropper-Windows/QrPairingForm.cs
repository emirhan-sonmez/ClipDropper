using QRCoder;

namespace ClipDropper;

internal sealed class QrPairingForm : Form
{
    private readonly PairingManager _pairing;
    private readonly PictureBox     _qrBox;
    private readonly Label          _countdownLabel;
    private readonly System.Windows.Forms.Timer _uiTimer;
    private int  _countdown;
    private bool _closing;

    public QrPairingForm(PairingManager pairing, string qrUrl)
    {
        _pairing   = pairing;
        _countdown = PairingManager.TimeoutSeconds;

        Text            = "ClipDropper — Pair New Device";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox     = false;
        MinimizeBox     = false;
        TopMost         = true;
        ShowInTaskbar   = true;
        StartPosition   = FormStartPosition.CenterScreen;
        ClientSize      = new Size(300, 380);
        BackColor       = Color.White;

        _qrBox = new PictureBox
        {
            Location = new Point(22, 16),
            Size     = new Size(256, 256),
            SizeMode = PictureBoxSizeMode.Zoom,
        };

        var instrLabel = new Label
        {
            Text      = "Scan with ClipDropper on your iPhone",
            Location  = new Point(10, 282),
            Size      = new Size(280, 20),
            TextAlign = ContentAlignment.MiddleCenter,
        };

        _countdownLabel = new Label
        {
            Text      = $"Expires in {_countdown}s",
            Location  = new Point(10, 306),
            Size      = new Size(280, 18),
            TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = Color.Gray,
        };

        var cancelBtn = new Button
        {
            Text     = "Cancel",
            Location = new Point(110, 334),
            Size     = new Size(80, 30),
        };
        cancelBtn.Click += (_, _) => { _pairing.Cancel(); SafeClose(); };

        Controls.AddRange(new Control[] { _qrBox, instrLabel, _countdownLabel, cancelBtn });

        try
        {
            using var gen  = new QRCodeGenerator();
            using var data = gen.CreateQrCode(qrUrl, QRCodeGenerator.ECCLevel.Q);
            using var qr   = new QRCode(data);
            _qrBox.Image   = qr.GetGraphic(8);
        }
        catch
        {
            var errLabel = new Label
            {
                Text      = "Could not generate QR code.",
                Location  = new Point(22, 120),
                Size      = new Size(256, 40),
                TextAlign = ContentAlignment.MiddleCenter,
                ForeColor = Color.Red,
            };
            Controls.Add(errLabel);
        }

        _uiTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        _uiTimer.Tick += OnTick;
        _uiTimer.Start();

        _pairing.PairingSucceeded          += OnPairingSucceeded;
        _pairing.PairingExpiredOrCancelled += OnPairingExpiredOrCancelled;

        FormClosed += OnFormClosed;
    }

    private void OnTick(object? sender, EventArgs e)
    {
        _countdown--;
        _countdownLabel.Text = $"Expires in {_countdown}s";
        if (_countdown <= 0)
        {
            _countdownLabel.Text = "Expired";
            _uiTimer.Stop();
        }
    }

    private void OnPairingSucceeded(string _)  => SafeInvokeClose();
    private void OnPairingExpiredOrCancelled() => SafeInvokeClose();

    private void SafeInvokeClose()
    {
        if (_closing || IsDisposed) return;
        if (InvokeRequired) BeginInvoke(SafeClose);
        else SafeClose();
    }

    private void SafeClose()
    {
        if (_closing || IsDisposed) return;
        _closing = true;
        Close();
    }

    private void OnFormClosed(object? sender, FormClosedEventArgs e)
    {
        _uiTimer.Stop();
        _uiTimer.Dispose();
        _pairing.PairingSucceeded          -= OnPairingSucceeded;
        _pairing.PairingExpiredOrCancelled -= OnPairingExpiredOrCancelled;
        _qrBox.Image?.Dispose();
    }
}
