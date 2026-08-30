/**
 * analytics.js — Anonymous, privacy-safe usage analytics for VPS Dashboard.
 *
 * Design goals (see PRIVACY_ANALYTICS.md):
 *   • Pure client-side, no backend. Talks to GA4 Measurement Protocol directly.
 *   • Sends ONLY anonymous feature-usage events.
 *   • NEVER includes credentials, API keys, IP addresses, hostnames,
 *     instance names, or any account/identifying data.
 *   • Stable anonymous client_id via crypto.randomUUID() in chrome.storage.local.
 *   • Fire-and-forget: analytics failures never affect extension behaviour.
 *
 * Exposed as a global `Analytics` object:
 *   - popup.js / options.js : <script src="analytics.js"></script>
 *   - background.js (SW)    : importScripts('analytics.js')
 */
(function (global) {
  'use strict';

  // ── GA4 Measurement Protocol configuration ─────────────────────
  // MEASUREMENT_ID (G-XXXXXXX) is NOT secret and may be public.
  // API_SECRET IS embedded in the shipped extension, so anyone who unpacks
  // the .crx can read it. That is an inherent limit of client-side MP.
  // Mitigations:
  //   1. Use a dedicated GA4 property that only collects these events.
  //   2. A leaked MP secret can ONLY send events to your property, never read data.
  //   3. Inject via build step (replace the tokens below) so values live in one place.
  var MEASUREMENT_ID = '__GA_MEASUREMENT_ID__'; // e.g. "G-ABCDE12345"
  var API_SECRET = '__GA_API_SECRET__';        // e.g. "AbC_1a2b3c4d5e6f7"

  var GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
  // Debug endpoint returns a JSON validation report and does NOT write to the
  // production GA4 property. Used only when ANALYTICS_DEBUG is enabled, so local
  // verification never pollutes production analytics.
  var GA_DEBUG_ENDPOINT = 'https://www.google-analytics.com/debug/mp/collect';

  var CLIENT_ID_KEY = 'analytics_client_id';
  var OPT_OUT_KEY = 'analytics_opt_out';

  // Developer self-exclusion: when true on THIS browser, no events are sent.
  // Use it to keep your own manual testing out of the analytics property.
  // Real users are unaffected — they never set this flag.
  var SELF_EXCLUDE_KEY = 'analytics_self_exclude';

  // Build-time override: replace with 'true' in a DEV build so you never
  // accidentally ship self-exclusion to real users. Left as a placeholder;
  // the build step replaces `__ANALYTICS_SELF_EXCLUDE__`.
  var BUILD_SELF_EXCLUDE = '__ANALYTICS_SELF_EXCLUDE__'; // 'true' or anything else

  // Developer debug flag. When on, events go to the GA *debug* endpoint (which
  // validates but does NOT persist to the property) and the full response is
  // logged to the console — so you can confirm "打开插件" actually reached GA
  // without creating production data. Enabled by chrome.storage.local
  // 'analytics_debug' (set it from the dev console) or the build-time
  // __ANALYTICS_DEBUG__ token. Off by default → production behaviour unchanged.
  var DEBUG_KEY = 'analytics_debug';
  var BUILD_DEBUG = '__ANALYTICS_DEBUG__'; // 'true' or anything else

  // Internal panel type → anonymized event value.
  // Only the provider *kind* is reported; never an account or instance id.
  var PROVIDER_EVENT_VALUE = {
    solusvm: 'solusvm_v1',
    solusvm2: 'solusvm_v2',
    ec2: 'aws_ec2',
    virtfusion: 'virtfusion',
    virtualizor: 'virtualizor',
    proxmox: 'proxmox',
    hetzner: 'hetzner',
    digitalocean: 'digitalocean',
    lightsail: 'lightsail'
  };

  function hasStorage() {
    return (typeof chrome !== 'undefined') && chrome.storage && chrome.storage.local;
  }

  function newClientId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'anon-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2);
  }

  function getClientId() {
    return new Promise(function (resolve) {
      if (!hasStorage()) { resolve(newClientId()); return; }
      chrome.storage.local.get(CLIENT_ID_KEY, function (data) {
        if (data && data[CLIENT_ID_KEY]) { resolve(data[CLIENT_ID_KEY]); return; }
        var cid = newClientId();
        chrome.storage.local.set({ [CLIENT_ID_KEY]: cid }, function () { resolve(cid); });
      });
    });
  }

  // Read all on/off flags in a single storage call.
  function readFlags() {
    return new Promise(function (resolve) {
      if (!hasStorage()) { resolve({ optOut: false, selfExclude: false }); return; }
      chrome.storage.local.get([OPT_OUT_KEY, SELF_EXCLUDE_KEY, DEBUG_KEY], function (data) {
        data = data || {};
        resolve({
          optOut: !!data[OPT_OUT_KEY],
          selfExclude: !!data[SELF_EXCLUDE_KEY] || (BUILD_SELF_EXCLUDE === 'true'),
          debug: !!data[DEBUG_KEY] || (BUILD_DEBUG === 'true')
        });
      });
    });
  }

  function isOptOut() {
    return readFlags().then(function (f) { return f.optOut; });
  }

  function isSelfExclude() {
    return readFlags().then(function (f) { return f.selfExclude; });
  }

  // Core send. Returns a promise that never rejects to the caller.
  function track(eventName, params) {
    if (!eventName || !MEASUREMENT_ID || MEASUREMENT_ID.indexOf('__GA_') === 0) {
      // Not configured yet — skip silently instead of hitting a bogus URL.
      return Promise.resolve();
    }
    return readFlags().then(function (flags) {
      if (flags.optOut) return;
      if (flags.selfExclude) {
        // Developer self-exclusion: skip silently but leave a trace for the dev console.
        console.debug('[analytics] self-excluded on this browser; event skipped:', eventName);
        return;
      }
      return getClientId().then(function (clientId) {
        var eventParams = Object.assign({ engagement_time_msec: '100' }, params || {});
        var payload = {
          client_id: clientId,
          events: [{ name: eventName, params: eventParams }]
        };
        var endpoint = flags.debug ? GA_DEBUG_ENDPOINT : GA_ENDPOINT;
        var url = endpoint + '?measurement_id=' + encodeURIComponent(MEASUREMENT_ID) +
                  '&api_secret=' + encodeURIComponent(API_SECRET);
        if (flags.debug) console.debug('[analytics][debug] sending event:', eventName, eventParams);
        return fetch(url, {
          method: 'POST',
          cache: 'no-cache',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function (res) {
          if (flags.debug) {
            // Debug endpoint returns a JSON validation report; production returns
            // 204 with no body. Logging it lets devs confirm the event is valid.
            res.json().then(function (body) {
              console.debug('[analytics][debug] GA validation response for', eventName, ':', body);
            }).catch(function () { /* 204 / empty body — ignore */ });
          }
        }).catch(function (err) {
          console.warn('[analytics] Send failed:', err);
        });
      });
    });
  }

  function providerEventValue(panelType) {
    return PROVIDER_EVENT_VALUE[panelType] || 'unknown';
  }

  // Action → specific Chinese event name per button
  var ACTION_EVENT_NAME = {
    refresh: '刷新',
    reboot: '重启',
    boot: '开机',
    shutdown: '关机',
    batchRefresh: '批量刷新',
    batchReboot: '批量重启',
    batchShutdown: '批量关机'
  };

  var Analytics = {
    extensionOpened: function () { return track('打开插件'); },
    providerConnected: function (panelType) {
      return track('连接服务商', { provider: providerEventValue(panelType) });
    },
    expiryReminderEnabled: function () { return track('到期提醒已开启'); },
    expiryReminderFired: function () { return track('到期提醒已触发'); },
    testConnection: function (panelType) {
      return track('测试连接', { provider: providerEventValue(panelType) });
    },
    serverAction: function (panelType, action) {
      var eventName = ACTION_EVENT_NAME[action] || '服务器操作';
      return track(eventName, { provider: providerEventValue(panelType), action: action });
    },
    batchAction: function (panelType, action) {
      var eventName = ACTION_EVENT_NAME[action] || '批量操作';
      return track(eventName, { provider: providerEventValue(panelType), action: action });
    },
    exportIcs: function (panelType) {
      return track('导出日历', { provider: panelType ? providerEventValue(panelType) : 'all' });
    },
    exportConfig: function () { return track('导出配置'); },
    importConfig: function () { return track('导入配置'); },
    requestProvider: function () { return track('请求服务商'); },
    reportBug: function () { return track('报告问题'); },
    contactDev: function () { return track('联系开发者'); },
    saveServer: function (panelType) {
      return track('保存服务器', { provider: providerEventValue(panelType) });
    },
    viewGuide: function (panelType) {
      return track('查看教程', { provider: providerEventValue(panelType) });
    },
    // ── 首次引导漏斗 ──
    onboardingShown: function () { return track('引导页展示'); },
    onboardingProviderPicked: function (panelType) {
      return track('引导页选择服务商', { provider: providerEventValue(panelType) });
    },
    onboardingSkip: function () { return track('引导页跳过'); },
    onboardingGuideOpened: function (panelType) {
      return track('引导页打开教程', { provider: panelType ? providerEventValue(panelType) : 'all' });
    },
    // exposed for the uninstall-URL use case (no fetch available there)
    getClientId: getClientId,
    isOptOut: isOptOut,
    isSelfExclude: isSelfExclude,
    // Toggle developer self-exclusion on THIS browser. Call from the dev
    // console: Analytics.selfExclude(true) to stop your own events, (false) to resume.
    selfExclude: function (on) {
      if (!hasStorage()) return Promise.resolve(false);
      return new Promise(function (resolve) {
        chrome.storage.local.set({ [SELF_EXCLUDE_KEY]: !!on }, function () { resolve(!!on); });
      });
    },
    track: track
  };

  global.Analytics = Analytics;
  if (typeof module !== 'undefined' && module.exports) module.exports = Analytics;

})(typeof self !== 'undefined' ? self : this);
