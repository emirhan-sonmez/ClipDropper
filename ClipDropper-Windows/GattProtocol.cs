namespace ClipDropper;

internal static class GattProtocol
{
    // Identifies ClipDropper on BLE scan — must match the iOS app exactly
    public static readonly Guid ServiceUuid =
        Guid.Parse("4fafc201-1fb5-459e-8fcc-c5c9c3319abc");

    // PC notifies iOS when clipboard changes; iOS reads this on connect
    public static readonly Guid PcToIosUuid =
        Guid.Parse("beb5483e-36e1-4688-b7f5-ea07361b26a8");

    // iOS writes clipboard text here; PC receives it
    public static readonly Guid IosToPcUuid =
        Guid.Parse("6e400002-b5a3-f393-e0a9-e50e24dcca9e");

    // Phase 1: single-packet limit (~180 bytes after BLE framing overhead).
    // Phase 2 will replace this with chunked transfer.
    public const int MaxTextBytes = 180;
}
