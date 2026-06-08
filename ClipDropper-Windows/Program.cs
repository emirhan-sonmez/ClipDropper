using System.IO.Pipes;

namespace ClipDropper;

static class Program
{
    internal const string PipeName = "ClipDropper.IPC";

    [STAThread]
    static void Main(string[] args)
    {
        // When launched via "Send to" from Explorer, relay file paths to the
        // already-running instance and exit immediately.
        if (args.Length > 0)
        {
            try
            {
                using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
                pipe.Connect(500);
                using var writer = new StreamWriter(pipe);
                foreach (var arg in args)
                    writer.WriteLine(arg);
                return;
            }
            catch { /* no running instance — fall through to normal startup */ }
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
    }
}
