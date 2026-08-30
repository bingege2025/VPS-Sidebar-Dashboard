# Chrome Web Store Listing — VPS Dashboard

> Last Updated: 2026-08-29

## Store Listing (应用商店信息)

**Extension Name (扩展名称)** [REQUIRED]
`VPS Dashboard — Multi-Provider VPS Manager`
*(必须与 manifest.json 中的 name 保持一致。最多 45 个字符，当前 42 字符。)*

**Short Description (简短说明)** [REQUIRED]
`Manage VPS servers across multiple providers — status, resources, power actions, and expiry reminders in your browser sidebar.`
*(最多 132 个字符。显示在搜索结果和卡片中。)*

**Detailed Description (详细说明)** [REQUIRED]
*(最多 16,000 个字符。此字段为纯文本：Chrome 网上应用店不渲染 HTML / Markdown，下方已是可直接复制粘贴的纯文本版本，靠换行和「全大写标题 / - 列表项」保持结构。)*

```text
VPS Dashboard

A lightweight, privacy-conscious Chrome extension for managing VPS servers across multiple providers and control panels.

Manage your servers directly from the browser sidebar — check status, resource usage, bandwidth, and perform power actions without opening multiple provider dashboards.

LOCAL-FIRST. NO ACCOUNT. Your API credentials never leave your browser.

WHY VPS DASHBOARD?

- One dashboard for all your VPS
- Fast access from the Chrome sidebar
- Local-first architecture — your server data and credentials stay on your device. Only anonymous, non-identifying usage events are sent to Google Analytics, and you can disable this anytime in Settings.
- Multi-provider support
- Built for VPS users, not enterprise monitoring

VPS Dashboard focuses on provider-side management rather than OS-level monitoring. It complements dedicated monitoring tools — it doesn't replace them.

SUPPORTED PROVIDERS

Connects to multiple VPS providers and control panels. Some integrations are stable, others experimental — the in-extension setup guides cover each one.

KEY FEATURES

Multi-provider support
Connect to multiple VPS providers using dedicated API drivers. Manage them all from a single interface.

Provider-side resource view
View status, memory, disk, bandwidth, IP, hostname, OS, and more — all from your provider's API.

Smart power controls
Start, stop, and reboot servers directly from the popup (where supported by the provider). Confirmation dialogs prevent accidents. Power actions adapt to each provider's server state (transitional states like pending or stopping are detected automatically).

Batch operations
Refresh, reboot, or shut down multiple servers at once. Results are reported individually for each.

Tags & search
Organize servers with custom tags. Filter and search to find them instantly.

Default server
Set a default server that loads automatically when you open the extension.

Privacy mode
Blur IPs, hostnames, and sensitive info in one click — safe for screenshots and screen sharing.

Config import / export
Export your configuration as a JSON backup. Import it when switching browsers or machines.

Expiry reminders
The extension checks your servers every 6 hours and notifies you at 30, 7, and 3 days before expiry. Expired servers remind you daily until renewed. Global master switch and per-server opt-out included.

Automatic expiry dates
For providers that expose billing dates, the date is pulled automatically. Manual entry always overrides.
API dates may be inaccurate — verify them.

Calendar export (.ics)
Export servers to a .ics calendar file with alarms at each threshold. Import into Google Calendar, Apple Calendar, Outlook, or any standards-compliant calendar.

Dark mode
Light and dark themes included.

Multilingual
English · 中文 · Deutsch · Français · Русский

PRIVACY

- Local processing — your server info runs in your browser; only anonymous analytics is sent to Google Analytics
- No account required — zero sign-up
- No collection of API keys, credentials, or sensitive data
- Direct API calls to your provider — server requests go straight to your provider; the only third-party request is optional, anonymous analytics
- Your server config and credentials stay in Chrome local storage

ANONYMOUS ANALYTICS

The extension may send anonymous feature-usage events (e.g., opening the extension, clicking refresh/reboot, viewing a guide) to Google Analytics. These events contain only the feature name and provider type — never API keys, credentials, hostnames, or server content. Like any request to a third-party service, Google receives the network IP used to send each event; we do not put any IP in the event data. You can disable analytics entirely from Settings.

WHAT VPS DASHBOARD DOES NOT DO

This extension is intentionally focused on provider-side management.

It does not:
- Install an agent inside your VPS
- Continuously monitor uptime
- Replace monitoring platforms
- Upload or collect your API credentials or server configuration

GETTING STARTED

When you first open the extension with no servers configured, a Get Started screen asks which provider you want to connect. Pick one and Settings opens with that panel type already selected. You can skip it and add a server manually:

1. Open the extension settings
2. Add a server profile
3. Select the provider type
4. Enter your API endpoint and credentials
5. Test the connection
6. Open the popup to view status and perform actions

For detailed setup instructions per provider, see the in-extension setup guides.

FEEDBACK

Feature requests, bug reports, and provider compatibility reports are welcome. Use the built-in feedback link in the extension to create a pre-filled GitHub issue.

Do not include API keys, secrets, tokens, IP addresses, hostnames, or any other sensitive information in public reports.
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
| `https://*/*` and `http://*/*` | host_permissions | Required to make fetch requests directly to user-configured VPS control panel endpoints (SolusVM, SolusVM 2, VirtFusion, Virtualizor), which may reside on custom provider domains over HTTP or HTTPS, to retrieve server statuses and send control commands (reboot/shutdown/boot). |
| `https://*.amazonaws.com/*` | host_permissions | Required to call AWS EC2 APIs (DescribeInstances, StartInstances, StopInstances, RebootInstances) and CloudWatch metrics for user-owned EC2 instances, using the user's own IAM credentials. |
| `https://www.google-analytics.com/*` and `https://region1.google-analytics.com/*` | host_permissions | Required to send anonymous feature-usage events to Google Analytics 4 Measurement Protocol. Events include feature name and provider type only; they never include server credentials, API endpoints, IP addresses, hostnames, instance IDs, or server aliases. |

---

## Privacy & Data Use (隐私与数据使用声明)

*(对应 Chrome 开发者后台的「隐私公开声明」表单，请按以下内容选择)*

### 1. Data Collection (数据收集)
**Does the extension collect user data? (该扩展是否收集用户数据？)**
`Yes`

Recommended category:
- `User activity`: anonymous feature-usage events, such as opening the extension, testing a connection, saving a server profile, clicking refresh/reboot/shutdown, exporting/importing configuration, viewing a setup guide, or using feedback links.

Do not declare (these are not collected):
- Personally identifiable information
- Authentication information
- Financial and payment information
- Health information
- Personal communications
- Web history
- User content

Note: Google Analytics receives the network IP used to send each event and may infer approximate location from it. To stay accurate, declare "Location" as approximate under the data-collection form.

Important disclosure:
The extension does not collect API URLs, API keys, API hashes, tokens, cloud secret keys, hostnames, IP addresses, instance IDs, server aliases, exported configuration files, or VPS content.

### 2. Data Use Certification (数据使用承诺)
*(必须勾选以下三项以符合规范)*
- [x] Data is NOT sold to third parties (不会将数据出售给第三方)
- [x] Data is NOT used for purposes unrelated to the extension's core functionality (不会将数据用于与扩展核心功能无关的用途)
- [x] Data is NOT used for creditworthiness or lending purposes (不会将数据用于信用评估或借贷用途)

---

## Privacy Policy (隐私政策链接)

**Privacy Policy URL** [REQUIRED]
您的隐私政策在线地址（已通过 GitHub Pages 托管，公开可访问）：
`https://bingege2025.github.io/VPS-Sidebar-Dashboard/privacy.html`

*(源文件：`PRIVACY.md`；托管分支：`gh-pages`（仅含隐私文件，不混入侵主分支）。如需修改，改完 `privacy.html` 后重新推 `gh-pages` 即可。)*

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
