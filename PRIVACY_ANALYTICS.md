# VPS Dashboard — Anonymous Analytics (GA4 Measurement Protocol)

轻量级、纯客户端的功能使用埋点实现说明。**不收集任何可识别信息**，与扩展
「无后端、本地优先」的隐私承诺保持一致。

---

## 1. Privacy statement（可直接用于隐私政策 / 商店描述）

**English**
> VPS Dashboard collects only anonymous, aggregated feature-usage events to
> understand how the extension is used (for example, when the extension is opened,
> which provider type you connect, and whether expiry reminders are enabled).
> We use Google Analytics 4 via the Measurement Protocol. We do **not** collect your
> API keys, credentials, tokens, IP addresses, server hostnames, instance names, or
> any account-identifying information. As with any request to a third-party service,
> Google Analytics receives the network IP address that sends each event; we do not
> place any IP address in the event data itself. A random, non-identifying client ID
> (`crypto.randomUUID()`) is stored locally in `chrome.storage.local` purely to
> de-duplicate events; it is not linked to you or your servers.

**中文**
> VPS Dashboard 仅收集匿名的、聚合的功能使用事件，以了解扩展的使用情况（例如扩展被打开、
> 连接了哪种服务商类型、是否启用了到期提醒）。我们通过 Measurement Protocol 使用 Google
> Analytics 4。我们**不**收集你的 API 密钥、凭据、令牌、IP 地址、服务器主机名、实例名称或任何
> 可识别账户的信息。与任何发往第三方服务的请求一样，Google Analytics 会收到用于传输该事件
> 的网络 IP 地址；我们不会在事件数据本身中写入任何 IP 地址。一个随机且不可识别的
> client ID（`crypto.randomUUID()`）仅保存在本地
> `chrome.storage.local` 中，用于去重，不与你或你的服务器关联。

---

## 2. What we collect / never collect

| 收集（匿名） | 绝不收集 |
|---|---|
| `extension_opened` | API keys / API hash / tokens |
| `test_connection` / `provider_connected`（仅含匿名 provider 类型：solusvm_v1 / solusvm_v2 / aws_ec2 / virtfusion / …） | IP 地址、精确到用户的地理位置* |
| `expiry_reminder_enabled`、`expiry_reminder_fired` | 服务器主机名 / IP / 实例名 |
| `test_connection`、`save_server`、`server_action`(refresh/reboot/boot/shutdown)、`batch_action`(batch_refresh/batch_reboot/batch_shutdown)、`export_ics`、`export_config`、`import_config`、`request_provider`、`report_bug`、`contact_dev`、`view_guide`（均带匿名 `provider` 类型，动作类另带 `action`）；`onboarding_shown` / `onboarding_provider_picked` / `onboarding_skip` / `onboarding_guide_opened` | 任何账号或服务器识别信息 |
| 匿名 `client_id`（本地 UUID，仅去重） | 实际配置内容、服务器列表 |

\* 见第 6 节关于 IP 的重要说明。

---

## 3. How the client_id works

- 使用 `crypto.randomUUID()` 生成，存入 `chrome.storage.local`（`analytics_client_id`）。
- 同一浏览器内稳定；卸载扩展即消失（不跨设备、不与用户身份关联）。
- 提供 `analytics_opt_out` 开关（见第 10 节），尊重用户退出。

---

## 4. Where the API Secret & Measurement ID live (security)

GA4 Measurement Protocol 需要两个值：

- **MEASUREMENT_ID** (`G-XXXXXXX`)：**不是秘密**，本就可以公开，放在前端无风险。
- **API_SECRET**：**必然被打包进扩展**。Chrome 扩展没有真正的「保密存储」——
  任何人解包 `.crx` 都能读到 `analytics.js` 里的常量。这是客户端直接调用 MP 的
  **固有局限**，必须坦然接受，而不是假装能隐藏。

降低风险的实务做法：

1. **专用 GA4 媒体资源**：单独开一个 Property 只收这些匿名事件，与任何业务数据隔离。
2. **泄露后果有限**：MP 的 secret 只能向「你的」媒体资源灌事件，**无法读取**你的数据、
   无法访问其他 Property。最坏情况是有人刷你的统计，不影响用户。
3. **构建时注入（推荐）**：不要把明文 secret 长期留在源码里。用构建步骤替换占位符：

   ```js
   // analytics.js 顶部
   var MEASUREMENT_ID = '__GA_MEASUREMENT_ID__';
   var API_SECRET = '__GA_API_SECRET__';
   ```

   构建脚本示例（打包前 sed 替换，或用 esbuild/env 注入）：
   ```bash
   # package-extension.sh 已实现：复制到临时构建目录 → 替换占位符 → 打包 → 清理
   # 真实值仅存在于构建机/CI 的环境变量，仓库与 git 历史只保留占位符。
   export GA_MEASUREMENT_ID="G-XXXXXXX"
   export GA_API_SECRET="AbC_1a2b3c4d5e6f7"
   export UNINSTALL_URL="landing.example.com"   # 可选，卸载反馈页域名
   bash package-extension.sh
   ```
   `package-extension.sh` 会在临时目录复制源码、用环境变量替换 `__GA_MEASUREMENT_ID__` /
   `__GA_API_SECRET__` / `__UNINSTALL_URL__`，再打包，**仓库里始终只保留占位符**。
4. 配置文件 `analytics-config.js` 也可以，但本质一样可见，故推荐上面的注入方式。

> 当前 `analytics.js` 用的是占位符。未替换时 `track()` 会**静默跳过**，不会发请求，
> 避免误打到无效 URL。

---

## 5. Manifest V3 configuration

### host_permissions（已修改 manifest.json）
```json
"host_permissions": [
  "https://*.amazonaws.com/*",
  "https://www.google-analytics.com/*",
  "https://region1.google-analytics.com/*",
  "https://*/*",
  "http://*/*"
]
```
- 必须包含 `https://www.google-analytics.com/*`（默认端点）和
  `https://region1.google-analytics.com/*`（区域端点，GA4 MP 推荐）。
- 注意原 `https://*/*` 本来就覆盖 google-analytics.com，显式列出只是为了清晰与可审计。
- **建议收窄** `http://*/*`：若你的面板没有必须走 http 的老地址，可删掉它，权限更窄、
  Chrome 审核更顺。GA4 只用 https，不受影响。

### CSP（通常**无需改**）
MV3 扩展默认 CSP 为 `script-src 'self'; object-src 'self'`，**不限制 `fetch`/`connect`**。
扩展页面的 fetch 受 `host_permissions` 约束，不受页面 CSP 的 `connect-src` 限制。
因此**本项目不需要改 CSP**。

> 仅当你曾在 manifest 里自定义 `content_security_policy` 并且加了 `connect-src` 限制时，
> 才需要放行 `https://www.google-analytics.com`。本项目未自定义，故忽略。

---

## 6. ⚠️ Important: IP address disclosure

**直发 GA4 Measurement Protocol 时，Google 会接收到用户的 IP 地址**，并用于粗略的地理位置
推断。这是「无后端、浏览器直发」方案的客观代价，会部分违背「不收集任何 IP」的表述。

应对：
- **在隐私政策中如实披露**（第 1 节的声明已包含「Google 会接收用于统计的匿名请求」之意，
  如想更直白可补一句："Google may receive your IP address to process these events."）。
- 在 GA4 媒体资源设置里开启 **IP 匿名化（IP anonymization / redaction）** 可降低精度，
  但无法完全消除 Google 接收 IP 这一事实。
- 若 IP 零暴露是硬性要求，唯一彻底的方案是加一个自己的无日志中转（但这会引入后端，
  违背「无后端」卖点）——本项目选择直发并在隐私政策披露，这是隐私与无后端的权衡。

---

## 7. Events reference

> 所有事件名均为 GA4 Measurement Protocol 合规的 ASCII 蛇形命名（`^[A-Za-z][A-Za-z0-9_]*$`，≤40 字符），
> 以确保可靠上报。每个事件**仅**携带匿名 `provider` 类型（见 `providerEventValue`），绝不含账号、服务器 id、主机名或名称。

| 事件名（ASCII，GA4 合规） | 触发点 | 参数 |
|---|---|---|
| `extension_opened` | popup.js `init()`（委托 background SW 发送，避免 popup 关闭丢事件） | 无 |
| `onboarding_shown` | popup.js 无服务器且未跳过时 | 无 |
| `onboarding_provider_picked` | 引导页点击某 Provider 卡片 | `provider`（匿名类型） |
| `onboarding_skip` | 引导页点击 Skip | 无 |
| `onboarding_guide_opened` | 引导页点击 Setup Guide | `provider`（`solusvm_v1` 等或 `all`） |
| `provider_connected` | options.js 保存/连接成功 | `provider`（匿名类型） |
| `save_server` | options.js `saveServer()` 点击 | `provider`（匿名类型） |
| `test_connection` | options.js `testConnection()` 点击 | `provider`（匿名类型） |
| `server_action`（`refresh`/`reboot`/`boot`/`shutdown`） | popup.js `doAction()` | `provider`、`action` |
| `batch_action`（`batch_refresh`/`batch_reboot`/`batch_shutdown`） | popup.js `doBulkAction()`（按每台服务器各发一条） | `provider`、`action` |
| `export_ics` | options.js `exportAllICS()` | `provider`（`all` 或单台类型） |
| `export_config` / `import_config` | options.js 导出/导入 | 无 |
| `view_guide` | options.js `updatePanelHelp()` 点击指南链接 | `provider`（匿名类型） |
| `expiry_reminder_enabled` | options.js `remindersEnabled` 勾选 | 无 |
| `expiry_reminder_fired` | background.js `checkExpiryReminders()` 实际发通知 | 无 |
| `request_provider` / `report_bug` / `contact_dev` | popup.js footer 反馈链接 | 无 |
| 卸载页（`setUninstallURL`，非 GA 事件） | background.js `setupUninstallUrl()` | 仅匿名 `cid`，落在自建落地页 URL 上 |

---

## 8. Uninstall URL

- 在 `background.js` 的 `onInstalled` 中调用 `chrome.runtime.setUninstallURL`，
  仅附带匿名 `client_id`（`cid`），**不含任何 PII**。
- URL 必须是 `https`，指向你自建的落地页（当前占位 `https://your-landing.example.com/uninstall?...`）。
- 把 `your-landing.example.com` 换成你真实的反馈/落地页；该页可读取 `?cid=` 做匿名流失统计。
- `setUninstallURL` 的 URL 长度有限（保持简短，UUID 36 字符无压力）。

---

## 9. How to configure (fill the secrets)

1. 在 GA4 后台创建媒体资源，拿到 `MEASUREMENT_ID` 和 `Data Streams → Measurement Protocol → API secret`。
2. 二选一：
   - 直接把 `analytics.js` 顶部的 `__GA_MEASUREMENT_ID__` / `__GA_API_SECRET__` 换成真实值；或
   - 用第 4 节的构建注入（推荐，仓库只留占位符）。
3. 替换 `background.js` / `setupUninstallUrl` 里的卸载落地页 URL。

---

## 10. Opt-out（已实现）

设置页「偏好设置」中已提供 **匿名使用统计** 开关：默认开启，关闭后 `analytics.js` 的
`track()` 直接跳过，不再向 Google Analytics 发送任何事件。开关写入 `chrome.storage.local`
的 `analytics_opt_out`：

```js
// options.js 开关 change 时：
chrome.storage.local.set({ analytics_opt_out: !e.target.checked });
```

这能让「本地优先 / 可选分析」的承诺更完整，也符合部分地区的合规预期。

---

## 11. Validation

- 想校验 payload 格式：把 `analytics.js` 里的 `GA_ENDPOINT` 临时指向
  `https://www.google-analytics.com/debug/mp/collect`，GA 会返回校验结果 JSON。
- 正式环境用 GA4 后台的 **DebugView**（需对事件带 `_dbg=1` 或开启 debug 设备）查看实时事件。

---

## 12. 开发者自我排除（self-exclusion，不污染真实数据）

`analytics_opt_out` 是给**终端用户**关全部埋点的；而开发者想在自家浏览器测试时
**不把点击/事件发进统计**，需要另一套机制 —— `analytics_self_exclude`。

- 只对你**自己**的浏览器生效，真实用户永远不会设置这个标记，因此不受影响。
- 开启后 `track()` 直接跳过（不 fetch），并在 devtools console 留一条
  `[analytics] self-excluded on this browser; event skipped: <name>` 便于确认。

**开启 / 关闭（任选其一）**

```js
// 方法 A：扩展后台页 console 里直接调
Analytics.selfExclude(true);   // 关闭自己的事件
Analytics.selfExclude(false);  // 恢复正常上报
```

```js
// 方法 B：直接写 storage（任意页面 console）
chrome.storage.local.set({ analytics_self_exclude: true });
chrome.storage.local.set({ analytics_self_exclude: false });
```

**构建期硬编码（dev 构建专用）**

`analytics.js` 顶部有占位符 `__ANALYTICS_SELF_EXCLUDE__`，构建脚本可把它替换成
`'true'`，这样 dev 构建默认不发数据；发布构建保持占位符（运行时恒为 false）。
切记：**不要把这个 `true` 打包进发往 Chrome Web Store 的正式 zip**。
