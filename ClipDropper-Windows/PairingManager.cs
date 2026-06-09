namespace ClipDropper;

internal enum PairResult { Ok, Expired, InvalidToken }

internal sealed class PairingManager : IDisposable
{
    private readonly object _lock = new();
    private string? _pendingToken;
    private CancellationTokenSource? _timerCts;

    public const int TimeoutSeconds = 60;

    public event Action<string>? PairingSucceeded;        // arg: deviceName
    public event Action?         PairingExpiredOrCancelled;

    // Returns the one-time pairing URL. Cancels any previously active pairing session.
    public (string ptoken, string url) StartPairing(string httpEndpoint)
    {
        lock (_lock)
        {
            CancelPendingLocked();
            _pendingToken = Guid.NewGuid().ToString("N");
            _timerCts     = new CancellationTokenSource();
            var token = _pendingToken;
            // httpEndpoint format: "IP:PORT:SESSION_TOKEN"
            var parts = httpEndpoint.Split(':');
            var host  = parts[0];
            var port  = parts[1];
            var url   = $"clipdropper://pair?host={host}&port={port}&ptoken={token}";
            _ = ExpireAfterAsync(TimeoutSeconds, _timerCts.Token);
            return (token, url);
        }
    }

    // Called by HttpServer when iOS POSTs to /pair.
    public PairResult TryAccept(string ptoken, string deviceId, string deviceName)
    {
        Action<string>? succeeded = null;
        lock (_lock)
        {
            if (_pendingToken == null)    return PairResult.Expired;
            if (_pendingToken != ptoken)  return PairResult.InvalidToken;
            _pendingToken = null;
            _timerCts?.Cancel();
            SettingsStore.SavePairedDevice(deviceId, deviceName);
            succeeded = PairingSucceeded;
        }
        succeeded?.Invoke(deviceName);
        return PairResult.Ok;
    }

    public bool IsKnownDevice(string deviceId) =>
        SettingsStore.GetPairedDevices().ContainsKey(deviceId);

    public void Cancel()
    {
        Action? expired = null;
        lock (_lock)
        {
            if (_pendingToken != null)
            {
                CancelPendingLocked();
                expired = PairingExpiredOrCancelled;
            }
        }
        expired?.Invoke();
    }

    private async Task ExpireAfterAsync(int seconds, CancellationToken ct)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(seconds), ct);
            Action? expired = null;
            lock (_lock)
            {
                if (_pendingToken != null)
                {
                    _pendingToken = null;
                    expired = PairingExpiredOrCancelled;
                }
            }
            expired?.Invoke();
        }
        catch (OperationCanceledException) { }
    }

    private void CancelPendingLocked()
    {
        _pendingToken = null;
        _timerCts?.Cancel();
        _timerCts?.Dispose();
        _timerCts = null;
    }

    public void Dispose()
    {
        lock (_lock) CancelPendingLocked();
    }
}
