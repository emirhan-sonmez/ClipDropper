import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { BleManager, Device, BleError } from 'react-native-ble-plx';
import Clipboard from '@react-native-clipboard/clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';

const SERVICE_UUID   = '4fafc201-1fb5-459e-8fcc-c5c9c3319abc';
const PC_TO_IOS_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const IOS_TO_PC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const PC_HTTP_UUID   = 'f3641f28-cb91-4353-9a5b-2f3459b33f8a';
const MAX_FILE_MB    = 50;

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

// G3: dot reflects RSSI signal quality
function dotColor(s: Status, rssi: number | null): string {
  if (s !== 'connected') return '#8e8e93';
  if (rssi === null || rssi >= -70) return '#34c759';
  if (rssi >= -80) return '#ffd60a';
  return '#ff9500';
}

// D4: dark/light palette
function makeColors(dark: boolean) {
  return {
    bg:      dark ? '#1c1c1e' : '#f2f2f7',
    card:    dark ? '#2c2c2e' : '#ffffff',
    text:    dark ? '#ffffff' : '#1c1c1e',
    sub:     dark ? '#8e8e93' : '#3c3c43',
    rowBg:   dark ? '#3a3a3c' : '#f0f0f5',
  };
}

type Status = 'idle' | 'scanning' | 'connecting' | 'connected' | 'disconnected' | 'error';
type LastItem =
  | { kind: 'text';  content: string }
  | { kind: 'image'; uri: string }
  | { kind: 'file';  name: string }
  | null;
type ThemePref = 'system' | 'dark' | 'light';
type HistItem = { id: number; label: string; value?: string };

const manager = new BleManager({
  restoreStateIdentifier: 'ClipDropperBLERestoreIdentifier',
  restoreStateFunction: () => {},
});
let _hid = 0;

export default function App() {
  const systemScheme = useColorScheme();

  const [status,        setStatus]       = useState<Status>('idle');
  const [statusMsg,     setMsg]          = useState('Tap Connect to find your PC');
  const [lastItem,      setLastItem]     = useState<LastItem>(null);
  const [autoSend,      setAutoSend]     = useState(false);
  const [rssi,          setRssi]         = useState<number | null>(null);
  const [history,       setHistory]      = useState<HistItem[]>([]);
  const [showOnboard,   setShowOnboard]  = useState(false);
  const [themePref,     setThemePref]    = useState<ThemePref>('system');

  const deviceRef    = useRef<Device | null>(null);
  const httpRef      = useRef<{ ip: string; port: string; token: string } | null>(null);
  const intentional  = useRef(false);
  const autoSendRef  = useRef(false);
  const lastClipRef  = useRef('');
  const rssiTimer    = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPcMsg    = useRef('');

  const isDark = themePref === 'system' ? systemScheme === 'dark' : themePref === 'dark';
  const colors = makeColors(isDark);

  useEffect(() => { autoSendRef.current = autoSend; }, [autoSend]);

  // A2: auto-scan when BLE powers on
  useEffect(() => {
    const sub = manager.onStateChange((state) => {
      if (state === 'PoweredOn') { sub.remove(); scan(); }
    }, true);
    return () => { sub.remove(); manager.destroy(); };
  }, []);

  // G4: show onboarding once
  useEffect(() => {
    const flag = (FileSystem.documentDirectory ?? '') + '.onboarded';
    FileSystem.getInfoAsync(flag).then(i => { if (!i.exists) setShowOnboard(true); }).catch(() => {});
  }, []);

  // load persisted theme preference
  useEffect(() => {
    FileSystem.readAsStringAsync((FileSystem.documentDirectory ?? '') + '.theme')
      .then(v => { if (v === 'dark' || v === 'light' || v === 'system') setThemePref(v as ThemePref); })
      .catch(() => {});
  }, []);

  // Auto-receive + D2 auto-send: both run when app foregrounds
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      if (next !== 'active' || !deviceRef.current) return;

      // Auto-receive: read latest PC state in case BLE notify fired while backgrounded
      // (iOS may suspend the app before async HTTP work completes)
      try {
        const char = await deviceRef.current.readCharacteristicForService(SERVICE_UUID, PC_TO_IOS_UUID);
        if (char.value) {
          const msg = base64ToUtf8(char.value);
          if (msg && msg !== lastPcMsg.current) {
            // ignore F: on foreground pull — share sheet would appear unexpectedly
            if (msg.startsWith('T:') || msg === 'I:') {
              applyPcMsg(msg).catch(() => {});
            }
          }
        }
      } catch { /* ignore — device may not be ready yet */ }

      // D2: auto-send text clipboard
      if (!autoSendRef.current) return;
      try {
        if (await Clipboard.hasImage()) return;
        const clip = await Clipboard.getString();
        if (!clip || clip === lastClipRef.current) return;
        lastClipRef.current = clip;
        await deviceRef.current.writeCharacteristicWithResponseForService(
          SERVICE_UUID, IOS_TO_PC_UUID, utf8ToBase64('T:' + clip));
        push(`↑ "${clip.length > 40 ? clip.slice(0, 40) + '…' : clip}"`, clip);
      } catch { /* silent */ }
    });
    return () => sub.remove();
  }, []);

  function push(label: string, value?: string) {
    setHistory(prev => [{ id: ++_hid, label, value }, ...prev].slice(0, 5));
  }

  // Shared handler for T: and I: messages — used by both BLE monitor and foreground pull
  async function applyPcMsg(msg: string): Promise<void> {
    if (msg.startsWith('T:')) {
      const text = msg.slice(2);
      Clipboard.setString(text);
      const prev = text.length > 40 ? text.slice(0, 40) + '…' : text;
      setLastItem({ kind: 'text', content: prev });
      push(`↓ "${prev}"`, text);
      lastPcMsg.current = msg;
      return;
    }
    if (msg === 'I:') {
      if (!httpRef.current) throw new Error('HTTP not available. Restart PC app and reconnect.');
      const { ip, port, token } = httpRef.current;
      const res = await fetch(`http://${ip}:${port}/clip/image?token=${token}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${ip}:${port} — check same WiFi & Firewall.`);
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      // convert to base64 in chunks to avoid call-stack overflow on large images
      const CHUNK = 0x8000;
      let binary = '';
      for (let i = 0; i < bytes.length; i += CHUNK)
        binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
      const b64 = btoa(binary);
      Clipboard.setImage(b64);
      // write to file for the preview card; if that fails, show a text fallback
      const dest = (FileSystem.cacheDirectory ?? '') + 'clipboard_img.png';
      FileSystem.writeAsStringAsync(dest, b64, { encoding: FileSystem.EncodingType.Base64 })
        .then(() => setLastItem({ kind: 'image', uri: dest + '?t=' + Date.now() }))
        .catch(() => setLastItem({ kind: 'text', content: '[Image copied to clipboard]' }));
      push('↓ clipboard image');
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

  async function connect(device: Device) {
    try {
      setStatus('connecting');
      setMsg(`Connecting to ${device.name ?? 'ClipDropper PC'}…`);
      const conn = await device.connect();
      await conn.discoverAllServicesAndCharacteristics();
      deviceRef.current = conn;

      try {
        const hc = await conn.readCharacteristicForService(SERVICE_UUID, PC_HTTP_UUID);
        if (hc.value) {
          const p = base64ToUtf8(hc.value).split(':');
          httpRef.current = { ip: p[0], port: p[1], token: p[2] };
        }
      } catch { /* older PC build */ }

      // G3: RSSI polling every 5 s
      conn.readRSSI().then(d => setRssi(d.rssi ?? null)).catch(() => {});
      rssiTimer.current = setInterval(async () => {
        try { setRssi((await conn.readRSSI()).rssi ?? null); }
        catch { if (rssiTimer.current) { clearInterval(rssiTimer.current); rssiTimer.current = null; } }
      }, 5000);

      // A3: auto-reconnect on unexpected disconnect
      conn.onDisconnected(() => {
        if (rssiTimer.current) { clearInterval(rssiTimer.current); rssiTimer.current = null; }
        setRssi(null);
        deviceRef.current = null;
        httpRef.current   = null;
        if (intentional.current) {
          intentional.current = false;
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

        if (msg.startsWith('T:')) {
          applyPcMsg(msg).catch(() => {});
          return;
        }

        if (msg === 'I:') {
          if (!httpRef.current) { Alert.alert('PC image', 'HTTP not available. Restart PC app, reconnect, try again.'); return; }
          applyPcMsg(msg).catch(e => Alert.alert('Image failed', String(e)));
          return;
        }

        if (msg.startsWith('F:')) {
          if (!httpRef.current) return;
          const fn = msg.slice(2);
          const { ip, port, token } = httpRef.current;
          const dest = (FileSystem.cacheDirectory ?? '') + fn;
          try {
            const dl = await FileSystem.downloadAsync(`http://${ip}:${port}/clip/file?token=${token}`, dest);
            if (dl.status !== 200) { Alert.alert('File from PC', `HTTP ${dl.status}`); return; }
            setLastItem({ kind: 'file', name: fn });
            push(`↓ ${fn}`);
            if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dest, { dialogTitle: `Save ${fn}` });
          } catch (e) { Alert.alert('File from PC', String(e)); }
        }
      });

      setStatus('connected');
      setMsg(`Connected to ${device.name ?? 'ClipDropper PC'}${httpRef.current ? ' · HTTP ready' : ' · No HTTP (restart PC app)'}`);
    } catch (e) { handleError(e as BleError); }
  }

  async function sendClipboard() {
    if (!deviceRef.current) { Alert.alert('Not connected', 'Connect to your PC first.'); return; }
    try {
      if (await Clipboard.hasImage()) {
        if (!httpRef.current) { Alert.alert('Not available', 'HTTP not ready. Restart PC app, reconnect, try again.'); return; }
        const raw = await Clipboard.getImage();
        if (!raw) { Alert.alert('No image', 'Could not read clipboard image.'); return; }
        const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (await uploadBytes(bytes, 'clipboard_image.png')) push('↑ clipboard image');
        return;
      }
      const text = await Clipboard.getString();
      if (!text) { Alert.alert('Empty clipboard', 'Nothing to send.'); return; }
      await deviceRef.current.writeCharacteristicWithResponseForService(
        SERVICE_UUID, IOS_TO_PC_UUID, utf8ToBase64('T:' + text));
      push(`↑ "${text.length > 40 ? text.slice(0, 40) + '…' : text}"`, text);
    } catch (e) { handleError(e as BleError); }
  }

  // D3: batch file pick; E3: size guard per file
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
        const b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (await uploadBytes(bytes, file.name)) { push(`↑ ${file.name}`); sent++; }
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
      if (res.ok) { setLastItem({ kind: 'file', name: filename }); Alert.alert('Sent!', `${filename} saved to your PC's Downloads folder.`); return true; }
      Alert.alert('Upload failed', `Server returned ${res.status}`);
    } catch (e) { Alert.alert('Upload failed', String(e)); }
    return false;
  }

  // E2: quality 0.8 compresses photos before transfer
  async function pickAndSendPhoto() {
    if (!httpRef.current) { Alert.alert('Not connected', 'Connect to your PC first.'); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission denied', 'Allow photo library access in Settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    try {
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const name = asset.fileName ?? 'photo.jpg';
      if (await uploadBytes(bytes, name)) push(`↑ ${name}`);
    } catch (e) { Alert.alert('Failed', String(e)); }
  }

  function handleError(e: BleError | Error) {
    setStatus('error');
    setMsg((e as BleError).message ?? String(e));
  }

  const isConn = status === 'connected';
  const busy   = status === 'scanning' || status === 'connecting';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.root, { backgroundColor: colors.bg }]}
      keyboardShouldPersistTaps="handled">

      {/* G4: first-launch onboarding */}
      <Modal visible={showOnboard} animationType="fade" transparent>
        <View style={styles.overlay}>
          <View style={[styles.onboardCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.onboardTitle, { color: colors.text }]}>Welcome to ClipDropper</Text>
            <Text style={[styles.onboardStep, { color: colors.text }]}>1. Run ClipDropper on your Windows PC</Text>
            <Text style={[styles.onboardStep, { color: colors.text }]}>2. Make sure both devices are on the same WiFi</Text>
            <Text style={[styles.onboardStep, { color: colors.text }]}>3. Tap Connect — the app does the rest</Text>
            <Text style={[styles.onboardSub, { color: colors.sub }]}>Copy anything on your PC and it appears here automatically. Use the buttons to send from your iPhone to PC.</Text>
            <Pressable style={[styles.btn, { marginTop: 20 }]} onPress={dismissOnboard}>
              <Text style={styles.btnText}>Get Started</Text>
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

      {/* G3: dot color = signal quality */}
      <View style={[styles.dot, { backgroundColor: dotColor(status, rssi) }]} />
      <Text style={[styles.statusMsg, { color: colors.sub }]}>{statusMsg}</Text>

      {lastItem?.kind === 'text' && (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardLabel, { color: colors.sub }]}>Last text from PC</Text>
          <Text style={[styles.cardText, { color: colors.text }]}>{lastItem.content}</Text>
        </View>
      )}
      {lastItem?.kind === 'image' && (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardLabel, { color: colors.sub }]}>Image received from PC</Text>
          <Image source={{ uri: lastItem.uri }} style={styles.preview} resizeMode="contain" />
        </View>
      )}
      {lastItem?.kind === 'file' && (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardLabel, { color: colors.sub }]}>File</Text>
          <Text style={[styles.cardText, { color: colors.text }]}>{lastItem.name}</Text>
        </View>
      )}

      <View style={styles.buttons}>
        <Pressable style={[styles.btn, busy && styles.btnDisabled]}
          onPress={isConn ? () => { intentional.current = true; deviceRef.current?.cancelConnection(); } : scan}
          disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{isConn ? 'Disconnect' : 'Connect to PC'}</Text>}
        </Pressable>
        <Pressable style={[styles.btn, styles.btnGreen, !isConn && styles.btnDisabled]} onPress={sendClipboard} disabled={!isConn}>
          <Text style={styles.btnText}>Send Clipboard → PC</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnOrange, !isConn && styles.btnDisabled]} onPress={pickAndSendFile} disabled={!isConn}>
          <Text style={styles.btnText}>Pick File(s) → PC</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnTeal, !isConn && styles.btnDisabled]} onPress={pickAndSendPhoto} disabled={!isConn}>
          <Text style={styles.btnText}>Pick Photo → PC</Text>
        </Pressable>
      </View>

      {/* D2: auto-send toggle — visible when connected */}
      {isConn && (
        <View style={[styles.toggleRow, { backgroundColor: colors.card }]}>
          <Text style={[styles.toggleLabel, { color: colors.text }]}>Auto-send clipboard on focus</Text>
          <Switch value={autoSend} onValueChange={setAutoSend} trackColor={{ false: '#767577', true: '#34c759' }} />
        </View>
      )}

      {/* G2: transfer history, last 5 */}
      {history.length > 0 && (
        <View style={[styles.histCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardLabel, { color: colors.sub }]}>Recent</Text>
          {history.map(item => (
            <Pressable key={item.id} style={[styles.histRow, { backgroundColor: colors.rowBg }]}
              onPress={item.value ? () => Clipboard.setString(item.value!) : undefined}>
              <Text style={[styles.histLabel, { color: colors.text }]} numberOfLines={1}>{item.label}</Text>
              {item.value && <Text style={[styles.histHint, { color: colors.sub }]}>tap to copy</Text>}
            </Pressable>
          ))}
        </View>
      )}

      <Text style={[styles.hint, { color: colors.sub }]}>Copy on PC to auto-receive · Buttons send from iPhone</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:         { flexGrow: 1, alignItems: 'center', paddingTop: 72, paddingHorizontal: 24, paddingBottom: 40 },
  titleRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 16 },
  title:        { fontSize: 28, fontWeight: '700' },
  themeChip:    { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  dot:          { width: 20, height: 20, borderRadius: 10, marginBottom: 12 },
  statusMsg:    { fontSize: 15, textAlign: 'center', marginBottom: 24 },
  card:         { borderRadius: 12, padding: 14, width: '100%', marginBottom: 20 },
  cardLabel:    { fontSize: 12, marginBottom: 6 },
  cardText:     { fontSize: 15 },
  preview:      { width: '100%', height: 160, borderRadius: 8, backgroundColor: '#f0f0f0' },
  buttons:      { width: '100%', gap: 12, marginBottom: 16 },
  btn:          { backgroundColor: '#007aff', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnGreen:     { backgroundColor: '#34c759' },
  btnOrange:    { backgroundColor: '#ff9500' },
  btnTeal:      { backgroundColor: '#32ade6' },
  btnDisabled:  { opacity: 0.4 },
  btnText:      { color: '#fff', fontSize: 16, fontWeight: '600' },
  toggleRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', borderRadius: 12, padding: 14, marginBottom: 16 },
  toggleLabel:  { fontSize: 15, flex: 1, marginRight: 12 },
  histCard:     { borderRadius: 12, padding: 14, width: '100%', marginBottom: 16, gap: 6 },
  histRow:      { borderRadius: 8, padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  histLabel:    { fontSize: 14, flex: 1 },
  histHint:     { fontSize: 11, marginLeft: 8 },
  hint:         { fontSize: 13, textAlign: 'center', marginTop: 8 },
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  onboardCard:  { borderRadius: 16, padding: 24, width: '100%' },
  onboardTitle: { fontSize: 22, fontWeight: '700', marginBottom: 20 },
  onboardStep:  { fontSize: 16, marginBottom: 10 },
  onboardSub:   { fontSize: 14, marginTop: 8 },
});
