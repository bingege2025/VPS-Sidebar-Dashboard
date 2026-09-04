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
  var MEASUREMENT_ID = 'G-8JXMG1LZ7B'; // e.g. "G-ABCDE12345"
  var API_SECRET = 'TsnKm2coR4ydKFwAecEbXw';        // e.g. "AbC_1a2b3c4d5e6f7"

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

  // Action → dedicated ASCII snake_case GA4 event name.
  // One event name per action; the action is NOT duplicated as a param.
  var ACTION_EVENT_NAME = {
    refresh: 'refresh',
    reboot: 'reboot',
    boot: 'boot',
    shutdown: 'shutdown',
    batchRefresh: 'batch_refresh',
    batchReboot: 'batch_reboot',
    batchShutdown: 'batch_shutdown'
  };

  // Coarse, privacy-safe error classification.
  // Raw provider error text is NEVER sent to GA4: it can embed request URLs,
  // tokens, account ids or response bodies. Only a fixed category label is sent.
  function classifyError(msg) {
    var s = String(msg == null ? '' : msg).toLowerCase();
    if (!s) return 'unknown';
    if (/401|403|unauthor|forbidden|authentication|auth[_ ]?fail|invalid (api )?(key|token|hash|secret|credential)|bad credential|invalid signature/.test(s)) return 'authentication';
    if (/timeout|timed out|etimedout|aborted/.test(s)) return 'timeout';
    if (/invalid url|invalidurl|malformed url|not a valid url/.test(s)) return 'invalid_url';
    if (/failed to fetch|network|enotfound|econnrefused|econnreset|getaddrinfo|dns|offline|ssl|certificate/.test(s)) return 'network';
    if (/status [45]\d\d|\b[45]\d\d\b|api[_ ]?error|http[_ ]?error/.test(s)) return 'api_error';
    return 'unknown';
  }

  // ── GA4 event catalogue (ASCII snake_case) ──────────────────────
  // Exactly one event per real user behaviour — never two events for one action.
  // Params are restricted to non-sensitive, fixed-vocabulary values:
  //   provider   → PROVIDER_EVENT_VALUE (never an account, host or instance id)
  //   error_type → classifyError() category (never raw error text)
  var Analytics = {
    // 1. Reach
    extensionOpened: function () {
      return track('extension_opened');
    },

    // 2. Onboarding
    onboardingShown: function (providerCount) {
      return track('onboarding_shown', { provider_count: Number(providerCount) || 0 });
    },
    onboardingProviderPicked: function (panelType) {
      return track('onboarding_provider_picked', { provider: providerEventValue(panelType) });
    },
    onboardingSkip: function () {
      return track('onboarding_skip');
    },
    onboardingGuideOpened: function (panelType) {
      return track('onboarding_guide_opened', { provider: panelType ? providerEventValue(panelType) : 'all' });
    },
    viewGuide: function (panelType) {
      return track('view_guide', { provider: providerEventValue(panelType) });
    },

    // 3. Configuration
    //    configuration_started is deliberately separate from
    //    onboarding_provider_picked so "picked but never configured" is measurable.
    configurationStarted: function (panelType) {
      return track('configuration_started', { provider: providerEventValue(panelType) });
    },
    connectionTestStarted: function (panelType) {
      return track('connection_test_started', { provider: providerEventValue(panelType) });
    },
    connectionTestSucceeded: function (panelType) {
      return track('connection_test_succeeded', { provider: providerEventValue(panelType) });
    },
    connectionTestFailed: function (panelType, error) {
      return track('connection_test_failed', { provider: providerEventValue(panelType), error_type: classifyError(error) });
    },
    serverSaved: function (panelType, isNew) {
      return track('server_saved', { provider: providerEventValue(panelType), is_new: !!isNew });
    },
    serverSaveFailed: function (panelType, error) {
      return track('server_save_failed', { provider: providerEventValue(panelType), error_type: classifyError(error) });
    },
    // Fires only when a NEW server is persisted (a plain edit is just
    // server_saved), so "finished configuring" isn't conflated with later edits.
    configurationCompleted: function (panelType) {
      return track('configuration_completed', { provider: providerEventValue(panelType) });
    },

    // 4. First real usage
    firstServerViewed: function (panelType) {
      return track('first_server_viewed', { provider: providerEventValue(panelType) });
    },
    serverAction: function (panelType, action) {
      return track(ACTION_EVENT_NAME[action] || 'server_action', { provider: providerEventValue(panelType) });
    },
    batchAction: function (panelType, action) {
      return track(ACTION_EVENT_NAME[action] || 'batch_action', { provider: providerEventValue(panelType) });
    },

    // 5. Import / export
    configImportStarted: function () {
      return track('config_import_started');
    },
    configImportSucceeded: function (serverCount) {
      return track('config_import_succeeded', { server_count: Number(serverCount) || 0 });
    },
    configImportFailed: function (error) {
      return track('config_import_failed', { error_type: classifyError(error) });
    },
    exportConfig: function () {
      return track('export_config');
    },
    exportIcs: function (panelType) {
      return track('export_ics', { provider: panelType ? providerEventValue(panelType) : 'all' });
    },

    // 6. Feedback
    requestProvider: function () {
      return track('request_provider');
    },
    reportBug: function () {
      return track('report_bug');
    },
    contactDev: function () {
      return track('contact_dev');
    },

    // 7. Expiry reminders
    expiryReminderEnabled: function () {
      return track('expiry_reminder_enabled');
    },
    expiryReminderFired: function () {
      return track('expiry_reminder_fired');
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
