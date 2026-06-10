namespace ClipDropper;

// Small always-on-top window users can drag files/folders onto to send them
// to the paired device. Opt-in via the tray menu; hidden by default.
internal sealed class DropZoneForm : Form
{
    private readonly Func<string, Task> _sendFile;
    private readonly Func<string, Task> _sendFolder;
    private readonly Label _label;

    public DropZoneForm(Func<string, Task> sendFile, Func<string, Task> sendFolder)
    {
        _sendFile   = sendFile;
        _sendFolder = sendFolder;

        Text            = "ClipDropper";
        TopMost         = true;
        AllowDrop       = true;
        ShowInTaskbar   = false;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        StartPosition   = FormStartPosition.Manual;
        Size            = new Size(220, 130);
        BackColor       = Color.FromArgb(245, 245, 250);

        var wa = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 800, 600);
        Location = new Point(wa.Right - Width - 16, wa.Bottom - Height - 16);

        _label = new Label
        {
            Text      = "Drop files here\nto send to your device",
            Dock      = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            AllowDrop = true,
            ForeColor = Color.FromArgb(70, 70, 80),
        };
        Controls.Add(_label);

        // Wire both form and label — drags land on whichever is under the cursor
        DragEnter        += OnDragEnter;
        DragDrop         += OnDragDrop;
        _label.DragEnter += OnDragEnter;
        _label.DragDrop  += OnDragDrop;
    }

    private void OnDragEnter(object? sender, DragEventArgs e)
    {
        if (e.Data?.GetDataPresent(DataFormats.FileDrop) == true)
            e.Effect = DragDropEffects.Copy;
    }

    private async void OnDragDrop(object? sender, DragEventArgs e)
    {
        try
        {
            if (e.Data?.GetData(DataFormats.FileDrop) is not string[] paths) return;
            _label.Text = "Sending…";
            foreach (var p in paths)
            {
                if (File.Exists(p))           await _sendFile(p);
                else if (Directory.Exists(p)) await _sendFolder(p);
            }
        }
        catch { /* send path already notifies the user on failure */ }
        finally
        {
            _label.Text = "Drop files here\nto send to your device";
        }
    }
}
