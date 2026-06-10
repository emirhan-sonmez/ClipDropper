using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace ClipDropper;

internal sealed class HttpServer : IDisposable
{
    private readonly TcpListener    _listener;
    private readonly string         _token;
    private readonly PairingManager _pairing;
    private readonly CancellationTokenSource _cts = new();
    private volatile byte[]? _pendingImage;
    private volatile string? _pendingText;

    // Multiple files can be queued faster than iOS downloads them — keep the
    // last few keyed by name so rapid sends don't overwrite each other.
    private readonly object                     _fileLock     = new();
    private readonly Dictionary<string, byte[]> _pendingFiles = new();
    private readonly Queue<string>              _fileOrder    = new();
    private string                              _lastFileName = "";
    private const int MaxPendingFiles = 10;

    public event Action<byte[], string>? FileReceived;
    public event Action<string>?         TextReceived;
    public string Endpoint { get; private set; }

    public HttpServer(PairingManager pairing)
    {
        _pairing  = pairing;
        _token    = Guid.NewGuid().ToString("N")[..8];
        _listener = new TcpListener(IPAddress.Any, 0);
        _listener.Start();
        var port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        Endpoint = $"{GetLocalIp()}:{port}:{_token}";
        Task.Run(() => AcceptLoopAsync(_cts.Token));
    }

    // The listener is bound to IPAddress.Any, so port and token survive a network
    // change — only the advertised IP needs recomputing (e.g. after sleep/resume).
    public string RefreshEndpoint()
    {
        var port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        Endpoint = $"{GetLocalIp()}:{port}:{_token}";
        return Endpoint;
    }

    public void SetImage(byte[] pngBytes) => _pendingImage = pngBytes;

    public void SetText(string text) => _pendingText = text;

    public void SetPendingFile(byte[] bytes, string filename)
    {
        var name = Path.GetFileName(filename);
        lock (_fileLock)
        {
            if (!_pendingFiles.ContainsKey(name)) _fileOrder.Enqueue(name);
            _pendingFiles[name] = bytes;
            _lastFileName       = name;
            while (_fileOrder.Count > MaxPendingFiles)
                _pendingFiles.Remove(_fileOrder.Dequeue());
        }
    }

    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var client = await _listener.AcceptTcpClientAsync(ct);
                _ = Task.Run(() => HandleClientAsync(client));
            }
            catch { break; }
        }
    }

    private async Task HandleClientAsync(TcpClient client)
    {
        using var _ = client;
        using var stream = client.GetStream();

        // Read headers byte-by-byte until \r\n\r\n
        var hdrBuf = new List<byte>(2048);
        var one = new byte[1];
        while (hdrBuf.Count < 8192)
        {
            if (await stream.ReadAsync(one) == 0) return;
            hdrBuf.Add(one[0]);
            var n = hdrBuf.Count;
            if (n >= 4 && hdrBuf[n-4] == '\r' && hdrBuf[n-3] == '\n' &&
                          hdrBuf[n-2] == '\r' && hdrBuf[n-1] == '\n') break;
        }

        var lines = Encoding.UTF8.GetString(hdrBuf.ToArray()).Split("\r\n",
            StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length == 0) return;

        var parts = lines[0].Split(' ');
        if (parts.Length < 2) return;
        var method   = parts[0];
        var fullPath = parts[1];

        var qIdx  = fullPath.IndexOf('?');
        var path  = qIdx >= 0 ? fullPath[..qIdx] : fullPath;
        var query = ParseQuery(qIdx >= 0 ? fullPath[(qIdx + 1)..] : "");

        // Pairing route — uses its own one-time token, not the session token.
        if (method == "POST" && path == "/pair")
        {
            await HandlePairAsync(stream, lines, query);
            return;
        }

        if (!query.TryGetValue("token", out var tok) || tok != _token)
        {
            await RespondAsync(stream, 403, "text/plain", "Forbidden"u8.ToArray());
            return;
        }

        if (method == "GET" && path == "/clip/image")
        {
            var img = _pendingImage;
            if (img == null)
                await RespondAsync(stream, 404, "text/plain", "No image"u8.ToArray());
            else
                await RespondAsync(stream, 200, "image/png", img);
            return;
        }

        if (method == "GET" && path == "/clip/text")
        {
            var text = _pendingText;
            if (text == null)
                await RespondAsync(stream, 404, "text/plain", "No text"u8.ToArray());
            else
                await RespondAsync(stream, 200, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(text));
            return;
        }

        // iOS sends clipboard text too long for one BLE packet here
        if (method == "POST" && path == "/clip/text")
        {
            var contentLength = 0;
            foreach (var h in lines.Skip(1))
            {
                if (h.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                {
                    int.TryParse(h.Split(':', 2)[1].Trim(), out contentLength);
                    break;
                }
            }
            if (contentLength > 0 && contentLength <= 10 * 1024 * 1024)
            {
                var body = new byte[contentLength];
                await stream.ReadExactlyAsync(body);
                TextReceived?.Invoke(Encoding.UTF8.GetString(body));
            }
            await RespondAsync(stream, 200, "text/plain", "OK"u8.ToArray());
            return;
        }

        if (method == "GET" && path == "/clip/file")
        {
            byte[]? file;
            lock (_fileLock)
            {
                if (query.TryGetValue("name", out var reqName) &&
                    _pendingFiles.TryGetValue(Path.GetFileName(reqName), out var byName))
                    file = byName;
                else
                    file = _pendingFiles.TryGetValue(_lastFileName, out var last) ? last : null;
            }
            if (file == null)
                await RespondAsync(stream, 404, "text/plain", "No file"u8.ToArray());
            else
                await RespondAsync(stream, 200, "application/octet-stream", file);
            return;
        }

        if (method == "POST" && path == "/clip/upload")
        {
            query.TryGetValue("name", out var raw);
            var filename = Path.GetFileName(raw ?? "upload");

            var contentLength = 0;
            foreach (var h in lines.Skip(1))
            {
                if (h.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                {
                    contentLength = int.Parse(h.Split(':', 2)[1].Trim());
                    break;
                }
            }

            if (contentLength > 0)
            {
                var body = new byte[contentLength];
                await stream.ReadExactlyAsync(body);
                FileReceived?.Invoke(body, filename);
            }

            await RespondAsync(stream, 200, "text/plain", "OK"u8.ToArray());
            return;
        }

        await RespondAsync(stream, 404, "text/plain", "Not found"u8.ToArray());
    }

    private async Task HandlePairAsync(NetworkStream stream, string[] lines, Dictionary<string, string> query)
    {
        if (!query.TryGetValue("ptoken", out var ptoken))
        {
            await RespondAsync(stream, 400, "application/json", "{\"error\":\"missing_ptoken\"}"u8.ToArray());
            return;
        }

        var contentLength = 0;
        foreach (var h in lines.Skip(1))
        {
            if (h.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
            {
                int.TryParse(h.Split(':', 2)[1].Trim(), out contentLength);
                break;
            }
        }

        string deviceId = "", deviceName = "Unknown";
        if (contentLength > 0 && contentLength <= 4096)
        {
            var body = new byte[contentLength];
            await stream.ReadExactlyAsync(body);
            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                deviceId   = root.GetProperty("deviceId").GetString()   ?? "";
                deviceName = root.GetProperty("deviceName").GetString() ?? "Unknown";
            }
            catch { }
        }

        if (string.IsNullOrEmpty(deviceId))
        {
            await RespondAsync(stream, 400, "application/json", "{\"error\":\"missing_device_id\"}"u8.ToArray());
            return;
        }

        var result = _pairing.TryAccept(ptoken, deviceId, deviceName);
        var (code, json) = result switch
        {
            PairResult.Ok           => (200, "{\"status\":\"ok\"}"),
            PairResult.Expired      => (410, "{\"error\":\"expired\"}"),
            PairResult.InvalidToken => (410, "{\"error\":\"invalid_token\"}"),
            _                       => (400, "{\"error\":\"bad_request\"}")
        };
        await RespondAsync(stream, code, "application/json", Encoding.UTF8.GetBytes(json));
    }

    private static async Task RespondAsync(NetworkStream s, int code, string ct, byte[] body)
    {
        var status = code switch
        {
            200 => "OK", 400 => "Bad Request", 403 => "Forbidden",
            404 => "Not Found", 410 => "Gone", _ => "Error"
        };
        var hdr = $"HTTP/1.1 {code} {status}\r\nContent-Type: {ct}\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n";
        await s.WriteAsync(Encoding.UTF8.GetBytes(hdr));
        await s.WriteAsync(body);
    }

    private static Dictionary<string, string> ParseQuery(string q)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(q)) return d;
        foreach (var seg in q.Split('&'))
        {
            var kv = seg.Split('=', 2);
            if (kv.Length == 2)
                d[Uri.UnescapeDataString(kv[0])] = Uri.UnescapeDataString(kv[1]);
        }
        return d;
    }

    private static string GetLocalIp()
    {
        try
        {
            using var sock = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.IP);
            sock.Connect("8.8.8.8", 80);
            return ((IPEndPoint)sock.LocalEndPoint!).Address.ToString();
        }
        catch { return "127.0.0.1"; }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _listener.Stop();
    }
}
