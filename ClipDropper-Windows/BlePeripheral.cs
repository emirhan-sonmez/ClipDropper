using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

namespace ClipDropper;

internal sealed class BlePeripheral : IDisposable
{
    private readonly PairingManager   _pairing;
    private GattServiceProvider?      _serviceProvider;
    private GattLocalCharacteristic?  _pcToIos;
    private GattLocalCharacteristic?  _iosToPc;
    private GattLocalCharacteristic?  _pcHttp;
    private byte[] _lastSent          = [];
    private byte[] _httpEndpointBytes = [];
    private volatile bool _authorized;

    public event Action<string>? TextReceived;
    public event Action<bool>?   ConnectionChanged;

    public BlePeripheral(PairingManager pairing) => _pairing = pairing;

    public void SetHttpEndpoint(string endpoint) =>
        _httpEndpointBytes = System.Text.Encoding.UTF8.GetBytes(endpoint);

    public async Task<bool> StartAsync()
    {
        var serviceResult = await GattServiceProvider.CreateAsync(GattProtocol.ServiceUuid);
        if (serviceResult.Error != BluetoothError.Success) return false;

        _serviceProvider = serviceResult.ServiceProvider;

        if (!await CreatePcToIos() || !await CreateIosToPc() || !await CreatePcHttp())
            return false;

        _serviceProvider.StartAdvertising(new GattServiceProviderAdvertisingParameters
        {
            IsConnectable  = true,
            IsDiscoverable = true,
        });

        return true;
    }

    private async Task<bool> CreatePcToIos()
    {
        var r = await _serviceProvider!.Service.CreateCharacteristicAsync(
            GattProtocol.PcToIosUuid,
            new GattLocalCharacteristicParameters
            {
                CharacteristicProperties =
                    GattCharacteristicProperties.Notify | GattCharacteristicProperties.Read,
                ReadProtectionLevel = GattProtectionLevel.Plain,
            });
        if (r.Error != BluetoothError.Success) return false;
        _pcToIos = r.Characteristic;
        _pcToIos.ReadRequested += OnPcToIosRead;
        _pcToIos.SubscribedClientsChanged += OnSubscribedClientsChanged;
        return true;
    }

    private async Task<bool> CreateIosToPc()
    {
        var r = await _serviceProvider!.Service.CreateCharacteristicAsync(
            GattProtocol.IosToPcUuid,
            new GattLocalCharacteristicParameters
            {
                CharacteristicProperties =
                    GattCharacteristicProperties.Write | GattCharacteristicProperties.WriteWithoutResponse,
                WriteProtectionLevel = GattProtectionLevel.Plain,
            });
        if (r.Error != BluetoothError.Success) return false;
        _iosToPc = r.Characteristic;
        _iosToPc.WriteRequested += OnWriteRequested;
        return true;
    }

    private async Task<bool> CreatePcHttp()
    {
        var r = await _serviceProvider!.Service.CreateCharacteristicAsync(
            GattProtocol.PcHttpUuid,
            new GattLocalCharacteristicParameters
            {
                CharacteristicProperties = GattCharacteristicProperties.Read,
                ReadProtectionLevel      = GattProtectionLevel.Plain,
            });
        if (r.Error != BluetoothError.Success) return false;
        _pcHttp = r.Characteristic;
        _pcHttp.ReadRequested += OnPcHttpRead;
        return true;
    }

    public async Task SendTextAsync(string text)
    {
        if (!_authorized || _pcToIos is null || _pcToIos.SubscribedClients.Count == 0) return;

        var content = GattProtocol.PfxText + text;
        var bytes   = System.Text.Encoding.UTF8.GetBytes(content);

        if (bytes.Length > GattProtocol.MaxBleBytes)
        {
            content = GattProtocol.PfxText + text[..Math.Min(text.Length, 80)] + "…";
            bytes   = System.Text.Encoding.UTF8.GetBytes(content);
        }

        _lastSent = bytes;
        await NotifyAsync(bytes);
    }

    public async Task NotifyImageAvailableAsync()
    {
        if (!_authorized) return;
        var bytes = System.Text.Encoding.UTF8.GetBytes(GattProtocol.PfxImage);
        _lastSent = bytes;
        if (_pcToIos is null || _pcToIos.SubscribedClients.Count == 0) return;
        await NotifyAsync(bytes);
    }

    public async Task NotifyFileAvailableAsync(string filename)
    {
        if (!_authorized) return;
        var bytes = System.Text.Encoding.UTF8.GetBytes(GattProtocol.PfxFile + filename);
        _lastSent = bytes;
        if (_pcToIos is null || _pcToIos.SubscribedClients.Count == 0) return;
        await NotifyAsync(bytes);
    }

    private async Task NotifyAsync(byte[] bytes)
    {
        using var writer = new DataWriter();
        writer.WriteBytes(bytes);
        var buffer = writer.DetachBuffer();
        foreach (var client in _pcToIos!.SubscribedClients)
            await _pcToIos.NotifyValueAsync(buffer, client);
    }

    private async void OnPcToIosRead(GattLocalCharacteristic sender, GattReadRequestedEventArgs args)
    {
        using var deferral = args.GetDeferral();
        var request = await args.GetRequestAsync();
        using var writer = new DataWriter();
        writer.WriteBytes(_lastSent);
        request.RespondWithValue(writer.DetachBuffer());
    }

    private async void OnPcHttpRead(GattLocalCharacteristic sender, GattReadRequestedEventArgs args)
    {
        using var deferral = args.GetDeferral();
        var request = await args.GetRequestAsync();
        using var writer = new DataWriter();
        // Only reveal the HTTP endpoint to authorized (paired) devices.
        writer.WriteBytes(_authorized ? _httpEndpointBytes : []);
        request.RespondWithValue(writer.DetachBuffer());
    }

    private async void OnWriteRequested(GattLocalCharacteristic sender, GattWriteRequestedEventArgs args)
    {
        using var deferral = args.GetDeferral();
        var request = await args.GetRequestAsync();

        using var reader = DataReader.FromBuffer(request.Value);
        var bytes = new byte[request.Value.Length];
        reader.ReadBytes(bytes);

        if (request.Option == GattWriteOption.WriteWithResponse)
            request.Respond();

        var msg = System.Text.Encoding.UTF8.GetString(bytes);

        if (msg.StartsWith(GattProtocol.PfxHello))
        {
            // Format: HELLO:{deviceId}:{deviceName}
            var payload = msg[GattProtocol.PfxHello.Length..];
            var sep     = payload.IndexOf(':');
            if (sep > 0)
            {
                var deviceId   = payload[..sep];
                var deviceName = payload[(sep + 1)..];
                if (_pairing.IsKnownDevice(deviceId))
                {
                    _authorized = true;
                    await NotifyAsync(System.Text.Encoding.UTF8.GetBytes(GattProtocol.MsgWelcome));
                    ConnectionChanged?.Invoke(true);
                }
                else
                {
                    _authorized = false;
                    await NotifyAsync(System.Text.Encoding.UTF8.GetBytes(GattProtocol.MsgPairRequired));
                }
            }
            return;
        }

        // Ignore all clipboard data from unpaired devices.
        if (!_authorized) return;

        if (msg.StartsWith(GattProtocol.PfxText))
            TextReceived?.Invoke(msg[GattProtocol.PfxText.Length..]);
    }

    private void OnSubscribedClientsChanged(GattLocalCharacteristic sender, object args)
    {
        if (sender.SubscribedClients.Count == 0)
        {
            // Device disconnected — reset authorization and notify.
            _authorized = false;
            ConnectionChanged?.Invoke(false);
        }
        // ConnectionChanged(true) is deferred until the HELLO/WELCOME exchange completes.
    }

    public void Dispose() => _serviceProvider?.StopAdvertising();
}
