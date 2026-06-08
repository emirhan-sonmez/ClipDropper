using System.ComponentModel;
using System.Runtime.InteropServices;

namespace ClipDropper;

internal sealed class ClipboardMonitor : NativeWindow, IDisposable
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool AddClipboardFormatListener(IntPtr hwnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RemoveClipboardFormatListener(IntPtr hwnd);

    private const int WM_CLIPBOARDUPDATE = 0x031D;

    public event Action<string>? TextCopied;
    public event Action<Bitmap>? ImageCopied;

    public ClipboardMonitor()
    {
        CreateHandle(new CreateParams());
        if (!AddClipboardFormatListener(Handle))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Failed to register clipboard listener.");
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_CLIPBOARDUPDATE)
        {
            try
            {
                if (Clipboard.ContainsText())
                {
                    var text = Clipboard.GetText();
                    if (!string.IsNullOrEmpty(text))
                        TextCopied?.Invoke(text);
                }
                else if (Clipboard.ContainsImage())
                {
                    var img = Clipboard.GetImage();
                    if (img is Bitmap bmp)
                        ImageCopied?.Invoke(bmp);
                    else if (img != null)
                        ImageCopied?.Invoke(new Bitmap(img));
                }
            }
            catch (ExternalException) { /* clipboard locked by another process — skip */ }
        }
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        RemoveClipboardFormatListener(Handle);
        DestroyHandle();
    }
}
