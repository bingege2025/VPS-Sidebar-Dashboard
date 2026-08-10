# Chrome Web Store Listing — VPS Dashboard

> Last Updated: 2026-08-08

## Store Listing (应用商店信息)

**Extension Name (扩展名称)** [REQUIRED]
`VPS Dashboard — Multi-Provider VPS Manager`
*(必须与 manifest.json 中的 name 保持一致。最多 45 个字符，当前 42 字符。)*

**Short Description (简短说明)** [REQUIRED]
`Manage VPS servers across SolusVM, VirtFusion, and AWS EC2 — status, batch operations, power actions, and expiry reminders.`
*(最多 132 个字符，当前 117 字符。显示在搜索结果和卡片中。)*

**Detailed Description (详细说明)** [REQUIRED]
*(最多 16,000 个字符。注：Chrome Web Store 详情页不支持 Markdown 格式，在开发者后台粘贴时请去除 Markdown 标记，使用换行进行分段。)*

```text
Build tools for VPS users.

VPS Dashboard is a lightweight, local-only Chrome extension for managing VPS servers from multiple providers and control panels — all from your browser.

It is built for VPS users who have servers spread across different panels and want a faster way to check provider-side status, bandwidth, resources, and basic power actions without opening each provider panel.

This is not a generic VPS monitor. It does not replace tools like Beszel, Uptime Kuma, Prometheus, or Netdata. It is a small multi-panel API dashboard for quick provider-side checks and power controls.

Supported Panels

- SolusVM v1 (stable)
- AWS EC2 (stable)
- SolusVM 2 (experimental)
- VirtFusion (experimental)

More panel types are on the roadmap.

Key Features

Multi-server management
Add and manage multiple VPS API profiles in one place. Quickly switch between servers from the popup. Duplicate an existing server profile with one click when adding similar servers.

Multi-panel support
Connect to SolusVM v1 panels, AWS EC2 instances, SolusVM 2 (experimental), and VirtFusion (experimental) — each with its own API driver.

Batch operations
Select any subset of your servers with checkboxes and run batch refresh, batch reboot, or batch shutdown. Results are reported per server.

Provider-side resource view
View status, memory, disk, bandwidth, IP address, hostname, OS/template, and other fields when available from the API.

Smart power actions
Run reboot, boot, and shutdown actions directly from the popup. Reboot and shutdown include an inline confirmation panel to reduce accidental operations. Action buttons automatically adapt to the server's current state — on AWS EC2, transitional states like "stopping" or "pending" are detected and power actions are paused until the instance settles.

Tags and search
Add tags to servers and quickly filter or search your VPS list.

Default server
Mark one server as the default so it loads first when opening the extension.

Dark mode
Switch between light and dark mode. The preference is saved locally.

Privacy mode
Blur sensitive fields such as hostname and IP address when taking screenshots or sharing your screen.

Configuration import and export
Export your local configuration as a JSON backup and import it later. This is useful when moving between browsers, machines, or local development builds.

Important: exported configuration files include API credentials. Keep them private and do not share them publicly.

Expiry reminders
Never miss a renewal. The extension checks your servers every 6 hours in the background and notifies you 30, 7, and 3 days before a server expires. Expired servers remind you daily until renewed. A global master switch and a per-server opt-out are both available.

Automatic expiry dates
For providers that expose a billing or expiry date (such as SolusVM 2 and VirtFusion), the date is pulled automatically. Manual entry always wins, so you can override it at any time. (API dates may be inaccurate — always verify.)

Calendar export (.ics)
Export a single server or all servers to a .ics calendar file with built-in alarms at each threshold. Import it into Google Calendar, Apple Calendar, Outlook, or any standards-compliant calendar.

Multilingual interface
The extension supports:
English
Simplified Chinese
German
French
Russian

Local-only and privacy-first

No backend server
No account required
No telemetry
No analytics
No third-party proxy
No data collection

Your API URL, API Key, API Hash, API Token, and configuration data are stored locally in Chrome storage. API requests are sent directly from your browser to the panel endpoint you configure.

What this extension does not do

It does not support full panel management for Virtualizor, Proxmox, cPanel, Plesk, or generic SSH-based monitoring (Virtualizor and Proxmox are on the roadmap). Note: Proxmox and Virtualizor are not yet supported for full panel management, but their expiry-date reminders work via dates you enter or that the API returns.

It does not install an agent inside your VPS.

It does not continuously monitor uptime in the background.

It does not collect or upload your server data.

Getting started

Open the extension settings page.
Add a server profile.
Choose the panel type: SolusVM v1, AWS EC2, SolusVM 2 (experimental), or VirtFusion (experimental).
Enter your API URL and credentials.
Test the connection.
Open the popup to view status and perform quick actions.

For SolusVM v1, the API endpoint usually looks like:
https://panel.example.com/api/client/command.php

For SolusVM 2 experimental mode, a full virtual server API URL is recommended when available, for example:
https://panel.example.com/api/v1/servers/123

For AWS EC2, enter the region (optionally with an instance ID) in the API URL field, and use an IAM access key pair as credentials. The IAM user needs ec2:DescribeInstances, ec2:StartInstances, ec2:StopInstances, and ec2:RebootInstances permissions. Examples:
us-east-1
us-east-1/i-0123456789abcdef0

Feedback

The extension footer has three quick links:

- **Request a provider** — opens a pre-filled GitHub issue to ask for a new VPS provider or control panel. Only the provider name is required; everything else is optional, so you can submit in seconds.
- **Report a bug** — opens a pre-filled GitHub issue for bug reports. Extension version, language, and browser are auto-filled to save you typing.
- **Contact developer** — opens your mail client to email the developer directly.

Do not include API keys, API hashes, tokens, IP addresses, hostnames, or other sensitive information in public issues.
```

**Category (类别)** [REQUIRED]
`Developer Tools` (开发者工具) 或 `Productivity` (生产力工具)

**Single Purpose (单一用途声明)** [REQUIRED]
`通过 SolusVM、VirtFusion、AWS EC2 等 VPS 控制面板 API 提供便捷的多服务器状态监控与基础电源控制操作。`

**Primary Language (主语言)** [REQUIRED]
`English` (建议设为 English，全球通用)

---

## Graphics & Assets (图片与资产)

| 资产类型 | 尺寸要求 | 状态 | 文件名/说明 |
|-------|-----------|--------|----------|
| Store Icon (商店图标) [REQUIRED] | 128×128 PNG | ✅ 准备就绪 | `icons/icon128.png` |
| Screenshot 1 (屏幕截图 1) [REQUIRED] | 1280×800 或 640×400 | ⬜ 待重新截取 | v1.5.0 新界面：弹出窗口主界面（含批量操作面板） |
| Screenshot 2 (屏幕截图 2) [RECOMMENDED] | 1280×800 或 640×400 | ⬜ 待重新截取 | v1.5.0 新界面：设置页面（多服务器配置 + 复制按钮） |
| Small Promo Tile (小宣传瓷砖) | 440×280 PNG/JPG | ⬜ 可选 | 用于应用商店推荐位 |

*(注：v1.5.0 界面已全面改版，旧截图不再适用，务必重新截取。截图必须是 extension 运行的实际画面，不能有设备边框，比例需严格为 1280×800 或 640×400)*

---

## Permissions Justification (权限声明合理性说明)

*(在 Chrome 开发者后台提交时，每一项权限都需要用英文填写具体合理的用途解释，否则审核会被退回。请直接复制以下英文说明：)*

| 权限名称 (Permission) | 类型 (Type) | 英文合理性说明 (Justification in English) |
|------------|------|---------------|
| `storage` | permissions | Used to store server API configurations (API URL, API Key, API Hash/Token) and user preferences locally on the user's device. |
| `https://*/*` and `http://*/*` | host_permissions | Required to make fetch requests directly to user-configured VPS control panel endpoints (SolusVM, SolusVM 2, VirtFusion), which may reside on custom provider domains over HTTP or HTTPS, to retrieve server statuses and send control commands (reboot/shutdown/boot). |
| `https://*.amazonaws.com/*` | host_permissions | Required to call AWS EC2 APIs (DescribeInstances, StartInstances, StopInstances, RebootInstances) and CloudWatch metrics for user-owned EC2 instances, using the user's own IAM credentials. |

---

## Privacy & Data Use (隐私与数据使用声明)

*(对应 Chrome 开发者后台的「隐私公开声明」表单，请按以下内容选择)*

### 1. Data Collection (数据收集)
**Does the extension collect user data? (该扩展是否收集用户数据？)**
`No` (不收集任何数据)

### 2. Data Use Certification (数据使用承诺)
*(必须勾选以下三项以符合规范)*
- [x] Data is NOT sold to third parties (不会将数据出售给第三方)
- [x] Data is NOT used for purposes unrelated to the extension's core functionality (不会将数据用于与扩展核心功能无关的用途)
- [x] Data is NOT used for creditworthiness or lending purposes (不会将数据用于信用评估或借贷用途)

---

## Privacy Policy (隐私政策链接)

**Privacy Policy URL** [REQUIRED]
您的隐私政策在线地址。
*(建议：将项目根目录下的 `PRIVACY.md` 托管到 GitHub Pages 或使用 GitHub 仓库文件的 Raw 链接。)*
例如：
`https://github.com/bingege2025/VPS-Sidebar-Dashboard/blob/main/PRIVACY.md` (或对应的 GitHub Pages 地址)

---

## Distribution (分发设置)

- **Visibility (可见性)**: `Public` (公开)
- **Regions (地区)**: `All regions` (所有地区)
- **Pricing (价格)**: `Free` (免费)

---

## Developer Info (开发者信息)

- **Publisher Name (发布者名称)**: 您的开发者名称 (例如: `Bingege` 或您的个人姓名)
- **Contact Email (联系邮箱)**: [REQUIRED] (会公开显示在应用商店中)
- **Support URL (支持网页/反馈地址)**: `https://github.com/bingege2025/VPS-Sidebar-Dashboard/issues`

---

## Version History (版本历史)

| 版本号 | 发布日期 | 变更说明 | 状态 |
|---------|------|---------|--------|
| 1.6.0 | 2026-08-04 | 新增到期提醒（后台每 6 小时检查，30/7/3 天前通知，过期每日提醒，全局与单台开关）；API 自动拉取到期日（手工优先）；.ics 日历导出（含闹钟）；到期字段纳入配置导入/导出。 | 待发布 |
| 1.5.0 | 2026-07-25 | 新增 AWS EC2 与 VirtFusion（实验）面板；批量刷新/重启/关机（可选择目标服务器）；复制服务器配置；开机/关机按钮随服务器状态智能切换（含 EC2 过渡状态识别）；操作后静默刷新；界面全面改版。 | 待发布 |
| 1.4.0 | 2026-07-15 | 新增 SolusVM 2 面板支持。 | 已发布 |
| 1.3.0 | 2026-07-01 | 多语言支持（德语、法语、俄语）。 | 已发布 |
| 1.0.0 | 2026-05-30 | 首个正式发布版本。支持多服务器配置、状态展示、开机/关机/重启操作。 | 已发布 |
