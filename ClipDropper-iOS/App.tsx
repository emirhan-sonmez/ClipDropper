import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Vibration,
  useColorScheme,
} from 'react-native';
import { BleManager, Device, BleError, BleErrorCode } from 'react-native-ble-plx';
import Clipboard from '@react-native-clipboard/clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { CameraView, useCameraPermissions } from 'expo-camera';

const SERVICE_UUID   = '4fafc201-1fb5-459e-8fcc-c5c9c3319abc';
const PC_TO_IOS_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const IOS_TO_PC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const PC_HTTP_UUID   = 'f3641f28-cb91-4353-9a5b-2f3459b33f8a';
const MAX_FILE_MB    = 50;
const HIST_MAX       = 5;
const DEVICE_ID_FILE = '.deviceId';

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

function newUUID(): string {
  try {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }
}

function parseQrUrl(url: string): { host: string; port: string; ptoken: string } | null {
  const q = url.indexOf('?');
  if (q === -1) return null;
  const params: Record<string, string> = {};
  url.slice(q + 1).split('&').forEach(part => {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
  });
  const { host, port, ptoken } = params;
  if (!host || !port || !ptoken) return null;
  return { host, port, ptoken };
}

function dotColor(s: Status, rssi: number | null): string {
  if (s !== 'connected') return '#8e8e93';
  if (rssi === null || rssi >= -70) return '#34c759';
  if (rssi >= -80) return '#ffd60a';
  return '#ff9500';
}

function makeColors(dark: boolean) {
  return {
    bg:    dark ? '#1c1c1e' : '#f2f2f7',
    card:  dark ? '#2c2c2e' : '#ffffff',
    text:  dark ? '#ffffff' : '#1c1c1e',
    sub:   dark ? '#8e8e93' : '#3c3c43',
    rowBg: dark ? '#3a3a3c' : '#f0f0f5',
  };
}

type Status    = 'idle' | 'scanning' | 'connecting' | 'connected' | 'disconnected' | 'error';
type ThemePref = 'system' | 'dark' | 'light';
type LastItem  =
  | { kind: 'text';  content: string }
  | { kind: 'image'; uri: string }
  | { kind: 'file';  name: string }
  | null;

type HistItemData =
  | { kind: 'text';  label: string; value: string }
  | { kind: 'image'; label: string; uri: string }
  | { kind: 'file';  label: string; localPath?: string };
type HistItem = HistItemData & { id: number };

const MY_DEVICE_NAME = Platform.isPad ? 'iPad' : 'iPhone';

const manager = new BleManager({
  restoreStateIdentifier: 'ClipDropperBLERestoreIdentifier',
  restoreStateFunction: () => {},
});
let _hid = 0;

function HistRow({ item, colors }: { item: HistItem; colors: ReturnType<typeof makeColors> }) {
  const flash  = useRef(new Animated.Value(0)).current;
  const canAct = item.kind === 'text' || item.kind === 'image' ||
                 (item.kind === 'file' && !!item.localPath);
  const hint   = item.kind === 'file' ? 'tap to save' : 'tap to copy';

  async function handlePress() {
    Vibration.vibrate(50);
    Animated.sequence([
      Animated.timing(flash, { toValue: 1, duration: 120, useNativeDriver: false }),
      Animated.timing(flash, { toValue: 0, duration: 530, useNativeDriver: false }),
    ]).start();

    if (item.kind === 'text') {
      Clipboard.setString(item.value);
    } else if (item.kind === 'image') {
      try {
        const path = item.uri.split('?')[0];
        const b64  = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
        Clipboard.setImage(b64);
      } catch { /* cache evicted */ }
    } else if (item.kind === 'file' && item.localPath) {
      try {
        const info = await FileSystem.getInfoAsync(item.localPath);
        if (!info.exists) {
          Alert.alert('File unavailable', 'This file is no longer in cache. Send it again from your PC.');
          return;
        }
        const name = item.localPath.split('/').pop() ?? item.label;
        await Sharing.shareAsync(item.localPath, { dialogTitle: `Save ${name}` });
      } catch (e) { Alert.alert('Error', String(e)); }
    }
  }

  const bgColor = flash.interpolate({ inputRange: [0, 1], outputRange: [colors.rowBg, '#1a6bff'] });

  return (
    <Pressable onPress={canAct ? handlePress : undefined}>
      <Animated.View style={[styles.histRow, { backgroundColor: bgColor }]}>
        {item.kind === 'image' && (
          <Image source={{ uri: item.uri }} style={styles.histThumb} resizeMode="cover" />
        )}
        <Text style={[styles.histLabel, { color: colors.text }]} numberOfLines={1}>{item.label}</Text>
        {canAct && <Text style={[styles.histHint, { color: colors.sub }]}>{hint}</Text>}
      </Animated.View>
    </Pressable>
  );
}

export default function App() {
  const systemScheme = useColorScheme();

  const [status,        setStatus]        = useState<Status>('idle');
  const [statusMsg,     setMsg]           = useState('Tap Connect to find your PC');
  const [lastItem,      setLastItem]      = useState<LastItem>(null);
  const [rssi,          setRssi]          = useState<number | null>(null);
  const [history,       setHistory]       = useState<HistItem[]>([]);
  const [showOnboard,   setShowOnboard]   = useState(false);
  const [themePref,     setThemePref]     = useState<ThemePref>('system');
  const [pairRequired,  setPairRequired]  = useState(false);
  const [showScanner,   setShowScanner]   = useState(false);

  const deviceRef          = useRef<Device | null>(null);
  const httpRef            = useRef<{ ip: string; port: string; token: string } | null>(null);
  const noAutoReconnect        = useRef(false);
  const rssiTimer          = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPcMsg          = useRef('');
  const deviceUUIDRef      = useRef(newUUID()); // pre-filled so deep links never race
  const handshakeCompleted = useRef(false);
  const gotPairRequired    = useRef(false);
  const qrScannedRef       = useRef(false);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const isDark = themePref === 'system' ? systemScheme === 'dark' : themePref === 'dark';
  const colors = makeColors(isDark);

  function pushItem(item: HistItemData) {
    setHistory(prev => [{ ...item, id: ++_hid } as HistItem, ...prev].slice(0, HIST_MAX));
  }

  // Load or generate persistent device UUID
  useEffect(() => {
    const path = (FileSystem.documentDirectory ?? '') + DEVICE_ID_FILE;
    FileSystem.readAsStringAsync(path)
      .then(id => { deviceUUIDRef.current = id; })
      .catch(() => {
        // ref already has a UUID pre-filled at init; just persist it
        FileSystem.writeAsStringAsync(path, deviceUUIDRef.current).catch(() => {});
      });
  }, []);

  // Auto-scan when BLE powers on
  useEffect(() => {
    const sub = manager.onStateChange((state) => {
      if (state === 'PoweredOn') { sub.remove(); scan(); }
    }, true);
    return () => { sub.remove(); manager.destroy(); };
  }, []);

  // Show onboarding once
  useEffect(() => {
    const flag = (FileSystem.documentDirectory ?? '') + '.onboarded';
    FileSystem.getInfoAsync(flag).then(i => { if (!i.exists) setShowOnboard(true); }).catch(() => {});
  }, []);

  // Load persisted theme preference
  useEffect(() => {
    FileSystem.readAsStringAsync((FileSystem.documentDirectory ?? '') + '.theme')
      .then(v => { if (v === 'dark' || v === 'light' || v === 'system') setThemePref(v as ThemePref); })
      .catch(() => {});
  }, []);

  // When app comes to foreground, pull the latest PC characteristic in case a BLE
  // notification fired while iOS had the app suspended
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      if (next !== 'active' || !deviceRef.current) return;
      try {
        const char = await deviceRef.current.readCharacteristicForService(SERVICE_UUID, PC_TO_IOS_UUID);
        if (char.value) {
          const msg = base64ToUtf8(char.value);
          if (msg && msg !== lastPcMsg.current && (msg.startsWith('T:') || msg === 'I:'))
            applyPcMsg(msg).catch(() => {});
        }
      } catch { /* device may not be ready yet */ }
    });
    return () => sub.remove();
  }, []);

  async function applyPcMsg(msg: string): Promise<void> {
    if (msg.startsWith('T:')) {
      const text  = msg.slice(2);
      const label = `↓ "${text.length > 40 ? text.slice(0, 40) + '…' : text}"`;
      Clipboard.setString(text);
      setLastItem({ kind: 'text', content: text.length > 40 ? text.slice(0, 40) + '…' : text });
      pushItem({ kind: 'text', label, value: text });
      lastPcMsg.current = msg;
      return;
    }
    if (msg === 'I:') {
      if (!httpRef.current) throw new Error('HTTP not available. Restart PC app and reconnect.');
      const { ip, port, token } = httpRef.current;
      const res = await fetch(`http://${ip}:${port}/clip/image?token=${token}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${ip}:${port} — check same WiFi & Firewall.`);
      const buf   = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const CHUNK = 0x8000;
      let binary  = '';
      for (let i = 0; i < bytes.length; i += CHUNK)
        binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
      const b64  = btoa(binary);
      Clipboard.setImage(b64);
      const dest = (FileSystem.cacheDirectory ?? '') + `clip_img_${Date.now()}.png`;
      FileSystem.writeAsStringAsync(dest, b64, { encoding: FileSystem.EncodingType.Base64 })
        .then(() => {
          const uri = dest + '?t=' + Date.now();
          setLastItem({ kind: 'image', uri });
          pushItem({ kind: 'image', label: '↓ Image from PC', uri });
        })
        .catch(() => {
          setLastItem({ kind: 'text', content: '[Image copied to clipboard]' });
          pushItem({ kind: 'text', label: '↓ Image from PC', value: '[Image copied to clipboard]' });
        });
      lastPcMsg.current = msg;
    }
  }

  async function dismissOnboard() {
    try { await FileSystem.writeAsStringAsync((FileSystem.documentDirectory ?? '') + '.onboarded', '1'); }
    catch { /* ignore */ }
    setShowOnboard(false);
  }

  function cycleTheme() {
    const next: ThemePref = themePref === 'system' ? 'dark' : themePref === 'dark' ? 'light' : 'system';
    setThemePref(next);
    FileSystem.writeAsStringAsync((FileSystem.documentDirectory ?? '') + '.theme', next).catch(() => {});
  }

  function scan() {
    noAutoReconnect.current = false;
    setStatus('scanning');
    setMsg('Scanning for ClipDropper PC…');
    const t = setTimeout(() => {
      manager.stopDeviceScan();
      setStatus('idle');
      setMsg('No PC found. Is ClipDropper running on your PC?');
    }, 15000);
    manager.startDeviceScan([SERVICE_UUID], null, (err, dev) => {
      if (err) { clearTimeout(t); handleError(err); return; }
      if (dev) { clearTimeout(t); manager.stopDeviceScan(); connect(dev); }
    });
  }

  function setupRssiPolling(conn: Device) {
    conn.readRSSI().then(d => setRssi(d.rssi ?? null)).catch(() => {});
    rssiTimer.current = setInterval(async () => {
      try { setRssi((await conn.readRSSI()).rssi ?? null); }
      catch { if (rssiTimer.current) { clearInterval(rssiTimer.current); rssiTimer.current = null; } }
    }, 5000);
  }

  async function connect(device: Device) {
    try {
      setStatus('connecting');
      setMsg(`Connecting to ${device.name ?? 'ClipDropper PC'}…`);
      const conn = await device.connect({ timeout: 10000 });
      await conn.discoverAllServicesAndCharacteristics();
      deviceRef.current          = conn;
      handshakeCompleted.current = false;
      gotPairRequired.current    = false;

      conn.onDisconnected(() => {
        if (rssiTimer.current) { clearInterval(rssiTimer.current); rssiTimer.current = null; }
        setRssi(null);
        deviceRef.current       = null;
        httpRef.current         = null;
        gotPairRequired.current = false;
        setPairRequired(false);
        if (noAutoReconnect.current) {
          setStatus('idle');
          setMsg('Disconnected. Tap Connect to reconnect.');
        } else {
          setMsg('Lost connection. Reconnecting…');
          setTimeout(() => scan(), 2000);
        }
      });

      conn.monitorCharacteristicForService(SERVICE_UUID, PC_TO_IOS_UUID, async (err, char) => {
        if (err || !char?.value) return;
        const msg = base64ToUtf8(char.value);

        if (msg === 'WELCOME') {
          handshakeCompleted.current = true;
          gotPairRequired.current    = false;
          setPairRequired(false);
          try {
            const hc = await conn.readCharacteristicForService(SERVICE_UUID, PC_HTTP_UUID);
            if (hc.value) {
              const p = base64ToUtf8(hc.value).split(':');
              httpRef.current = { ip: p[0], port: p[1], token: p[2] };
            }
          } catch {}
          setupRssiPolling(conn);
          setStatus('connected');
          setMsg(`Connected to ${device.name ?? 'ClipDropper PC'}${httpRef.current ? ' · HTTP ready' : ' · No HTTP (restart PC app)'}`);
          return;
        }

        if (msg === 'PAIR_REQUIRED') {
          gotPairRequired.current = true;
          setPairRequired(true);
          setMsg('Pairing required — click "Pair New Device" on your PC tray, then tap Scan QR here');
          return;
        }

        if (msg.startsWith('T:')) { applyPcMsg(msg).catch(() => {}); return; }

        if (msg === 'I:') {
          if (!httpRef.current) { Alert.alert('PC image', 'HTTP not available. Restart PC app, reconnect, try again.'); return; }
          applyPcMsg(msg).catch(e => Alert.alert('Image failed', String(e)));
          return;
        }

        if (msg.startsWith('F:')) {
          if (!httpRef.current) return;
          const fn             = msg.slice(2);
          const { ip, port, token } = httpRef.current;
          const dest           = (FileSystem.cacheDirectory ?? '') + fn;
          try {
            const dl = await FileSystem.downloadAsync(`http://${ip}:${port}/clip/file?token=${token}`, dest);
            if (dl.status !== 200) { Alert.alert('File from PC', `HTTP ${dl.status}`); return; }
            setLastItem({ kind: 'file', name: fn });
            pushItem({ kind: 'file', label: `↓ ${fn}`, localPath: dest });
            if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dest, { dialogTitle: `Save ${fn}` });
          } catch (e) { Alert.alert('File from PC', String(e)); }
        }
      });

      // Ensure UUID is ready before sending HELLO
      if (!deviceUUIDRef.current) {
        const id = newUUID();
        deviceUUIDRef.current = id;
        FileSystem.writeAsStringAsync(
          (FileSystem.documentDirectory ?? '') + DEVICE_ID_FILE, id).catch(() => {});
      }

      await conn.writeCharacteristicWithResponseForService(
        SERVICE_UUID, IOS_TO_PC_UUID,
        utf8ToBase64(`HELLO:${deviceUUIDRef.current}:${MY_DEVICE_NAME}`));

      // The first HELLO can race the notification subscription on the PC side,
      // losing the WELCOME/PAIR_REQUIRED reply — retry once
      setTimeout(() => {
        if (handshakeCompleted.current || gotPairRequired.current || !deviceRef.current) return;
        conn.writeCharacteristicWithResponseForService(
          SERVICE_UUID, IOS_TO_PC_UUID,
          utf8ToBase64(`HELLO:${deviceUUIDRef.current}:${MY_DEVICE_NAME}`)).catch(() => {});
      }, 2500);

      // 5s fallback: still no reply — read the HTTP characteristic to tell apart
      // old PC builds (valid endpoint, no pairing protocol) from unpaired state (empty)
      setTimeout(async () => {
        if (handshakeCompleted.current || gotPairRequired.current || !deviceRef.current) return;
        let endpoint = '';
        try {
          const hc = await conn.readCharacteristicForService(SERVICE_UUID, PC_HTTP_UUID);
          if (hc.value) endpoint = base64ToUtf8(hc.value);
        } catch {}
        const p = endpoint.split(':');
        if (p.length === 3) {
          httpRef.current = { ip: p[0], port: p[1], token: p[2] };
          setupRssiPolling(conn);
          setStatus('connected');
          setMsg(`Connected to ${device.name ?? 'ClipDropper PC'} · HTTP ready`);
        } else {
          // PC refused the HTTP endpoint — we're not paired; the PAIR_REQUIRED reply was lost
          gotPairRequired.current = true;
          setPairRequired(true);
          setMsg('Pairing required — click "Pair New Device" on your PC tray, then tap Scan QR here');
        }
      }, 5000);

    } catch (e) { handleError(e as BleError); }
  }

  // Handle clipdropper:// deep links generated by the Windows QR code
  useEffect(() => {
    const onUrl = ({ url }: { url: string }) => {
      const p = parseQrUrl(url);
      if (p) handleQrPair(p.host, p.port, p.ptoken);
    };
    const sub = Linking.addEventListener('url', onUrl);
    Linking.getInitialURL().then(url => { if (url) onUrl({ url }); }).catch(() => {});
    return () => sub.remove();
  }, []);

  async function handleQrPair(host: string, port: string, ptoken: string) {
    setPairRequired(false);
    setMsg('Pairing with PC…');
    const ac    = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    try {
      const res = await fetch(`http://${host}:${port}/pair?ptoken=${encodeURIComponent(ptoken)}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ deviceId: deviceUUIDRef.current, deviceName: MY_DEVICE_NAME }),
        signal:  ac.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        // Pair saved on Windows — re-send HELLO so Windows replies WELCOME
        if (deviceRef.current) {
          await deviceRef.current.writeCharacteristicWithResponseForService(
            SERVICE_UUID, IOS_TO_PC_UUID,
            utf8ToBase64(`HELLO:${deviceUUIDRef.current}:${MY_DEVICE_NAME}`));
        } else {
          // Paired before connecting over BLE — start the connection now
          setMsg('Paired! Connecting…');
          scan();
        }
      } else {
        const body = await res.text().catch(() => '');
        Alert.alert('Pairing failed', body || `Server returned ${res.status}`);
        setPairRequired(true);
        setMsg('Pairing failed — try again');
      }
    } catch (e) {
      clearTimeout(timer);
      Alert.alert('Pairing failed', String(e));
      setPairRequired(true);
      setMsg('Pairing failed — try again');
    }
  }

  async function sendClipboard() {
    if (!deviceRef.current) { Alert.alert('Not connected', 'Connect to your PC first.'); return; }
    try {
      if (await Clipboard.hasImage()) {
        if (!httpRef.current) { Alert.alert('Not available', 'HTTP not ready. Restart PC app, reconnect, try again.'); return; }
        const raw = await Clipboard.getImage();
        if (!raw) { Alert.alert('No image', 'Could not read clipboard image.'); return; }
        const b64   = raw.includes(',') ? raw.split(',')[1] : raw;
        const bin   = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (await uploadBytes(bytes, 'clipboard_image.png'))
          pushItem({ kind: 'file', label: '↑ clipboard image' });
        return;
      }
      const text = await Clipboard.getString();
      if (!text) { Alert.alert('Empty clipboard', 'Nothing to send.'); return; }
      await deviceRef.current.writeCharacteristicWithResponseForService(
        SERVICE_UUID, IOS_TO_PC_UUID, utf8ToBase64('T:' + text));
      const preview = text.length > 40 ? text.slice(0, 40) + '…' : text;
      pushItem({ kind: 'text', label: `↑ "${preview}"`, value: text });
    } catch (e) { handleError(e as BleError); }
  }

  async function pickAndSendFile() {
    if (!httpRef.current) { Alert.alert('Not connected', 'Connect to your PC first.'); return; }
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: true });
    if (result.canceled || !result.assets?.length) return;
    let sent = 0;
    for (const file of result.assets) {
      if (file.size && file.size > MAX_FILE_MB * 1024 * 1024) {
        const mb = (file.size / 1024 / 1024).toFixed(0);
        const go = await new Promise<boolean>(r =>
          Alert.alert('Large file', `${file.name} is ${mb} MB. Continue?`,
            [{ text: 'Cancel', onPress: () => r(false) }, { text: 'Send', onPress: () => r(true) }]));
        if (!go) continue;
      }
      try {
        const b64   = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        const bin   = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (await uploadBytes(bytes, file.name)) { pushItem({ kind: 'file', label: `↑ ${file.name}` }); sent++; }
      } catch (e) { Alert.alert('Upload failed', `${file.name}: ${String(e)}`); }
    }
    if (sent > 1) Alert.alert('Done', `${sent} files sent to PC.`);
  }

  async function uploadBytes(bytes: Uint8Array, filename: string): Promise<boolean> {
    const http = httpRef.current;
    if (!http) { Alert.alert('Not connected', 'Connect to your PC first.'); return false; }
    const url = `http://${http.ip}:${http.port}/clip/upload?token=${http.token}&name=${encodeURIComponent(filename)}`;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes.buffer });
      if (res.ok) {
        setLastItem({ kind: 'file', name: filename });
        Alert.alert('Sent!', `${filename} saved to your PC's Downloads folder.`);
        return true;
      }
      Alert.alert('Upload failed', `Server returned ${res.status}`);
    } catch (e) { Alert.alert('Upload failed', String(e)); }
    return false;
  }

  async function pickAndSendPhoto() {
    if (!httpRef.current) { Alert.alert('Not connected', 'Connect to your PC first.'); return; }
    const source = await new Promise<'camera' | 'gallery' | null>(resolve =>
      Alert.alert('Send Photo', 'Choose source', [
        { text: 'Take Photo',        onPress: () => resolve('camera') },
        { text: 'Choose from Gallery', onPress: () => resolve('gallery') },
        { text: 'Cancel',            style: 'cancel', onPress: () => resolve(null) },
      ])
    );
    if (!source) return;

    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission denied', 'Allow camera access in Settings.'); return; }
      result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission denied', 'Allow photo library access in Settings.'); return; }
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    }

    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    try {
      const b64   = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const bin   = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const name = asset.fileName ?? 'photo.jpg';
      if (await uploadBytes(bytes, name)) pushItem({ kind: 'file', label: `↑ ${name}` });
    } catch (e) { Alert.alert('Failed', String(e)); }
  }

  function handleError(e: BleError | Error) {
    const code = (e as BleError).errorCode;
    if (code === BleErrorCode.OperationCancelled || code === BleErrorCode.BluetoothManagerDestroyed) {
      setStatus('idle');
      setMsg('Disconnected. Tap Connect to reconnect.');
      return;
    }
    if (code === BleErrorCode.OperationTimedOut) {
      setStatus('idle');
      setMsg('Connection timed out. Tap Connect to retry.');
      return;
    }
    setStatus('error');
    setMsg((e as BleError).message ?? String(e));
  }

  async function openScanner() {
    qrScannedRef.current = false;
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera permission required', 'Please allow camera access in Settings to scan QR codes.');
        return;
      }
    }
    setShowScanner(true);
  }

  function onQrScanned({ data }: { data: string }) {
    if (qrScannedRef.current) return;
    qrScannedRef.current = true;
    setShowScanner(false);
    const p = parseQrUrl(data);
    if (p) handleQrPair(p.host, p.port, p.ptoken);
    else Alert.alert('Invalid QR', 'Not a ClipDropper pairing code. Show the QR from the PC tray "Pair New Device" menu.');
  }

  const isConn = status === 'connected';
  const busy   = status === 'scanning' || status === 'connecting';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.root, { backgroundColor: colors.bg }]}
      keyboardShouldPersistTaps="handled">

      {/* Onboarding */}
      <Modal visible={showOnboard} animationType="fade" transparent>
        <View style={styles.overlay}>
          <View style={[styles.onboardCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.onboardTitle, { color: colors.text }]}>Welcome to ClipDropper</Text>
            <Text style={[styles.onboardStep,  { color: colors.text }]}>1. Run ClipDropper on your Windows PC</Text>
            <Text style={[styles.onboardStep,  { color: colors.text }]}>2. Make sure both devices are on the same WiFi</Text>
            <Text style={[styles.onboardStep,  { color: colors.text }]}>3. First time? Tap "Pair New Device" in the PC tray icon, then connect here and scan the QR code</Text>
            <Text style={[styles.onboardSub,   { color: colors.sub  }]}>Copy anything on your PC and it appears here automatically. Use the buttons to send from your iPhone to PC.</Text>
            <Pressable style={[styles.btn, { marginTop: 20 }]} onPress={dismissOnboard}>
              <Text style={styles.btnText}>Get Started</Text>
            </Pressable>
          </View>
        </View>
      </Modal>


      {/* QR Scanner */}
      <Modal visible={showScanner} animationType="slide" onRequestClose={() => setShowScanner(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {cameraPermission?.granted ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              onBarcodeScanned={onQrScanned}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            />
          ) : (
            <View style={styles.overlay}>
              <Pressable style={styles.btn} onPress={requestCameraPermission}>
                <Text style={styles.btnText}>Grant Camera Permission</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerHint}>Point at the QR code shown on your PC</Text>
            <Pressable style={[styles.btn, { marginTop: 12, alignSelf: 'center', paddingHorizontal: 32 }]}
              onPress={() => setShowScanner(false)}>
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.text }]}>ClipDropper</Text>
        <Pressable onPress={cycleTheme} style={[styles.themeChip, { backgroundColor: colors.card }]}>
          <Text style={{ color: colors.sub, fontSize: 12, fontWeight: '500' }}>
            {themePref === 'system' ? 'Auto' : themePref === 'dark' ? 'Dark' : 'Light'}
          </Text>
        </Pressable>
      </View>

      {/* Status card */}
      <View style={[styles.statusCard, { backgroundColor: colors.card }]}>
        <View style={[styles.statusDotLg, { backgroundColor: dotColor(status, rssi) }]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusMain, { color: colors.text }]}>
            {isConn ? 'Connected to PC' : busy ? (status === 'scanning' ? 'Scanning…' : 'Connecting…') : 'Not connected'}
          </Text>
          <Text style={[styles.statusSub, { color: colors.sub }]} numberOfLines={1}>{statusMsg}</Text>
        </View>
        {rssi !== null && (
          <Text style={[styles.rssiPill, { color: colors.sub }]}>{rssi} dBm</Text>
        )}
      </View>

      {lastItem?.kind === 'text' && (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardLabel, { color: colors.sub }]}>LAST FROM PC</Text>
          <Text style={[styles.cardText, { color: colors.text }]}>{lastItem.content}</Text>
        </View>
      )}
      {lastItem?.kind === 'image' && (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardLabel, { color: colors.sub }]}>IMAGE FROM PC</Text>
          <Image source={{ uri: lastItem.uri }} style={styles.preview} resizeMode="contain" />
        </View>
      )}
      {lastItem?.kind === 'file' && (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardLabel, { color: colors.sub }]}>FILE</Text>
          <Text style={[styles.cardText, { color: colors.text }]}>{lastItem.name}</Text>
        </View>
      )}

      {/* Primary connect action */}
      <Pressable style={[styles.btn, isConn ? styles.btnRed : styles.btnBlue, busy && styles.btnDisabled, { width: '100%', marginBottom: 12 }]}
        onPress={isConn ? () => { noAutoReconnect.current = true; deviceRef.current?.cancelConnection(); } : scan}
        disabled={busy}>
        {busy
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>{isConn ? 'Disconnect' : 'Connect to PC'}</Text>}
      </Pressable>

      {/* Pair required banner */}
      {pairRequired && (
        <View style={[styles.pairCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.pairTitle, { color: '#af52de' }]}>Pairing Required</Text>
          <Text style={[styles.pairStep, { color: colors.text }]}>On your PC click "Pair New Device" in the tray, then scan the QR:</Text>
          <Pressable style={[styles.btn, styles.btnPurple, { marginTop: 10 }]} onPress={openScanner}>
            <Text style={styles.btnText}>Scan QR Code</Text>
          </Pressable>
        </View>
      )}

      {/* Send to PC section */}
      <Text style={[styles.sectionLabel, { color: colors.sub }]}>SEND TO PC</Text>
      <View style={[styles.menuCard, { backgroundColor: colors.card }]}>
        <Pressable style={[styles.menuRow, !isConn && styles.btnDisabled]} onPress={sendClipboard} disabled={!isConn}>
          <View style={[styles.menuIcon, { backgroundColor: '#007aff' }]}>
            <Text style={styles.menuIconText}>⌘</Text>
          </View>
          <Text style={[styles.menuLabel, { color: colors.text }]}>Clipboard</Text>
          <Text style={[styles.menuChevron, { color: colors.sub }]}>›</Text>
        </Pressable>
        <View style={[styles.menuDivider, { backgroundColor: colors.rowBg }]} />
        <Pressable style={[styles.menuRow, !isConn && styles.btnDisabled]} onPress={pickAndSendFile} disabled={!isConn}>
          <View style={[styles.menuIcon, { backgroundColor: '#ff9500' }]}>
            <Text style={styles.menuIconText}>⊞</Text>
          </View>
          <Text style={[styles.menuLabel, { color: colors.text }]}>File(s)</Text>
          <Text style={[styles.menuChevron, { color: colors.sub }]}>›</Text>
        </Pressable>
        <View style={[styles.menuDivider, { backgroundColor: colors.rowBg }]} />
        <Pressable style={[styles.menuRow, !isConn && styles.btnDisabled]} onPress={pickAndSendPhoto} disabled={!isConn}>
          <View style={[styles.menuIcon, { backgroundColor: '#32ade6' }]}>
            <Text style={styles.menuIconText}>⊙</Text>
          </View>
          <Text style={[styles.menuLabel, { color: colors.text }]}>Photo</Text>
          <Text style={[styles.menuChevron, { color: colors.sub }]}>›</Text>
        </Pressable>
      </View>

      {/* Secondary: Scan QR to Pair */}
      <Pressable style={[styles.btnOutline, { borderColor: isDark ? '#5e3a7a' : '#d4aaed', width: '100%', marginTop: 6 }]} onPress={openScanner}>
        <Text style={[styles.btnOutlineText, { color: '#af52de' }]}>Scan QR to Pair</Text>
      </Pressable>

      {history.length > 0 && (
        <View style={[styles.histCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardLabel, { color: colors.sub }]}>RECENT</Text>
          {history.map(item => (
            <HistRow key={item.id} item={item} colors={colors} />
          ))}
        </View>
      )}

      <Text style={[styles.hint, { color: colors.sub }]}>Copy on PC to auto-receive · Use buttons to send</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Layout
  root:           { flexGrow: 1, alignItems: 'center', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 48 },
  titleRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 16 },
  title:          { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  themeChip:      { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },

  // Status card
  statusCard:     { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 16, width: '100%', marginBottom: 16, gap: 12 },
  statusDotLg:    { width: 12, height: 12, borderRadius: 6, flexShrink: 0 },
  statusMain:     { fontSize: 15, fontWeight: '600' },
  statusSub:      { fontSize: 12, marginTop: 2 },
  rssiPill:       { fontSize: 11, fontWeight: '500' },

  // Content cards
  card:           { borderRadius: 14, padding: 14, width: '100%', marginBottom: 16 },
  cardLabel:      { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  cardText:       { fontSize: 15 },
  preview:        { width: '100%', height: 160, borderRadius: 10, backgroundColor: '#f0f0f0' },

  // Primary button
  btn:            { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnBlue:        { backgroundColor: '#007aff' },
  btnRed:         { backgroundColor: '#ff3b30' },
  btnPurple:      { backgroundColor: '#af52de' },
  btnDisabled:    { opacity: 0.35 },
  btnText:        { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Outline button (secondary)
  btnOutline:     { borderRadius: 14, paddingVertical: 13, alignItems: 'center', borderWidth: 1.5 },
  btnOutlineText: { fontSize: 15, fontWeight: '600' },

  // Section label
  sectionLabel:   { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8, marginTop: 20, alignSelf: 'flex-start' },

  // Menu card (iOS-style grouped rows)
  menuCard:       { borderRadius: 14, width: '100%', overflow: 'hidden' },
  menuRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 16, gap: 14 },
  menuIcon:       { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  menuIconText:   { color: '#fff', fontSize: 15 },
  menuLabel:      { flex: 1, fontSize: 16 },
  menuChevron:    { fontSize: 20, lineHeight: 22 },
  menuDivider:    { height: 1, marginLeft: 60 },

  // History
  histCard:       { borderRadius: 14, padding: 14, width: '100%', marginBottom: 16, gap: 6, marginTop: 20 },
  histRow:        { borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center' },
  histThumb:      { width: 40, height: 40, borderRadius: 6, marginRight: 10 },
  histLabel:      { fontSize: 14, flex: 1 },
  histHint:       { fontSize: 11, marginLeft: 8 },
  hint:           { fontSize: 13, textAlign: 'center', marginTop: 16 },

  // Modals / overlays
  overlay:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  onboardCard:    { borderRadius: 18, padding: 24, width: '100%' },
  onboardTitle:   { fontSize: 22, fontWeight: '700', marginBottom: 20 },
  onboardStep:    { fontSize: 16, marginBottom: 10 },
  onboardSub:     { fontSize: 14, marginTop: 8 },
  pairCard:       { borderRadius: 14, padding: 16, width: '100%', borderLeftWidth: 3, borderLeftColor: '#af52de', marginBottom: 12 },
  pairTitle:      { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  pairStep:       { fontSize: 14, lineHeight: 20 },
  scannerOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 32, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center' },
  scannerHint:    { color: '#fff', fontSize: 15, textAlign: 'center', fontWeight: '500' },
});
