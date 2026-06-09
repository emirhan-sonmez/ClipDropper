namespace ClipDropper;

internal static class GattProtocol
{
    public static readonly Guid ServiceUuid = Guid.Parse("4fafc201-1fb5-459e-8fcc-c5c9c3319abc");
    public static readonly Guid PcToIosUuid = Guid.Parse("beb5483e-36e1-4688-b7f5-ea07361b26a8");
    public static readonly Guid IosToPcUuid = Guid.Parse("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
    // Read-only: "IP:PORT:TOKEN" so iOS can reach the local HTTP server
    public static readonly Guid PcHttpUuid  = Guid.Parse("f3641f28-cb91-4353-9a5b-2f3459b33f8a");

    public const int MaxBleBytes = 180;

    public const string PfxText  = "T:";
    public const string PfxImage = "I:";
    public const string PfxFile  = "F:";

    // Pairing handshake (iOS → Windows: PfxHello; Windows → iOS: MsgWelcome / MsgPairRequired)
    public const string PfxHello        = "HELLO:";        // followed by {deviceId}:{deviceName}
    public const string MsgWelcome      = "WELCOME";       // known device — proceed to normal mode
    public const string MsgPairRequired = "PAIR_REQUIRED"; // unknown device — scan QR to pair
}
