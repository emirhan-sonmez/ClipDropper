<div align="center">

<img src="ClipDropper-Windows/ClipDropperIcon.png" width="140" alt="ClipDropper" />

# ClipDropper

**Sincronizzazione degli appunti tra Windows e iPhone — via Bluetooth.**

Nessun cloud. Nessun account. Nessun cavo. Copia su un dispositivo e incolla sull'altro.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Windows-10%2B-0078d4?logo=windows&logoColor=white)](https://github.com/emirhan-sonmez/ClipDropper/releases)
[![.NET](https://img.shields.io/badge/.NET-8.0-512bd4?logo=dotnet&logoColor=white)](https://dotnet.microsoft.com/download/dotnet/8.0)
[![Expo](https://img.shields.io/badge/iOS-Expo-000020?logo=expo&logoColor=white)](ClipDropper-iOS)

[Windows _(prossimamente)_](#windows) · [Installa su iPhone](#ios) · [Compila dal sorgente](#compila-dal-sorgente) · [Come funziona](#come-funziona)

---

[🇬🇧 English](README.md) · [🇪🇸 Español](README.es.md) · [🇮🇹 Italiano](README.it.md) · [🇨🇳 中文](README.zh.md) · [🇰🇷 한국어](README.ko.md) · [🇷🇺 Русский](README.ru.md) · [🇹🇷 Türkçe](README.tr.md)

</div>

---

## Panoramica

ClipDropper è un'applicazione in due parti — un agente nella barra delle applicazioni di Windows e un'app compagna per iPhone — che mantiene sincronizzati gli appunti tramite una connessione Bluetooth locale.

- Copia testo o un'immagine sul PC → disponibile immediatamente per incollare sull'iPhone
- Copia sull'iPhone → incolla su Windows
- Invia qualsiasi file o cartella da Esplora file con un clic destro
- Tutto rimane locale — nessuna connessione internet, nessun server di terze parti

---

## Funzionalità

| | Funzionalità | Dettagli |
|---|---|---|
| **Appunti** | Sincronizzazione testo | Copia su un dispositivo, incolla sull'altro |
| **Appunti** | Sincronizzazione immagini | Screenshot e immagini si trasferiscono senza problemi |
| **File** | Trasferimento file | Clic destro su qualsiasi file o cartella → Invia a ClipDropper |
| **Windows** | Barra delle applicazioni | Funziona silenziosamente in background |
| **Windows** | Avvio automatico | Avvio opzionale con Windows |
| **Windows** | Menu contestuale | Integrazione con Esplora file |
| **Cronologia** | Registro trasferimenti | Visualizza tutto ciò che hai inviato |
| **Privacy** | Solo locale | Bluetooth + rete locale — nessun cloud |

---

## Come Funziona

ClipDropper utilizza il **Bluetooth Low Energy (BLE)** per il rilevamento e i payload piccoli, passando a un **server HTTP locale** per i trasferimenti più grandi come file e immagini.

```
┌──────────────────────────┐                      ┌──────────────────────────┐
│       PC Windows         │                      │       iPhone (iOS)       │
│                          │                      │                          │
│   ClipDropper.exe        │◄──── BLE GATT ──────►│   App ClipDropper        │
│   (Barra applicazioni)   │   (testo, comandi)   │   (React Native)         │
│                          │                      │                          │
│   Server HTTP Locale     │◄── Rete Locale ─────►│                          │
│   (token autenticato)    │   (file, immagini)   │                          │
└──────────────────────────┘                      └──────────────────────────┘
```

1. L'app Windows pubblica un periférico BLE GATT
2. L'app iPhone esegue la scansione e si connette
3. Un token di autenticazione viene scambiato via BLE
4. Testo e payload piccoli si trasferiscono tramite BLE
5. File e immagini usano un server HTTP locale protetto da un token monouso

---

## Installazione

### Windows

> **Prossimamente** — il programma di installazione sarà disponibile nella pagina [Releases](https://github.com/emirhan-sonmez/ClipDropper/releases). Nel frattempo puoi [compilare dal sorgente](#compila-dal-sorgente).

### iOS

L'app iOS non è ancora sull'App Store. Puoi installarla gratuitamente sul tuo iPhone usando **Sideloadly** — senza account sviluppatore né jailbreak.

> **Nota:** Le app caricate con un Apple ID gratuito scadono dopo **7 giorni** e devono essere ri-firmate. Sideloadly può farlo automaticamente quando il telefono è connesso.

#### Passo 1 — Scarica i file

- Scarica **Sideloadly** (gratis): [sideloadly.io](https://sideloadly.io)
- Scarica `ClipDropper.ipa` dalla pagina [Releases](https://github.com/emirhan-sonmez/ClipDropper/releases)

#### Passo 2 — Installa sull'iPhone

1. Collega l'iPhone al PC tramite USB
2. Se richiesto, tocca **Autorizza questo computer**
3. Apri Sideloadly e trascina `ClipDropper.ipa` nella finestra
4. Inserisci il tuo Apple ID e clicca **Start**
5. Attendi il completamento dell'installazione

#### Passo 3 — Considera attendibile l'app

1. Vai su **Impostazioni → Generali → Gestione VPN e dispositivi**
2. Sotto **App sviluppatore**, trova il tuo Apple ID
3. Tocca **Considera attendibile "[il tuo Apple ID]"** → **Considera attendibile**

#### Passo 4 — Attiva la Modalità Sviluppatore (iOS 16 e successivi)

1. Vai su **Impostazioni → Privacy e sicurezza → Modalità Sviluppatore**
2. Attivala
3. Tocca **Riavvia** quando richiesto
4. Dopo il riavvio, tocca **Attiva** per confermare

---

## Compila dal Sorgente

### Requisiti

| Strumento | Versione minima |
|------|----------------|
| .NET SDK | 8.0 |
| Windows | 10 (build 19041+, x64) |
| Node.js | 18+ |
| Inno Setup | 6.x _(solo installer)_ |

### App Windows

```sh
cd ClipDropper-Windows
dotnet run
```

### Installer Windows

```sh
ClipDropper-Windows\build-installer.bat
```

### App iOS

```sh
cd ClipDropper-iOS
npm install
npx expo start
```

---

## Contribuire

I contributi sono benvenuti. Apri prima una issue per discutere cosa vorresti cambiare.

1. Fai un fork del repository
2. Crea un branch (`git checkout -b feature/tua-feature`)
3. Fai commit (`git commit -m 'feat: aggiungi la tua feature'`)
4. Fai push e apri una Pull Request

---

## Licenza

MIT © [Emirhan Sonmez](https://github.com/emirhan-sonmez)
