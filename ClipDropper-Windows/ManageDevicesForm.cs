namespace ClipDropper;

internal sealed class ManageDevicesForm : Form
{
    private readonly ListView _list;

    public ManageDevicesForm()
    {
        Text            = "ClipDropper — Paired Devices";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox     = false;
        TopMost         = true;
        ShowInTaskbar   = true;
        StartPosition   = FormStartPosition.CenterScreen;
        ClientSize      = new Size(400, 320);
        BackColor       = Color.White;

        var titleLabel = new Label
        {
            Text     = "Paired Devices",
            Location = new Point(12, 12),
            Size     = new Size(376, 22),
            Font     = new Font(SystemFonts.DefaultFont.FontFamily, 10f, FontStyle.Bold),
        };

        _list = new ListView
        {
            Location      = new Point(12, 42),
            Size          = new Size(376, 210),
            View          = View.Details,
            FullRowSelect = true,
            GridLines     = true,
            MultiSelect   = false,
            HeaderStyle   = ColumnHeaderStyle.Nonclickable,
        };
        _list.Columns.Add("Device Name", 270);
        _list.Columns.Add("ID (short)",  100);

        var revokeBtn = new Button
        {
            Text     = "Revoke Selected",
            Location = new Point(12, 264),
            Size     = new Size(130, 30),
        };
        revokeBtn.Click += OnRevoke;

        var closeBtn = new Button
        {
            Text     = "Close",
            Location = new Point(158, 264),
            Size     = new Size(80, 30),
        };
        closeBtn.Click += (_, _) => Close();

        Controls.AddRange(new Control[] { titleLabel, _list, revokeBtn, closeBtn });
        RefreshList();
    }

    private void RefreshList()
    {
        _list.Items.Clear();
        var devices = SettingsStore.GetPairedDevices();
        if (devices.Count == 0)
        {
            var placeholder = new ListViewItem("No paired devices yet.")
            {
                ForeColor = Color.Gray,
            };
            placeholder.SubItems.Add("");
            _list.Items.Add(placeholder);
            return;
        }

        foreach (var (id, name) in devices)
        {
            var item = new ListViewItem(name) { Tag = id };
            item.SubItems.Add(id.Length >= 8 ? id[..8] + "…" : id);
            _list.Items.Add(item);
        }
    }

    private void OnRevoke(object? sender, EventArgs e)
    {
        if (_list.SelectedItems.Count == 0) return;
        var selected = _list.SelectedItems[0];
        if (selected.Tag is string deviceId)
        {
            SettingsStore.RevokeDevice(deviceId);
            RefreshList();
        }
    }
}
