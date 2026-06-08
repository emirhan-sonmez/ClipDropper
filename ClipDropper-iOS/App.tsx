import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BleManager, Device, BleError } from 'react-native-ble-plx';
import Clipboard from '@react-native-clipboard/clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

const SERVICE_UUID   = '4fafc201-1fb5-459e-8fcc-c5c9c3319abc';
const PC_TO_IOS_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const IOS_TO_PC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const PC_HTTP_UUID   = 'f3641f28-cb91-4353-9a5b-2f3459b33f8a';

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
type LastItem =
  | { kind: 'text'; content: string }
  | { kind: 'image'; uri: string }
  | { kind: 'file'; name: string }
  | null;

const manager = new BleManager({
  restoreStateIdentifier: 'ClipDropperBLERestoreIdentifier',
  restoreStateFunction: () => {},
});

export default function App() {
  const [status, setStatus]     = useState<Status>('idle');
  const [statusMsg, setMsg]     = useState('Tap Connect to find your PC');
  const [lastItem, setLastItem] = useState<LastItem>(null);
  const deviceRef = useRef<Device | null>(null);
  const httpRef   = useRef<{ ip: string; port: string; token: string } | null>(null);

  useEffect(() => () => { manager.destroy(); }, []);

  function scan() {
    setStatus('scanning');
    setMsg('Scanning for ClipDropper PC…');

    const timeout = setTimeout(() => {
      manager.stopDeviceScan();
      setStatus('idle');
      setMsg('No PC found. Is ClipDropper running on your PC?');
    }, 15000);

    manager.startDeviceScan([SERVICE_UUID], null, (error, device) => {
      if (error) { clearTimeout(timeout); handleError(error); return; }
      if (device) { clearTimeout(timeout); manager.stopDeviceScan(); connect(device); }
    });
  }

  async function connect(device: Device) {
    try {
      setStatus('connecting');
      setMsg(`Connecting to ${device.name ?? 'ClipDropper PC'}…`);

      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      deviceRef.current = connected;

      // Read HTTP endpoint so we can download images and receive files
      try {
        const httpChar = await connected.readCharacteristicForService(SERVICE_UUID, PC_HTTP_UUID);
        if (httpChar.value) {
          const parts = base64ToUtf8(httpChar.value).split(':');
          httpRef.current = { ip: parts[0], port: parts[1], token: parts[2] };
        }
      } catch { /* older PC version without HTTP support */ }

      connected.onDisconnected(() => {
        deviceRef.current = null;
        httpRef.current   = null;
        setStatus('disconnected');
        setMsg('Disconnected. Tap Connect to reconnect.');
      });

      connected.monitorCharacteristicForService(SERVICE_UUID, PC_TO_IOS_UUID, async (err, char) => {
        if (err || !char?.value) return;
        const msg = base64ToUtf8(char.value);

        if (msg.startsWith('T:')) {
          const text = msg.slice(2);
          Clipboard.setString(text);
          setLastItem({ kind: 'text', content: text.length > 60 ? text.slice(0, 60) + '…' : text });
          return;
        }

        if (msg === 'I:') {
          if (!httpRef.current) {
            Alert.alert(
              'PC image',
              'Image copied on PC but HTTP endpoint not available.\n\nFix: restart the ClipDropper PC app, reconnect, then try again.',
            );
            return;
          }
          const { ip, port, token } = httpRef.current;
          const dest = (FileSystem.cacheDirectory ?? '') + 'clipboard_img.png';
          try {
            const dl = await FileSystem.downloadAsync(
              `http://${ip}:${port}/clip/image?token=${token}`, dest);
            if (dl.status !== 200) {
              Alert.alert('Image failed', `HTTP ${dl.status} from ${ip}:${port}\n\nCheck: same WiFi? Windows Firewall allowed?`);
              return;
            }
            const b64 = await FileSystem.readAsStringAsync(dest,
              { encoding: FileSystem.EncodingType.Base64 });
            Clipboard.setImage(b64);
            setLastItem({ kind: 'image', uri: dest + '?t=' + Date.now() });
          } catch (e) {
            Alert.alert('Image failed', `Could not reach ${ip}:${port}\n${String(e)}\n\nCheck: same WiFi? Windows Firewall allowed?`);
          }
        }
      });

      setStatus('connected');
      const httpReady = httpRef.current ? ' · HTTP ready' : ' · No HTTP (restart PC app)';
      setMsg(`Connected to ${device.name ?? 'ClipDropper PC'}${httpReady}`);
    } catch (e) {
      handleError(e as BleError);
    }
  }

  async function sendClipboard() {
    if (!deviceRef.current) { Alert.alert('Not connected', 'Connect to your PC first.'); return; }
    try {
      const hasImg = await Clipboard.hasImage();
      if (hasImg) {
        if (!httpRef.current) {
          Alert.alert('Not available', 'HTTP not ready. Restart the PC app, reconnect, then try again.');
          return;
        }
        const raw = await Clipboard.getImage();
        if (!raw) { Alert.alert('No image', 'Could not read clipboard image.'); return; }
        const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        await uploadBytes(bytes, 'clipboard_image.png');
        return;
      }
      const text = await Clipboard.getString();
      if (!text) { Alert.alert('Empty clipboard', 'Nothing to send.'); return; }
      await deviceRef.current.writeCharacteristicWithResponseForService(
        SERVICE_UUID, IOS_TO_PC_UUID, utf8ToBase64('T:' + text));
    } catch (e) { handleError(e as BleError); }
  }

  async function pickAndSendFile() {
    const http = httpRef.current;
    if (!http) { Alert.alert('Not connected', 'Connect to your PC first.'); return; }

    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;

    const file = result.assets[0];
    try {
      const b64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      await uploadBytes(bytes, file.name);
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    }
  }

  async function uploadBytes(bytes: Uint8Array, filename: string): Promise<boolean> {
    const http = httpRef.current;
    if (!http) { Alert.alert('Not connected', 'Connect to your PC first.'); return false; }
    const url = `http://${http.ip}:${http.port}/clip/upload?token=${http.token}&name=${encodeURIComponent(filename)}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes.buffer,
      });
      if (res.ok) {
        setLastItem({ kind: 'file', name: filename });
        Alert.alert('Sent!', `${filename} saved to your PC's Downloads folder.`);
        return true;
      }
      Alert.alert('Upload failed', `Server returned ${res.status}`);
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    }
    return false;
  }

  async function pickAndSendPhoto() {
    if (!httpRef.current) { Alert.alert('Not connected', 'Connect to your PC first.'); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission denied', 'Allow photo library access in Settings to send photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    try {
      const b64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      await uploadBytes(bytes, asset.fileName ?? 'photo.jpg');
    } catch (e) {
      Alert.alert('Failed', String(e));
    }
  }

  function handleError(e: BleError | Error) {
    setStatus('error');
    setMsg((e as BleError).message ?? String(e));
  }

  const connected = status === 'connected';
  const busy      = status === 'scanning' || status === 'connecting';

  return (
    <View style={styles.root}>
      <Text style={styles.title}>ClipDropper</Text>
      <View style={[styles.dot, { backgroundColor: connected ? '#34c759' : '#8e8e93' }]} />
      <Text style={styles.statusMsg}>{statusMsg}</Text>

      {lastItem?.kind === 'text' && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Last text from PC</Text>
          <Text style={styles.cardText}>{lastItem.content}</Text>
        </View>
      )}

      {lastItem?.kind === 'image' && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Image received from PC</Text>
          <Image source={{ uri: lastItem.uri }} style={styles.preview} resizeMode="contain" />
        </View>
      )}

      {lastItem?.kind === 'file' && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>File sent to PC</Text>
          <Text style={styles.cardText}>{lastItem.name}</Text>
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
          style={[styles.btn, styles.btnGreen, !connected && styles.btnDisabled]}
          onPress={sendClipboard}
          disabled={!connected}
        >
          <Text style={styles.btnText}>Send Clipboard → PC</Text>
        </Pressable>

        <Pressable
          style={[styles.btn, styles.btnOrange, !connected && styles.btnDisabled]}
          onPress={pickAndSendFile}
          disabled={!connected}
        >
          <Text style={styles.btnText}>Pick File → PC</Text>
        </Pressable>

        <Pressable
          style={[styles.btn, styles.btnTeal, !connected && styles.btnDisabled]}
          onPress={pickAndSendPhoto}
          disabled={!connected}
        >
          <Text style={styles.btnText}>Pick Photo → PC</Text>
        </Pressable>
      </View>

      <Text style={styles.hint}>
        Copy on PC to auto-receive. Use buttons to send to PC.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: '#f2f2f7', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title:     { fontSize: 28, fontWeight: '700', marginBottom: 16, color: '#1c1c1e' },
  dot:       { width: 20, height: 20, borderRadius: 10, marginBottom: 12 },
  statusMsg: { fontSize: 15, color: '#3c3c43', textAlign: 'center', marginBottom: 24 },
  card:      { backgroundColor: '#fff', borderRadius: 12, padding: 14, width: '100%', marginBottom: 20 },
  cardLabel: { fontSize: 12, color: '#8e8e93', marginBottom: 6 },
  cardText:  { fontSize: 15, color: '#1c1c1e' },
  preview:   { width: '100%', height: 160, borderRadius: 8, backgroundColor: '#f0f0f0' },
  buttons:   { width: '100%', gap: 12, marginBottom: 24 },
  btn:       { backgroundColor: '#007aff', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnGreen:  { backgroundColor: '#34c759' },
  btnOrange:  { backgroundColor: '#ff9500' },
  btnPurple:  { backgroundColor: '#af52de' },
  btnTeal:    { backgroundColor: '#32ade6' },
  btnDisabled: { opacity: 0.4 },
  btnText:   { color: '#fff', fontSize: 16, fontWeight: '600' },
  hint:      { fontSize: 13, color: '#8e8e93', textAlign: 'center' },
});
