<div align="center">

<img src="ClipDropper-Windows/ClipDropperIcon.png?v=2" width="140" alt="ClipDropper" />

# ClipDropper

**通过蓝牙在 Windows 与 iPhone 之间同步剪贴板。**

无需云端。无需账号。无需数据线。在一台设备上复制，在另一台上粘贴。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Windows-10%2B-0078d4?logo=windows&logoColor=white)](https://github.com/emirhan-sonmez/ClipDropper/releases)
[![.NET](https://img.shields.io/badge/.NET-8.0-512bd4?logo=dotnet&logoColor=white)](https://dotnet.microsoft.com/download/dotnet/8.0)
[![Expo](https://img.shields.io/badge/iOS-Expo-000020?logo=expo&logoColor=white)](ClipDropper-iOS)

[Windows](#windows) · [安装到 iPhone](#ios) · [从源码构建](#从源码构建) · [工作原理](#工作原理)

---

[🇬🇧 English](README.md) · [🇪🇸 Español](README.es.md) · [🇮🇹 Italiano](README.it.md) · [🇨🇳 中文](README.zh.md) · [🇰🇷 한국어](README.ko.md) · [🇷🇺 Русский](README.ru.md) · [🇹🇷 Türkçe](README.tr.md)

</div>

---

## 概述

ClipDropper 是一款双端应用 — Windows 系统托盘代理与 iPhone 配套应用 — 通过本地蓝牙连接保持剪贴板同步。

- 在电脑上复制文本或图片 → 立即可在 iPhone 上粘贴
- 在 iPhone 上复制 → 粘贴到 Windows
- 在 Windows 资源管理器中右键单击任意文件或文件夹即可发送
- 一切都在本地进行 — 无需互联网，无第三方服务器

---

## 截图

<div align="center">

<img src="assets/demo.gif" width="320" alt="ClipDropper 实际效果 — 在电脑上复制，在 iPad 上粘贴" />

| | |
|:---:|:---:|
| <img src="assets/ios-home.png?v=2" width="300" alt="已连接到电脑的 iOS 应用" /> | <img src="assets/ios-share-sheet.png?v=2" width="300" alt="从任何应用通过共享菜单发送到电脑" /> |
| **已连接，随时可用** | **共享菜单 — 从任何应用发送** |
| <img src="assets/windows-tray.png" width="300" alt="Windows 托盘菜单" /> | <img src="assets/qr-pairing.png" width="300" alt="二维码配对" /> |
| **Windows 托盘 — 一键搞定** | **扫码即配对** |

</div>

---

## 功能特性

| | 功能 | 详情 |
|---|---|---|
| **剪贴板** | 文本同步 | 在一台设备上复制，在另一台上粘贴 |
| **剪贴板** | 图片同步 | 截图和图片无缝传输 |
| **文件** | 文件传输 | 右键单击任意文件或文件夹 → 发送到 ClipDropper |
| **Windows** | 系统托盘 | 在后台静默运行 |
| **Windows** | 开机自启 | 可选随 Windows 启动 |
| **Windows** | 右键菜单 | 集成到资源管理器右键菜单 |
| **历史记录** | 传输日志 | 查看所有已发送内容 |
| **隐私** | 纯本地 | 蓝牙 + 局域网 — 无云端 |

---

## 工作原理

ClipDropper 使用**低功耗蓝牙 (BLE)** 进行设备发现和小数据传输，对于文件和图片等较大的传输则切换到**本地 HTTP 服务器**。

```
┌──────────────────────────┐                      ┌──────────────────────────┐
│       Windows PC         │                      │       iPhone (iOS)       │
│                          │                      │                          │
│   ClipDropper.exe        │◄──── BLE GATT ──────►│   ClipDropper 应用       │
│   (系统托盘)              │   (文本、指令)        │   (React Native)         │
│                          │                      │                          │
│   本地 HTTP 服务器        │◄── 局域网 ───────────►│                          │
│   (Token 认证)           │   (文件、图片)        │                          │
└──────────────────────────┘                      └──────────────────────────┘
```

1. Windows 应用广播 BLE GATT 外设
2. iPhone 应用扫描并连接
3. 通过 BLE 交换认证 Token
4. 文本和小数据通过 BLE 特征值传输
5. 文件和图片通过一次性 Token 保护的局域网 HTTP 服务器传输

---

## 安装

### Windows

1. 前往 [Releases](https://github.com/emirhan-sonmez/ClipDropper/releases) 页面下载 `ClipDropper-Setup.exe`
2. 运行安装程序 — 如果缺少 .NET 8 桌面运行时，将自动检测并安装
3. 从开始菜单或桌面快捷方式启动 ClipDropper

**替代方式：无需安装程序直接运行**

唯一的依赖是免费的 [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)（约 200 MB，一次性安装）。

1. 安装 [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
2. 下载或克隆本仓库
3. 双击 `ClipDropper-Windows\run.bat` — 自动构建并启动

### iOS

iOS 应用尚未上架 App Store。你可以使用 **Sideloadly** 免费安装到自己的 iPhone — 无需开发者账号，无需越狱。

> **注意：** 使用免费 Apple ID 侧载的应用将在 **7 天**后过期，需要重新签名。当手机连接时，Sideloadly 可自动完成此操作。

#### 第一步 — 下载文件

- 下载 **Sideloadly**（免费）：[sideloadly.io](https://sideloadly.io)
- 从 [Releases](https://github.com/emirhan-sonmez/ClipDropper/releases) 页面下载 `ClipDropper.ipa`

#### 第二步 — 安装到 iPhone

1. 通过 USB 将 iPhone 连接到电脑
2. 如果 iPhone 提示，点击**信任此电脑**
3. 打开 Sideloadly，将 `ClipDropper.ipa` 拖入窗口
4. 输入你的 Apple ID，点击 **Start**
5. 等待安装完成

#### 第三步 — 信任应用

1. 前往**设置 → 通用 → VPN与设备管理**
2. 在**开发者应用**下，找到你的 Apple ID
3. 点击**信任"[你的 Apple ID]"** → **信任**

#### 第四步 — 开启开发者模式（iOS 16 及更高版本）

1. 前往**设置 → 隐私与安全性 → 开发者模式**
2. 将其打开
3. 提示时点击**重新启动**
4. 重启后点击**打开**以确认

---

## 从源码构建

### 环境要求

| 工具 | 最低版本 |
|------|----------------|
| .NET SDK | 8.0 |
| Windows | 10 (build 19041+, x64) |
| Node.js | 18+ |
| Inno Setup | 6.x _(仅安装程序)_ |

### Windows 应用

```sh
cd ClipDropper-Windows
dotnet run
```

### Windows 安装程序

```sh
ClipDropper-Windows\build-installer.bat
```

### iOS 应用

```sh
cd ClipDropper-iOS
npm install
npx expo start
```

---

## 贡献

欢迎贡献代码。请先开启一个 Issue 讨论你想要进行的更改。

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/your-feature`）
3. 提交更改（`git commit -m 'feat: 添加你的功能'`）
4. Push 并开启 Pull Request

---

## 许可证

MIT © [Emirhan Sonmez](https://github.com/emirhan-sonmez)
