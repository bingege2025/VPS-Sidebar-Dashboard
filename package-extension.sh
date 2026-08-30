#!/bin/bash
# package-extension.sh — 打包 Chrome 扩展，仅包含运行所需文件
#
# 构建期注入（密钥不进仓库）：
#   从环境变量读取 GA 凭据与卸载页，替换源码中的占位符后打包。
#   未设置时保留占位符（埋点静默空转），源码与 git 历史始终不含真实值。
#
# 用法：
#   export GA_MEASUREMENT_ID="G-XXXXXXX"
#   export GA_API_SECRET="AbC_1a2b3c4d5e6f7"
#   export UNINSTALL_URL="landing.example.com"   # 可选
#   export ANALYTICS_DEBUG="true"                # 可选：本地验证埋点（debug 端点，不污染生产）
#   bash package-extension.sh
set -e

cd "$(dirname "$0")"
SRC="$(pwd)"

EXTENSION_NAME="vps-dashboard"
VERSION=$(grep -o '"version"\s*:\s*"[^"]*"' manifest.json | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
OUTPUT="${EXTENSION_NAME}-v${VERSION}.zip"

# 构建到临时目录，替换占位符，避免污染源码
BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT

# 复制运行所需文件到构建目录
cp manifest.json background.js i18n.js shared.js ics-generator.js expiry-reminder.js analytics.js \
   popup.html popup.js options.html options.js "$BUILD_DIR/"
cp -R icons logos _locales "$BUILD_DIR/"

# ── 构建期注入（不污染仓库） ─────────────────────────────
GA_MID="${GA_MEASUREMENT_ID:-}"
GA_SEC="${GA_API_SECRET:-}"
UNINSTALL_URL="${UNINSTALL_URL:-}"

if [ -n "$GA_MID" ] && [ -n "$GA_SEC" ]; then
  GA_MEASUREMENT_ID="$GA_MID" perl -0pi -e 's/__GA_MEASUREMENT_ID__/$ENV{GA_MEASUREMENT_ID}/g' "$BUILD_DIR/analytics.js"
  GA_API_SECRET="$GA_SEC" perl -0pi -e 's/__GA_API_SECRET__/$ENV{GA_API_SECRET}/g' "$BUILD_DIR/analytics.js"
  echo "✓ Injected GA credentials into analytics.js"
else
  echo "⚠️  GA_MEASUREMENT_ID / GA_API_SECRET 未设置 → analytics.js 保留占位符（埋点将空转，不发数据）。"
  echo "   启用埋点：export GA_MEASUREMENT_ID=G-XXX; export GA_API_SECRET=YYY; 再打包。"
fi

if [ -n "$UNINSTALL_URL" ]; then
  UNINSTALL_URL="$UNINSTALL_URL" perl -0pi -e 's/__UNINSTALL_URL__/$ENV{UNINSTALL_URL}/g' "$BUILD_DIR/background.js"
  echo "✓ Injected uninstall URL into background.js"
else
  echo "⚠️  UNINSTALL_URL 未设置 → 卸载页保留占位符（setUninstallURL 会指向无效域名）。"
fi

# 可选：开发调试模式（默认关闭）。设置 ANALYTICS_DEBUG=true 时，事件发往 GA debug
# 端点（仅校验、不写入生产属性）并打印响应，方便本地验证事件是否真实送达，
# 且不会污染生产数据。不设置则保持生产行为。
if [ -n "$ANALYTICS_DEBUG" ]; then
  ANALYTICS_DEBUG="$ANALYTICS_DEBUG" perl -0pi -e 's/__ANALYTICS_DEBUG__/$ENV{ANALYTICS_DEBUG}/g' "$BUILD_DIR/analytics.js"
  echo "✓ Injected ANALYTICS_DEBUG ($ANALYTICS_DEBUG) into analytics.js"
else
  echo "ℹ️  ANALYTICS_DEBUG 未设置 → 生产行为（analytics_debug 默认 false，除非本地 storage 手动开启）。"
fi

rm -f "$OUTPUT"
echo "Packaging ${EXTENSION_NAME} v${VERSION}..."
cd "$BUILD_DIR"
zip -r "$SRC/$OUTPUT" \
  manifest.json background.js i18n.js shared.js ics-generator.js expiry-reminder.js analytics.js \
  popup.html popup.js options.html options.js \
  icons logos _locales \
  -x "icons/icon.svg" \
  -x "*.DS_Store" \
  -x "__MACOSX/*"
cd "$SRC"

echo "✅ Done: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
echo "Upload this ZIP to the Chrome Developer Dashboard."
