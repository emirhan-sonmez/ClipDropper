<div align="center">

<img src="ClipDropper-Windows/ClipDropperIcon.png" width="140" alt="ClipDropper" />

# ClipDropper

**블루투스로 Windows와 iPhone 간 클립보드를 동기화하세요.**

클라우드 없이. 계정 없이. 케이블 없이. 한 기기에서 복사하고 다른 기기에서 붙여넣으세요.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Windows-10%2B-0078d4?logo=windows&logoColor=white)](https://github.com/emirhan-sonmez/ClipDropper/releases)
[![.NET](https://img.shields.io/badge/.NET-8.0-512bd4?logo=dotnet&logoColor=white)](https://dotnet.microsoft.com/download/dotnet/8.0)
[![Expo](https://img.shields.io/badge/iOS-Expo-000020?logo=expo&logoColor=white)](ClipDropper-iOS)

[Windows _(출시 예정)_](#windows) · [iPhone에 설치](#ios) · [소스 코드로 빌드](#소스-코드로-빌드) · [작동 방식](#작동-방식)

---

[🇬🇧 English](README.md) · [🇪🇸 Español](README.es.md) · [🇮🇹 Italiano](README.it.md) · [🇨🇳 中文](README.zh.md) · [🇰🇷 한국어](README.ko.md) · [🇷🇺 Русский](README.ru.md) · [🇹🇷 Türkçe](README.tr.md)

</div>

---

## 개요

ClipDropper는 두 부분으로 구성된 앱입니다 — Windows 시스템 트레이 에이전트와 iPhone 동반 앱 — 로컬 블루투스 연결을 통해 클립보드를 동기화합니다.

- PC에서 텍스트나 이미지를 복사 → iPhone에서 즉시 붙여넣기 가능
- iPhone에서 복사 → Windows에 붙여넣기
- Windows 탐색기에서 파일이나 폴더를 마우스 오른쪽 버튼으로 클릭하여 전송
- 모든 것이 로컬에서 유지 — 인터넷 연결 없음, 서드파티 서버 없음

---

## 기능

| | 기능 | 상세 |
|---|---|---|
| **클립보드** | 텍스트 동기화 | 한 기기에서 복사, 다른 기기에서 붙여넣기 |
| **클립보드** | 이미지 동기화 | 스크린샷과 복사된 이미지가 원활하게 전송 |
| **파일** | 파일 전송 | 파일이나 폴더 마우스 오른쪽 클릭 → ClipDropper로 보내기 |
| **Windows** | 시스템 트레이 | 백그라운드에서 조용히 실행 |
| **Windows** | 자동 시작 | Windows 시작 시 선택적 자동 실행 |
| **Windows** | 컨텍스트 메뉴 | 탐색기 오른쪽 클릭 메뉴 통합 |
| **기록** | 전송 로그 | 전송한 모든 항목 확인 |
| **개인정보** | 로컬 전용 | 블루투스 + 로컬 네트워크 — 클라우드 없음 |

---

## 작동 방식

ClipDropper는 기기 검색과 소규모 데이터에 **블루투스 저에너지(BLE)** 를 사용하고, 파일 및 이미지와 같은 대용량 전송에는 **로컬 HTTP 서버**로 전환합니다.

```
┌──────────────────────────┐                      ┌──────────────────────────┐
│       Windows PC         │                      │       iPhone (iOS)       │
│                          │                      │                          │
│   ClipDropper.exe        │◄──── BLE GATT ──────►│   ClipDropper 앱         │
│   (시스템 트레이)         │   (텍스트, 명령)      │   (React Native)         │
│                          │                      │                          │
│   로컬 HTTP 서버          │◄── 로컬 네트워크 ────►│                          │
│   (토큰 인증)             │   (파일, 이미지)      │                          │
└──────────────────────────┘                      └──────────────────────────┘
```

1. Windows 앱이 BLE GATT 주변 장치를 광고
2. iPhone 앱이 스캔하여 연결
3. BLE를 통해 인증 토큰 교환
4. 텍스트와 소규모 데이터는 BLE 특성을 통해 전송
5. 파일과 이미지는 일회용 토큰으로 보호된 로컬 네트워크 HTTP 서버 사용

---

## 설치

### Windows

> **출시 예정** — Windows 설치 프로그램은 [Releases](https://github.com/emirhan-sonmez/ClipDropper/releases) 페이지에서 제공될 예정입니다. 현재는 [소스 코드로 빌드](#소스-코드로-빌드)할 수 있습니다.

### iOS

iOS 앱은 아직 App Store에 출시되지 않았습니다. **Sideloadly**를 사용하여 개발자 계정이나 탈옥 없이 무료로 iPhone에 설치할 수 있습니다.

> **참고:** 무료 Apple ID로 사이드로드한 앱은 **7일** 후 만료되어 재서명이 필요합니다. Sideloadly는 전화기가 연결되어 있을 때 이를 자동으로 처리할 수 있습니다.

#### 1단계 — 파일 다운로드

- **Sideloadly** 다운로드 (무료): [sideloadly.io](https://sideloadly.io)
- [Releases](https://github.com/emirhan-sonmez/ClipDropper/releases) 페이지에서 `ClipDropper.ipa` 다운로드

#### 2단계 — iPhone에 설치

1. USB로 iPhone을 PC에 연결
2. iPhone에서 메시지가 표시되면 **이 컴퓨터 신뢰**를 탭
3. Sideloadly를 열고 `ClipDropper.ipa`를 창에 드래그
4. Apple ID를 입력하고 **Start** 클릭
5. 설치가 완료될 때까지 대기

#### 3단계 — iPhone에서 앱 신뢰

1. **설정 → 일반 → VPN 및 기기 관리**로 이동
2. **개발자 앱**에서 Apple ID 찾기
3. **"[Apple ID]" 신뢰** → **신뢰**를 탭

#### 4단계 — 개발자 모드 활성화 (iOS 16 이상)

1. **설정 → 개인 정보 보호 및 보안 → 개발자 모드**로 이동
2. 켜기
3. 메시지가 표시되면 **재시동** 탭
4. 재시동 후 **켜기**를 탭하여 확인

---

## 소스 코드로 빌드

### 요구 사항

| 도구 | 최소 버전 |
|------|----------------|
| .NET SDK | 8.0 |
| Windows | 10 (build 19041+, x64) |
| Node.js | 18+ |
| Inno Setup | 6.x _(설치 프로그램 전용)_ |

### Windows 앱

```sh
cd ClipDropper-Windows
dotnet run
```

### Windows 설치 프로그램

```sh
ClipDropper-Windows\build-installer.bat
```

### iOS 앱

```sh
cd ClipDropper-iOS
npm install
npx expo start
```

---

## 기여

기여를 환영합니다. 변경하고 싶은 내용을 먼저 이슈로 열어 논의해 주세요.

1. 저장소 포크
2. 기능 브랜치 생성 (`git checkout -b feature/your-feature`)
3. 변경 사항 커밋 (`git commit -m 'feat: 기능 추가'`)
4. Push 후 Pull Request 열기

---

## 라이선스

MIT © [Emirhan Sonmez](https://github.com/emirhan-sonmez)
