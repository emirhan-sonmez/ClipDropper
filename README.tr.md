<div align="center">

<img src="ClipDropper-Windows/ClipDropperIcon.png" width="140" alt="ClipDropper" />

# ClipDropper

**Windows ile iPhone arasında Bluetooth üzerinden pano senkronizasyonu.**

Bulut yok. Hesap yok. Kablo yok. Bir cihazda kopyala, diğerinde yapıştır.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Windows-10%2B-0078d4?logo=windows&logoColor=white)](https://github.com/emirhan-sonmez/ClipDropper/releases)
[![.NET](https://img.shields.io/badge/.NET-8.0-512bd4?logo=dotnet&logoColor=white)](https://dotnet.microsoft.com/download/dotnet/8.0)
[![Expo](https://img.shields.io/badge/iOS-Expo-000020?logo=expo&logoColor=white)](ClipDropper-iOS)

[Windows](#windows) · [iPhone'a Yükle](#ios) · [Kaynak Koddan Derle](#kaynak-koddan-derle) · [Nasıl Çalışır](#nasıl-çalışır)

---

[🇬🇧 English](README.md) · [🇪🇸 Español](README.es.md) · [🇮🇹 Italiano](README.it.md) · [🇨🇳 中文](README.zh.md) · [🇰🇷 한국어](README.ko.md) · [🇷🇺 Русский](README.ru.md) · [🇹🇷 Türkçe](README.tr.md)

</div>

---

## Genel Bakış

ClipDropper, iki parçadan oluşan bir uygulama — bir Windows sistem tepsisi ajanı ve iPhone eş uygulaması — yerel Bluetooth bağlantısı üzerinden panonuzu senkronize eder.

- PC'de metin veya görüntü kopyala → iPhone'unda anında yapıştırmaya hazır
- iPhone'da kopyala → Windows'a yapıştır
- Windows Gezgini'nde herhangi bir dosya veya klasöre sağ tıklayarak gönder
- Her şey yerel kalır — internet bağlantısı yok, üçüncü taraf sunucu yok

---

## Özellikler

| | Özellik | Detaylar |
|---|---|---|
| **Pano** | Metin senkronizasyonu | Bir cihazda kopyala, diğerinde yapıştır |
| **Pano** | Görüntü senkronizasyonu | Ekran görüntüleri ve kopyalanan görseller sorunsuzca aktarılır |
| **Dosyalar** | Dosya transferi | Herhangi bir dosyaya veya klasöre sağ tıkla → ClipDropper'a Gönder |
| **Windows** | Sistem tepsisi | Arka planda sessizce çalışır |
| **Windows** | Otomatik başlatma | İsteğe bağlı olarak Windows ile başlar |
| **Windows** | Bağlam menüsü | Gezgin sağ tıklama menüsü entegrasyonu |
| **Geçmiş** | Transfer günlüğü | Gönderdiğin her şeyi görüntüle |
| **Gizlilik** | Yalnızca yerel | Bluetooth + yerel ağ — bulut yok |

---

## Nasıl Çalışır

ClipDropper, cihaz keşfi ve küçük veriler için **Bluetooth Low Energy (BLE)** kullanır; dosyalar ve görüntüler gibi büyük transferler için **yerel HTTP sunucusuna** geçer.

```
┌──────────────────────────┐                      ┌──────────────────────────┐
│       Windows PC         │                      │       iPhone (iOS)       │
│                          │                      │                          │
│   ClipDropper.exe        │◄──── BLE GATT ──────►│   ClipDropper Uygulaması │
│   (Sistem Tepsisi)       │   (metin, komutlar)  │   (React Native)         │
│                          │                      │                          │
│   Yerel HTTP Sunucusu    │◄── Yerel Ağ ────────►│                          │
│   (token doğrulamalı)    │   (dosyalar, görsel) │                          │
└──────────────────────────┘                      └──────────────────────────┘
```

1. Windows uygulaması BLE GATT çevre birimi olarak yayın yapar
2. iPhone uygulaması tarar ve bağlanır
3. BLE üzerinden bir kimlik doğrulama tokeni değiş tokuş edilir
4. Metin ve küçük veriler BLE karakteristikleri üzerinden aktarılır
5. Dosyalar ve görüntüler, tek kullanımlık tokenla güvence altına alınmış yerel ağ HTTP sunucusunu kullanır

---

## Kurulum

### Windows

1. [Releases](https://github.com/emirhan-sonmez/ClipDropper/releases) sayfasına git ve `ClipDropper-Setup.exe`'yi indir
2. Yükleyiciyi çalıştır — .NET 8 Desktop Runtime eksikse otomatik olarak algılanır ve yüklenir
3. ClipDropper'ı Başlat Menüsünden veya masaüstü kısayolundan başlat

**Alternatif: yükleyici olmadan çalıştır**

Tek bağımlılık, ücretsiz [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)'dır (~200 MB, tek seferlik kurulum).

1. [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)'yı yükle
2. Bu repoyu indir veya klonla
3. `ClipDropper-Windows\run.bat`'a çift tıkla — otomatik olarak derler ve başlatır

### iOS

iOS uygulaması henüz App Store'da yok. **Sideloadly** kullanarak geliştirici hesabı veya jailbreak gerektirmeden iPhone'una ücretsiz yükleyebilirsin.

> **Not:** Ücretsiz Apple ID ile yüklenen uygulamalar **7 gün** sonra sona erer ve yeniden imzalanması gerekir. Telefon bağlıyken Sideloadly bunu otomatik olarak yapabilir.

#### Adım 1 — Dosyaları indir

- **Sideloadly**'ı indir (ücretsiz): [sideloadly.io](https://sideloadly.io)
- [Releases](https://github.com/emirhan-sonmez/ClipDropper/releases) sayfasından `ClipDropper.ipa`'yı indir

#### Adım 2 — iPhone'a yükle

1. iPhone'unu USB ile PC'ye bağla
2. iPhone'unda istenirse **Bu Bilgisayara Güven**'e dokun
3. Sideloadly'yi aç ve `ClipDropper.ipa`'yı pencereye sürükle
4. Apple ID'ni gir ve **Start**'a tıkla
5. Kurulumun tamamlanmasını bekle

#### Adım 3 — iPhone'da uygulamaya güven

1. **Ayarlar → Genel → VPN ve Cihaz Yönetimi**'ne git
2. **Geliştirici Uygulaması** altında Apple ID'ni bul
3. **"[Apple ID'n]"e Güven** → **Güven**'e dokun

#### Adım 4 — Geliştirici Modunu Etkinleştir (iOS 16 ve sonrası)

1. **Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu**'na git
2. Aç
3. İstendiğinde **Yeniden Başlat**'a dokun
4. Yeniden başladıktan sonra onaylamak için **Aç**'a dokun

---

## Kaynak Koddan Derle

### Gereksinimler

| Araç | Minimum Sürüm |
|------|----------------|
| .NET SDK | 8.0 |
| Windows | 10 (build 19041+, x64) |
| Node.js | 18+ |
| Inno Setup | 6.x _(yalnızca yükleyici için)_ |

### Windows Uygulaması

```sh
cd ClipDropper-Windows
dotnet run
```

### Windows Yükleyicisi

```sh
ClipDropper-Windows\build-installer.bat
```

### iOS Uygulaması

```sh
cd ClipDropper-iOS
npm install
npx expo start
```

---

## Katkıda Bulunma

Katkılar memnuniyetle karşılanır. Lütfen önce değiştirmek istediğini tartışmak için bir issue aç.

1. Repoyu fork'la
2. Bir özellik branch'i oluştur (`git checkout -b feature/ozelligin`)
3. Değişikliklerini commit'le (`git commit -m 'feat: özellik ekle'`)
4. Push'la ve Pull Request aç

---

## Lisans

MIT © [Emirhan Sonmez](https://github.com/emirhan-sonmez)
