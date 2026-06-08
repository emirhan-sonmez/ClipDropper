import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BleManager, Device, BleError } from 'react-native-ble-plx';
import Clipboard from '@react-native-clipboard/clipboard';

// Must match GattProtocol.cs exactly
const SERVICE_UUID   = '4fafc201-1fb5-459e-8fcc-c5c9c3319abc';
const PC_TO_IOS_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const IOS_TO_PC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

type Status = 'idle' | 'scanning' | 'connecting' | 'connected' | 'disconnected' | 'error';

const manager = new BleManager({
  restoreStateIdentifier: 'ClipDropperBLERestoreIdentifier',
  restoreStateFunction: () => {},
});

export default function App() {
  const [status, setStatus]       = useState<Status>('idle');
  const [statusMsg, setStatusMsg] = useState('Tap Connect to find your PC');
  const [lastReceived, setLast]   = useState<string | null>(null);
  const deviceRef                 = useRef<Device | null>(null);

  useEffect(() => () => { manager.destroy(); }, []);

  function scan() {
    setStatus('scanning');
    setStatusMsg('Scanning for ClipDropper PC…');

    const timeout = setTimeout(() => {
      manager.stopDeviceScan();
      setStatus('idle');
      setStatusMsg('No PC found. Is ClipDropper running on your PC?');
    }, 15000);

    manager.startDeviceScan([SERVICE_UUID], null, (error, device) => {
      if (error) { clearTimeout(timeout); handleError(error); return; }
      if (device) { clearTimeout(timeout); manager.stopDeviceScan(); connect(device); }
    });
  }

  async function connect(device: Device) {
    try {
      setStatus('connecting');
      setStatusMsg(`Connecting to ${device.name ?? device.id}…`);

      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      deviceRef.current = connected;

      connected.onDisconnected(() => {
        deviceRef.current = null;
        setStatus('disconnected');
        setStatusMsg('Disconnected. Tap Connect to reconnect.');
      });

      // Receive clipboard from PC
      connected.monitorCharacteristicForService(SERVICE_UUID, PC_TO_IOS_UUID, (err, char) => {
        if (err || !char?.value) return;
        const text = base64ToUtf8(char.value);
        Clipboard.setString(text);
        setLast(text.length > 60 ? text.slice(0, 60) + '…' : text);
      });

      setStatus('connected');
      setStatusMsg(`Connected to ${device.name ?? device.id}`);
    } catch (e) {
      handleError(e as BleError);
    }
  }

  async function sendClipboard() {
    const device = deviceRef.current;
    if (!device) { Alert.alert('Not connected', 'Connect to your PC first.'); return; }
    try {
      const text = await Clipboard.getString();
      if (!text) { Alert.alert('Empty clipboard', 'Nothing to send.'); return; }
      const b64 = utf8ToBase64(text);
      await device.writeCharacteristicWithResponseForService(SERVICE_UUID, IOS_TO_PC_UUID, b64);
    } catch (e) {
      handleError(e as BleError);
    }
  }

  function handleError(e: BleError | Error) {
    setStatus('error');
    setStatusMsg((e as BleError).message ?? String(e));
  }

  const connected = status === 'connected';
  const busy      = status === 'scanning' || status === 'connecting';

  return (
    <View style={styles.root}>
      <Text style={styles.title}>ClipDropper</Text>
      <View style={[styles.dot, { backgroundColor: connected ? '#34c759' : '#8e8e93' }]} />
      <Text style={styles.statusMsg}>{statusMsg}</Text>

      {lastReceived && (
        <View style={styles.received}>
          <Text style={styles.receivedLabel}>Last received from PC:</Text>
          <Text style={styles.receivedText}>{lastReceived}</Text>
        </View>
      )}

      <View style={styles.buttons}>
        <Pressable
          style={[styles.btn, busy && styles.btnDisabled]}
          onPress={connected ? () => deviceRef.current?.cancelConnection() : scan}
          disabled={busy}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>{connected ? 'Disconnect' : 'Connect to PC'}</Text>}
        </Pressable>

        <Pressable
          style={[styles.btn, styles.btnSend, !connected && styles.btnDisabled]}
          onPress={sendClipboard}
          disabled={!connected}
        >
          <Text style={styles.btnText}>Send Clipboard → PC</Text>
        </Pressable>
      </View>

      <Text style={styles.hint}>Keep this app open to auto-receive clipboard from PC.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#f2f2f7', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title:         { fontSize: 28, fontWeight: '700', marginBottom: 16, color: '#1c1c1e' },
  dot:           { width: 20, height: 20, borderRadius: 10, marginBottom: 12 },
  statusMsg:     { fontSize: 15, color: '#3c3c43', textAlign: 'center', marginBottom: 24 },
  received:      { backgroundColor: '#fff', borderRadius: 12, padding: 14, width: '100%', marginBottom: 24 },
  receivedLabel: { fontSize: 12, color: '#8e8e93', marginBottom: 4 },
  receivedText:  { fontSize: 15, color: '#1c1c1e' },
  buttons:       { width: '100%', gap: 12, marginBottom: 24 },
  btn:           { backgroundColor: '#007aff', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnSend:       { backgroundColor: '#34c759' },
  btnDisabled:   { opacity: 0.4 },
  btnText:       { color: '#fff', fontSize: 16, fontWeight: '600' },
  hint:          { fontSize: 13, color: '#8e8e93', textAlign: 'center' },
});
