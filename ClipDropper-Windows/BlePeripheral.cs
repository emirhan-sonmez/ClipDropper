using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

namespace ClipDropper;

internal sealed class BlePeripheral : IDisposable
{
    private GattServiceProvider? _serviceProvider;
    private GattLocalCharacteristic? _pcToIos;
    private GattLocalCharacteristic? _iosToPc;
    private byte[] _lastSent = [];

    public event Action<string>? TextReceived;
    public event Action<bool>? ConnectionChanged;

    public async Task<bool> StartAsync()
    {
        var serviceResult = await GattServiceProvider.CreateAsync(GattProtocol.ServiceUuid);
        if (serviceResult.Error != BluetoothError.Success)
            return false;

        _serviceProvider = serviceResult.ServiceProvider;

        if (!await CreatePcToIos() || !await CreateIosToPc())
            return false;

        _serviceProvider.StartAdvertising(new GattServiceProviderAdvertisingParameters
        {
            IsConnectable = true,
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
        _pcToIos.ReadRequested += OnReadRequested;
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

    public async Task SendTextAsync(string text)
    {
        if (_pcToIos is null || _pcToIos.SubscribedClients.Count == 0)
            return;

        var bytes = System.Text.Encoding.UTF8.GetBytes(text);
        if (bytes.Length > GattProtocol.MaxTextBytes)
            bytes = System.Text.Encoding.UTF8.GetBytes(
                text[..Math.Min(text.Length, 80)] + "…(truncated — Phase 2 will fix)");

        _lastSent = bytes;

        using var writer = new DataWriter();
        writer.WriteBytes(bytes);
        var buffer = writer.DetachBuffer();

        foreach (var client in _pcToIos.SubscribedClients)
            await _pcToIos.NotifyValueAsync(buffer, client);
    }

    private async void OnReadRequested(GattLocalCharacteristic sender, GattReadRequestedEventArgs args)
    {
        using var deferral = args.GetDeferral();
        var request = await args.GetRequestAsync();
        using var writer = new DataWriter();
        writer.WriteBytes(_lastSent);
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

        TextReceived?.Invoke(System.Text.Encoding.UTF8.GetString(bytes));
    }

    private void OnSubscribedClientsChanged(GattLocalCharacteristic sender, object args) =>
        ConnectionChanged?.Invoke(sender.SubscribedClients.Count > 0);

    public void Dispose() => _serviceProvider?.StopAdvertising();
}
