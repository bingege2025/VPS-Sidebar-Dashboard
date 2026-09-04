// Popup page logic — fully synchronous init, no async/await

const $ = id => document.getElementById(id);
let privacyModeEnabled = false;
let darkModeEnabled = false;
let allServers = [];
let expiryWarnDays = DEFAULT_EXPIRY_WARN_DAYS;

// Global exception handlers
window.onerror = function(message, source, lineno, colno, error) {
  console.error(`Error: ${message} at ${lineno}:${colno}`);
  const main = document.getElementById('main');
  if (main) main.innerHTML = `<div class="error">❌ ${message}</div>`;
};
window.onunhandledrejection = function(event) {
  console.error('Promise Error:', event.reason);
  const main = document.getElementById('main');
  if (main) main.innerHTML = `<div class="error">❌ ${event.reason}</div>`;
};

// ---- Utility functions ----

function formatSize(bytes) {
  const val = parseFloat(bytes);
  if (isNaN(val)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = val, idx = 0;
  while (size >= 1024 && idx < units.length - 1) { size /= 1024; idx++; }
  return `${size.toFixed(size % 1 === 0 ? 0 : 2)} ${units[idx]}`;
}

function formatResource(val) {
  if (!val || typeof val !== 'string') return 'N/A';
  const parts = val.split(',');
  if (parts.length < 4) return val;
  const [a, b, c, d] = parts;
  const va = parseFloat(a);
  const vb = parseFloat(b);
  const vc = parseFloat(c);
  const totalVal = Math.max(va, vb, vc);
  const usedVal = Math.min(va, vb, vc);
  const percent = d;
  if (isNaN(totalVal) || totalVal === 0) return 'N/A';
  if (usedVal === 0) {
    return formatSize(totalVal);
  }
  return `${formatSize(usedVal)} / ${formatSize(totalVal)} (${percent}%)`;
}

// Send message to background service worker (Promise-based, with safety net)
function sendMessage(action, extraData) {
  extraData = extraData || {};
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ action, ...extraData }, response => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message;
          if (errMsg.includes('context invalidated')) {
            console.warn('Extension context invalidated, reloading...');
            location.reload();
            return;
          }
          resolve({ success: false, error: errMsg });
        } else if (!response) {
          resolve({ success: false, error: window.t('noResponse') });
        } else {
          resolve(response);
        }
      });
    } catch (e) {
      if (e.message.includes('context invalidated')) {
        console.warn('Extension context invalidated, reloading...');
        location.reload();
        return;
      }
      resolve({ success: false, error: e.message });
    }
  });
}

// Safe storage.local.get with timeout fallback
function safeStorageGet(keys, callback, timeoutMs) {
  timeoutMs = timeoutMs || 2000;
  let fired = false;
  const timer = setTimeout(() => {
    if (!fired) {
      fired = true;
      console.warn('chrome.storage.local.get timed out for keys:', keys);
      callback(null);
    }
  }, timeoutMs);

  try {
    chrome.storage.local.get(keys, data => {
      clearTimeout(timer);
      if (!fired) {
        fired = true;
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message;
          if (errMsg.includes('context invalidated')) {
            console.warn('Extension context invalidated in storage.get, reloading...');
            location.reload();
            return;
          }
          console.error('storage.get error:', chrome.runtime.lastError);
          callback(null);
        } else {
          callback(data || {});
        }
      }
    });
  } catch (e) {
    clearTimeout(timer);
    if (!fired) {
      fired = true;
      if (e.message.includes('context invalidated')) {
        console.warn('Extension context invalidated in storage.get, reloading...');
        location.reload();
        return;
      }
      console.error('storage.get exception:', e);
      callback(null);
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
}

// normalizeTagList, normalizeServers, getAllTagsFromServers, PROVIDER_META, getProviderMeta → shared.js

// Deterministic hue (0-359) from tag name — same tag always gets the same chip color
function getTagHue(tag) {
  let hash = 0;
  const str = String(tag);
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

// Update the header selector trigger: provider logo + name (line 1), server alias (line 2)
function updateTriggerDisplay(server) {
  const triggerLogo = $('triggerLogo');
  const providerEl = $('selectedProviderName');
  const aliasEl = $('selectedServerName');
  const meta = server ? getProviderMeta(server.panel_type) : null;
  if (triggerLogo) triggerLogo.src = meta ? meta.logo : PROVIDER_META_DEFAULT.logo;
  if (providerEl) providerEl.textContent = meta ? meta.name : '';
  if (aliasEl) aliasEl.textContent = server ? server.name : window.t('noServers');
}

function updatePrivacyToggle() {
  const btn = $('privacyToggle');
  if (!btn) return;
  btn.classList.toggle('active', privacyModeEnabled);
  btn.setAttribute('aria-pressed', String(privacyModeEnabled));
  btn.title = privacyModeEnabled ? window.t('privacyOn') : window.t('privacyOff');
  btn.setAttribute('aria-label', window.t('togglePrivacy'));
}

function applyPrivacyMode() {
  document.querySelectorAll('.privacy-field').forEach(el => {
    el.classList.toggle('blur-text', privacyModeEnabled);
  });
  updatePrivacyToggle();
}

function setPrivacyMode(enabled, persist) {
  privacyModeEnabled = Boolean(enabled);
  applyPrivacyMode();
  if (persist) {
    chrome.storage.local.set({ privacyModeEnabled });
  }
}

function updateThemeToggle() {
  const btn = $('themeToggle');
  if (!btn) return;
  btn.innerHTML = lucideIcon(darkModeEnabled ? 'sun' : 'moon', 14);
  btn.title = darkModeEnabled ? window.t('lightMode') : window.t('darkMode');
  btn.setAttribute('aria-label', btn.title);
}

function applyTheme() {
  document.body.classList.toggle('dark', darkModeEnabled);
  updateThemeToggle();
}

function setDarkMode(enabled, persist) {
  darkModeEnabled = Boolean(enabled);
  applyTheme();
  if (persist) {
    chrome.storage.local.set({ darkModeEnabled });
  }
}

// ---- UI binding ----

const settingsBtn = $('settingsBtn');
if (settingsBtn) {
  settingsBtn.addEventListener('click', e => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

const themeToggle = $('themeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', e => {
    e.preventDefault();
    setDarkMode(!darkModeEnabled, true);
  });
}

// ── Low-friction feedback: auto diagnostics + one-tap error report ──
// Tracks the most recent API error so the user can report it with one click.
let lastApiError = null;
function recordApiError(message, panelType) {
  lastApiError = {
    message: String(message || '').slice(0, 500),
    panelType: panelType || null,
    ts: new Date().toISOString()
  };
}

// Anonymous diagnostics (NO credentials/keys/hostnames) to pre-fill feedback,
// so users don't type environment details and devs don't need follow-ups.
function collectDiagnostics() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(['servers', 'lang', 'analytics_opt_out'], data => {
        const servers = (data && data.servers) || [];
        const breakdown = {};
        servers.forEach(s => {
          const pt = s.panel_type || 'unknown';
          breakdown[pt] = (breakdown[pt] || 0) + 1;
        });
        const bdStr = Object.keys(breakdown).length
          ? Object.keys(breakdown).map(k => k + ':' + breakdown[k]).join(', ')
          : 'none';
        resolve({
          version: chrome.runtime.getManifest().version,
          lang: (data && data.lang) || (window.currentLang || 'en'),
          serverCount: servers.length,
          providerBreakdown: bdStr,
          analyticsEnabled: data && data.analytics_opt_out ? 'off' : 'on',
          lastError: lastApiError
        });
      });
    } catch (e) {
      resolve({
        version: chrome.runtime.getManifest().version,
        lang: window.currentLang || 'en',
        serverCount: '?', providerBreakdown: '?', analyticsEnabled: '?',
        lastError: lastApiError
      });
    }
  });
}

const GITHUB_NEW_ISSUE_URL = 'https://github.com/bingege2025/VPS-Sidebar-Dashboard/issues/new';
const DEV_EMAIL = 'renyanbin.wang@gmail.com';

// One-tap report of the last API error, with diagnostics pre-filled.
async function reportThisError() {
  const diag = await collectDiagnostics();
  const version = diag.version;
  const prefix = (lastApiError && lastApiError.panelType) ? '[' + lastApiError.panelType + '] ' : '';
  const title = '[Bug] ' + prefix + 'Auto-reported error';
  const lines = [
    '**Error message**',
    '```',
    (lastApiError && lastApiError.message) || '(no error captured)',
    '```',
    '',
    '**What were you doing?**',
    '- ',
    '',
    '**Expected behavior**',
    '- ',
    '',
    '**Actual behavior**',
    '- ',
    '',
    '---',
    `Extension Version: v${version}`,
    `Language: ${diag.lang}`,
    `Browser: ${navigator.userAgent}`,
    `Configured servers: ${diag.serverCount} (${diag.providerBreakdown})`,
    `Analytics: ${diag.analyticsEnabled}` + (lastApiError ? `; captured at: ${lastApiError.ts}` : ''),
    '',
    'Please do not include API keys, API hashes, tokens, IP addresses, or hostnames.'
  ];
  chrome.tabs.create({ url: `${GITHUB_NEW_ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(lines.join('\n'))}` });
}

// Open the anonymous, no-login quick feedback page (landing site).
// feedbackType (optional) preselects a radio on the page: bug | feature | provider | other.
function openQuickFeedback(feedbackType) {
  const version = chrome.runtime.getManifest().version;
  const lang = window.currentLang || 'en';
  const cid = 'anon-' + Date.now().toString(36);
  let url = `https://a.meng.mom/feedback?lang=${encodeURIComponent(lang)}&v=${encodeURIComponent(version)}&cid=${encodeURIComponent(cid)}`;
  if (feedbackType) url += `&type=${encodeURIComponent(feedbackType)}`;
  chrome.tabs.create({ url });
}

function initFeedbackSection() {
  const t = window.t;
  const feedbackProviderText = $('feedbackProviderText');
  const feedbackBugText = $('feedbackBugText');
  const feedbackEmailText = $('feedbackEmailText');
  const feedbackQuickText = $('feedbackQuickText');
  const feedbackProviderBtn = $('feedbackProviderBtn');
  const feedbackBugBtn = $('feedbackBugBtn');
  const feedbackEmailBtn = $('feedbackEmailBtn');
  const feedbackQuickBtn = $('feedbackQuickBtn');
  if (feedbackProviderText) feedbackProviderText.textContent = t('feedbackProvider');
  if (feedbackBugText) feedbackBugText.textContent = t('feedbackBug');
  if (feedbackEmailText) feedbackEmailText.textContent = t('feedbackEmail');
  if (feedbackQuickText) feedbackQuickText.textContent = t('feedbackQuick');
  if (feedbackProviderBtn) feedbackProviderBtn.title = t('feedbackProviderTitle');
  if (feedbackBugBtn) feedbackBugBtn.title = t('feedbackBugTitle');
  if (feedbackEmailBtn) feedbackEmailBtn.title = t('feedbackEmailTitle');
  if (feedbackQuickBtn) feedbackQuickBtn.title = t('feedbackQuickTitle');
}

// Bind feedback button clicks
const feedbackProviderBtn = $('feedbackProviderBtn');
if (feedbackProviderBtn) {
  feedbackProviderBtn.addEventListener('click', e => {
    e.preventDefault();
    if (typeof Analytics !== 'undefined') Analytics.requestProvider().catch(() => {});
    openQuickFeedback('provider');
  });
}

const feedbackBugBtn = $('feedbackBugBtn');
if (feedbackBugBtn) {
  feedbackBugBtn.addEventListener('click', e => {
    e.preventDefault();
    if (typeof Analytics !== 'undefined') Analytics.reportBug().catch(() => {});
    openQuickFeedback('bug');
  });
}

const feedbackQuickBtn = $('feedbackQuickBtn');
if (feedbackQuickBtn) {
  feedbackQuickBtn.addEventListener('click', e => {
    e.preventDefault();
    if (typeof Analytics !== 'undefined') Analytics.contactDev().catch(() => {});
    openQuickFeedback();
  });
}

const feedbackEmailBtn = $('feedbackEmailBtn');
if (feedbackEmailBtn) {
  feedbackEmailBtn.addEventListener('click', e => {
    e.preventDefault();
    if (typeof Analytics !== 'undefined') Analytics.contactDev().catch(() => {});
    const version = chrome.runtime.getManifest().version;
    const subject = encodeURIComponent(`VPS Dashboard v${version} - Feedback`);
    const body = encodeURIComponent(`\n\n---\nExtension Version: v${version}\nBrowser: ${navigator.userAgent}\nTimestamp: ${new Date().toISOString()}`);
    chrome.tabs.create({ url: `mailto:${DEV_EMAIL}?subject=${subject}&body=${body}` });
  });
}

// ---- Expiry calendar export ----

function popupToast(msg) {
  let el = $('popupToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'popupToast';
    el.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);background:#111827;color:#fff;padding:8px 14px;border-radius:9px;font-size:12px;font-weight:600;z-index:999;box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:0;transition:opacity .2s ease;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

function exportCurrentServerICS(t) {
  safeStorageGet(['servers', 'currentServerId', 'expiryThresholds'], data => {
    const servers = data.servers || [];
    const id = data.currentServerId || (servers[0] && servers[0].id);
    const s = servers.find(x => x.id === id);
    if (!s || !s.expiryDate) {
      popupToast(t('icsNoExpiry'));
      return;
    }
    const thresholds = (Array.isArray(data.expiryThresholds) && data.expiryThresholds.length)
      ? data.expiryThresholds
      : DEFAULT_EXPIRY_THRESHOLDS.slice();
    const meta = getProviderMeta(s.panel_type);
    const ics = buildICS([{
      id: s.id,
      name: s.name,
      providerName: meta ? meta.name : '',
      url: s.apiUrl,
      expiryDate: s.expiryDate,
      expirySource: s.expirySource
    }], { thresholds });
    downloadICS(`vps-expiry-${(s.name || 'server').replace(/[^\w\-]+/g, '_')}.ics`, ics);
    if (typeof Analytics !== 'undefined') Analytics.exportIcs(s.panel_type).catch(() => {});
    popupToast(t('icsExported'));
  });
}

// ---- Main initialization (fully synchronous, no await) ----

(function init() {
  // Delegate "打开插件" to the background service worker. A popup page can be
  // closed before an async fetch completes, which would silently drop the event;
  // the SW stays alive while handling the message, so the GA4 request goes through.
  try { chrome.runtime.sendMessage({ action: 'analytics_opened' }); } catch (e) {}
  const main = $('main');
  const statusBar = $('statusBar');
  if (!main) return;

  const t = window.t;

  // 将 lang 与其他数据一起读取，确保渲染前语言已就绪
  safeStorageGet(['servers', 'currentServerId', 'defaultServerId', 'tags', 'privacyModeEnabled', 'darkModeEnabled', 'apiUrl', 'apiKey', 'apiHash', 'lang', 'recentServerIds', 'expiryThresholds', 'onboardingSkipped'], data => {
    if (!data) {
      // Storage timed out or errored — show retry prompt
      main.innerHTML = `
        <div class="error">
          ${t('storageError')} 
          <a href="#" id="retryLink" style="color:#4a90d9;">${t('retry')}</a>
        </div>`;
      const retryLink = $('retryLink');
      if (retryLink) retryLink.addEventListener('click', e => { e.preventDefault(); init(); });
      return;
    }

    // 第一时间设置语言，确保后续所有 t() 调用使用正确的语言
    window.currentLang = data.lang || 'en';
    darkModeEnabled = Boolean(data.darkModeEnabled);
    applyTheme();
    const _thresholds = (Array.isArray(data.expiryThresholds) && data.expiryThresholds.length)
      ? data.expiryThresholds.map(Number).filter(n => n > 0)
      : DEFAULT_EXPIRY_THRESHOLDS.slice();
    expiryWarnDays = _thresholds.length ? Math.min.apply(null, _thresholds) : DEFAULT_EXPIRY_WARN_DAYS;

    // 更新所有静态 UI 文本
    if (settingsBtn) settingsBtn.title = t('settings');
    const searchInput = $('serverSearchInput');
    if (searchInput) searchInput.placeholder = t('searchPlaceholder');
    updatePrivacyToggle();
    initFeedbackSection();
    // 更新页面标题
    document.title = t('popupTitle') || 'VPS Dashboard';

    let list = data.servers || [];
    // Smooth compatibility migration from legacy flat keys
    if (list.length === 0 && data.apiUrl && data.apiKey && data.apiHash) {
      const oldServer = {
        id: 'server_' + Date.now(),
        name: 'Default Server',
        apiUrl: data.apiUrl,
        apiKey: data.apiKey,
        apiHash: data.apiHash,
        panel_type: 'solusvm',
        tags: []
      };
      list = [oldServer];
      data.currentServerId = oldServer.id;
      chrome.storage.local.set({
        servers: list,
        currentServerId: oldServer.id,
        tags: []
      }, () => {
        chrome.storage.local.remove(['apiUrl', 'apiKey', 'apiHash']);
      });
    }

    const normalizedServers = normalizeServers(list);
    allServers = normalizedServers;
    privacyModeEnabled = Boolean(data.privacyModeEnabled);
    const allTags = getAllTagsFromServers(normalizedServers);
    
    const serversChanged = JSON.stringify(data.servers) !== JSON.stringify(normalizedServers);
    const tagsChanged = JSON.stringify(data.tags || []) !== JSON.stringify(allTags);
    if (serversChanged || tagsChanged) {
      chrome.storage.local.set({ servers: normalizedServers, tags: allTags });
    }

    data.servers = normalizedServers;

    // First real usage: fire ONCE when the popup opens with at least one
    // configured server. Gated by a storage flag so it never double-counts.
    // Only the provider kind is reported — never a server name, IP, or id.
    if (normalizedServers.length > 0) {
      chrome.storage.local.get(['analytics_first_server_viewed'], function (flag) {
        if (!flag || !flag.analytics_first_server_viewed) {
          var _first = (data.currentServerId
            && normalizedServers.find(function (x) { return x.id === data.currentServerId; }))
            ? normalizedServers.find(function (x) { return x.id === data.currentServerId; }).panel_type
            : normalizedServers[0].panel_type;
          if (typeof Analytics !== 'undefined') Analytics.firstServerViewed(_first).catch(() => {});
          chrome.storage.local.set({ analytics_first_server_viewed: true });
        }
      });
    }

    function showNoConfigView() {
      main.innerHTML = `
        <div class="no-config">
          <p>${t('noConfig')}</p>
          <p style="margin-top:8px;"><a href="#" id="goConfig">${t('goConfig')}</a></p>
        </div>`;
      const goConfig = $('goConfig');
      if (goConfig) goConfig.addEventListener('click', e => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
      if (statusBar) statusBar.style.display = 'none';
      updateTriggerDisplay(null);
    }

    function renderOnboarding() {
      // Onboarding providers — keep in sync with options.html #panelType options.
      const ONBOARDING_PROVIDERS = ['solusvm', 'solusvm2', 'ec2', 'lightsail', 'virtfusion', 'virtualizor', 'proxmox', 'hetzner', 'digitalocean'];
      const ONBOARDING_GUIDE_BASE = 'https://a.meng.mom';
      const cards = ONBOARDING_PROVIDERS.map(pt => {
        const meta = (typeof getProviderMeta === 'function') ? getProviderMeta(pt) : { name: pt, logo: 'logos/default.svg' };
        const safeName = (meta.name || pt).replace(/"/g, '&quot;');
        return '<button class="provider-card" data-panel="' + pt + '" type="button">' +
                 '<img class="provider-logo" src="' + meta.logo + '" alt="' + safeName + '" />' +
                 '<span class="provider-name">' + safeName + '</span>' +
               '</button>';
      }).join('');
      main.innerHTML = `
        <div class="onboarding">
          <div class="onboarding-inner">
            <h1 class="onboarding-title">${t('onboardingTitle')}</h1>
            <p class="onboarding-subtitle">${t('onboardingSubtitle')}</p>
            <p class="onboarding-question">${t('onboardingQuestion')}</p>
            <div class="provider-grid">${cards}</div>
            <div class="onboarding-footer">
              <a href="${ONBOARDING_GUIDE_BASE}/guides/solusvm-v1.html?lang=${encodeURIComponent(window.currentLang || 'en')}" id="onboardingGuide" target="_blank" rel="noopener" class="onboarding-guide">${t('onboardingGuide')}</a>
              <span class="onboarding-sep">·</span>
              <a href="#" id="onboardingSkip" class="onboarding-skip">${t('onboardingSkip')}</a>
            </div>
          </div>
        </div>`;
      if (typeof Analytics !== 'undefined') Analytics.onboardingShown().catch(() => {});
      main.querySelectorAll('.provider-card').forEach(card => {
        card.addEventListener('click', () => {
          const pt = card.getAttribute('data-panel');
          try { chrome.runtime.sendMessage({ action: 'analytics_onboarding_pick', panelType: pt }); } catch (e) {}
          chrome.storage.local.set({ pendingPanelType: pt }, () => chrome.runtime.openOptionsPage());
        });
      });
      const guide = $('onboardingGuide');
      if (guide) guide.addEventListener('click', () => {
        if (typeof Analytics !== 'undefined') Analytics.onboardingGuideOpened('solusvm').catch(() => {});
      });
      const skip = $('onboardingSkip');
      if (skip) skip.addEventListener('click', e => {
        e.preventDefault();
        try { chrome.runtime.sendMessage({ action: 'analytics_onboarding_skip' }); } catch (e) {}
        chrome.storage.local.set({ onboardingSkipped: true }, () => showNoConfigView());
      });
      if (statusBar) statusBar.style.display = 'none';
      updateTriggerDisplay(null);
    }

    if (!data.servers || data.servers.length === 0) {
      if (data.onboardingSkipped) {
        showNoConfigView();
      } else {
        renderOnboarding();
      }
      return;
    }

    // Determine active server
    let activeId = data.currentServerId;
    if (data.defaultServerId && data.servers.some(s => s.id === data.defaultServerId)) {
      activeId = data.defaultServerId;
      chrome.storage.local.set({ currentServerId: activeId });
    }
    if (!activeId || !data.servers.some(s => s.id === activeId)) {
      activeId = data.servers[0].id;
      chrome.storage.local.set({ currentServerId: activeId });
    }

    // Render custom searchable dropdown
    const customSelect = $('customSelect');
    const selectTrigger = $('selectTrigger');
    const selectedServerName = $('selectedServerName');
    const selectDropdown = $('selectDropdown');
    const serverSearchInput = $('serverSearchInput');
    const privacyToggle = $('privacyToggle');
    const tagFilter = $('tagFilter');
    const selectOptions = $('selectOptions');

    if (customSelect && selectTrigger && selectedServerName && selectDropdown && serverSearchInput && selectOptions) {
      serverSearchInput.placeholder = t('searchPlaceholder') || 'Search servers...';
      let activeTag = '';
      let recentIds = (Array.isArray(data.recentServerIds) ? data.recentServerIds : [])
        .filter(id => data.servers.some(s => s.id === id))
        .slice(0, 5);

      const kbdHint = $('searchKbdHint');
      const updateKbdHint = () => {
        if (!kbdHint) return;
        kbdHint.textContent = serverSearchInput.value.trim() ? '↵' : 'esc';
      };

      const renderTagFilter = () => {
        if (!tagFilter) return;
        const tagsMarkup = [
          `<button type="button" class="tag-pill tag-all ${activeTag === '' ? 'active' : ''}" data-tag="">${escapeHtml(t('allTags') || 'All')}</button>`,
          ...allTags.map(tag => (
            `<button type="button" class="tag-pill ${tag.toLowerCase() === activeTag.toLowerCase() ? 'active' : ''}" data-tag="${escapeHtml(tag)}" title="${escapeHtml(tag)}" style="--chip-h: ${getTagHue(tag)}">${escapeHtml(tag)}</button>`
          ))
        ].join('');

        tagFilter.innerHTML = tagsMarkup;
        tagFilter.querySelectorAll('.tag-pill').forEach(pill => {
          pill.addEventListener('click', e => {
            e.stopPropagation();
            activeTag = pill.dataset.tag || '';
            renderTagFilter();
            renderOptions(serverSearchInput.value);
          });
        });
      };
      
      const optionHtml = (s) => {
        const meta = getProviderMeta(s.panel_type);
        return `<div class="select-option ${s.id === activeId ? 'selected' : ''}" data-id="${escapeHtml(s.id)}">` +
          `<img class="option-logo" src="${meta.logo}" alt="">` +
          `<div class="option-text">` +
            `<span class="option-provider">${escapeHtml(meta.name)}</span>` +
            `<span class="option-alias">${escapeHtml(s.name)}</span>` +
          `</div></div>`;
      };

      const renderOptions = (query) => {
        const normalizedQuery = query.trim().toLowerCase();
        const normalizedTag = activeTag.toLowerCase();
        const filtered = data.servers.filter(s => {
          const searchableText = [
            s.name,
            s.apiUrl,
            s.apiKey,
            ...(s.tags || [])
          ].filter(Boolean).join(' ').toLowerCase();
          const matchesSearch = !normalizedQuery || searchableText.includes(normalizedQuery);
          const matchesTag = !normalizedTag || (s.tags || []).some(tag => tag.toLowerCase() === normalizedTag);
          return matchesSearch && matchesTag;
        });
        if (filtered.length === 0) {
          selectOptions.innerHTML = `<div class="select-option no-results">${t('noTagMatches') || t('noServers')}</div>`;
          return;
        }
        // Raycast-style "Recent" group: only when browsing (no query / no tag filter)
        const recentServers = recentIds.map(id => filtered.find(s => s.id === id)).filter(Boolean);
        const restServers = filtered.filter(s => !recentIds.includes(s.id));
        const showGroups = !normalizedQuery && !normalizedTag && recentServers.length > 0 && restServers.length > 0;
        if (showGroups) {
          selectOptions.innerHTML =
            `<div class="select-group-label">${escapeHtml(t('recentServers') || 'Recent')}</div>` +
            recentServers.map(optionHtml).join('') +
            `<div class="select-group-label">${escapeHtml(t('allServers') || 'All Servers')}</div>` +
            restServers.map(optionHtml).join('');
        } else {
          selectOptions.innerHTML = filtered.map(optionHtml).join('');
        }

        const optionNodes = selectOptions.querySelectorAll('.select-option:not(.no-results)');
        optionNodes.forEach(node => {
          node.addEventListener('click', e => {
            const newId = node.getAttribute('data-id');
            activeId = newId;
            recentIds = [newId, ...recentIds.filter(id => id !== newId)].slice(0, 5);
            chrome.storage.local.set({ currentServerId: newId, recentServerIds: recentIds }, () => {
              customSelect.classList.remove('open');
              selectDropdown.style.display = 'none';
              serverSearchInput.value = '';
              updateKbdHint();
              const activeServer = data.servers.find(s => s.id === activeId);
              updateTriggerDisplay(activeServer);
              refreshInfo(t, main, statusBar);
            });
          });
        });
      };

      const activeServer = data.servers.find(s => s.id === activeId);
      updateTriggerDisplay(activeServer);
      renderTagFilter();
      renderOptions('');

      if (!selectTrigger.dataset.listenerBound) {
        selectTrigger.addEventListener('click', e => {
          e.stopPropagation();
          const isOpen = customSelect.classList.contains('open');
          if (isOpen) {
            customSelect.classList.remove('open');
            selectDropdown.style.display = 'none';
          } else {
            customSelect.classList.add('open');
            selectDropdown.style.display = 'block';
            serverSearchInput.focus();
            serverSearchInput.select();
            updateKbdHint();
          }
        });
        selectTrigger.dataset.listenerBound = 'true';
      }

      if (!serverSearchInput.dataset.listenerBound) {
        serverSearchInput.addEventListener('input', e => {
          renderOptions(e.target.value);
          updateKbdHint();
        });
        serverSearchInput.addEventListener('keydown', e => {
          if (e.key === 'Escape') {
            e.preventDefault();
            customSelect.classList.remove('open');
            selectDropdown.style.display = 'none';
            serverSearchInput.value = '';
            renderOptions('');
            updateKbdHint();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const first = selectOptions.querySelector('.select-option:not(.no-results)');
            if (first) first.click();
          }
        });
        serverSearchInput.addEventListener('click', e => e.stopPropagation());
        serverSearchInput.dataset.listenerBound = 'true';
      }

      if (privacyToggle && !privacyToggle.dataset.listenerBound) {
        privacyToggle.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          setPrivacyMode(!privacyModeEnabled, true);
        });
        privacyToggle.dataset.listenerBound = 'true';
      }

      applyPrivacyMode();

      if (!window.clickOutsideListenerBound) {
        document.addEventListener('click', () => {
          customSelect.classList.remove('open');
          selectDropdown.style.display = 'none';
          serverSearchInput.value = '';
          renderOptions('');
        });
        window.clickOutsideListenerBound = true;
      }
    }

    refreshInfo(t, main, statusBar);
  }, 2000);
})();

// ---- Refresh server info ----

function refreshInfo(t, main, statusBar, bypassCache) {
  t = t || window.t;
  main = main || $('main');
  statusBar = statusBar || $('statusBar');
  if (!main || !statusBar) return;

  safeStorageGet(['servers', 'currentServerId'], data => {
    if (!data) return;
    const currentId = data.currentServerId || (data.servers && data.servers[0] ? data.servers[0].id : null);
    if (!currentId) return;

    const cacheKey = 'cache_' + currentId;

    if (!bypassCache) {
      safeStorageGet(cacheKey, cacheData => {
        const cached = cacheData ? cacheData[cacheKey] : null;
        loadFresh(currentId, cacheKey, cached, t, main, statusBar);
      }, 1000);
    } else {
      loadFresh(currentId, cacheKey, null, t, main, statusBar);
    }
  }, 1500);
}

function loadFresh(currentId, cacheKey, cachedData, t, main, statusBar) {
  if (cachedData) {
    renderServerInfo(cachedData, cachedData, t, main);
    statusBar.style.display = 'block';
    statusBar.textContent = t('lastUpdatedCache', { time: cachedData.lastUpdated || 'Unknown' });
  } else {
    main.innerHTML = `<div class="loading">${t('loading')}</div>`;
  }

  // Single call — getStatus and getInfo return same data for all panels
  sendMessage('getInfo').then(infoRes => {
    if (!infoRes.success) throw new Error(infoRes.error);

    const freshData = {
      ...infoRes.data,
      status: infoRes.data.status,
      statusmsg: infoRes.data.statusmsg,
      vmstat: infoRes.data.vmstat,
      vmstate: infoRes.data.vmstate,
      state: infoRes.data.state,
      lastUpdated: new Date().toLocaleTimeString()
    };

    chrome.storage.local.set({ [cacheKey]: freshData }, () => {
      renderServerInfo(freshData, freshData, t, main);
      statusBar.style.display = 'block';
      statusBar.textContent = t('lastUpdated', { time: freshData.lastUpdated });
    });
  }).catch(err => {
    const currentServer = (allServers || []).find(s => s.id === currentId);
    recordApiError(err.message, currentServer ? currentServer.panel_type : null);
    if (cachedData) {
      statusBar.style.display = 'block';
      statusBar.textContent = t('updateFail', { error: err.message });
    } else {
      main.innerHTML = `<div class="error">❌ ${escapeHtml(err.message)}<br><button id="reportErrorBtn" class="btn-error-report" title="${t('reportThisErrorTitle')}">${t('reportThisError')}</button></div>`;
      const rb = $('reportErrorBtn');
      if (rb) rb.addEventListener('click', e => { e.preventDefault(); reportThisError(); });
    }
  });
}

// ---- Render server info ----

function renderServerInfo(status, info, t, main) {
  t = t || window.t;
  main = main || $('main');
  if (!main) return;

  const candidates = [
    status.vmstat,
    info.vmstat,
    status.statusmsg,
    info.statusmsg,
    status.vmstate,
    info.vmstate,
    status.state,
    info.state
  ].filter(v => v && typeof v === 'string' && v.toLowerCase() !== 'success');

  const isOnline = candidates.some(val => {
    const v = String(val).toLowerCase();
    if (v.includes('offline') || v.includes('stopped') || v.includes('shutdown') || v === 'down') return false;
    return v.includes('online') || v.includes('running') || v.includes('active') || v.includes('started') || v.includes('booted') || v === 'up';
  });

  // Detect transitional states (e.g. EC2: pending / stopping / shutting-down)
  // Power actions are not allowed in these states — AWS rejects them.
  let transitionState = null;
  const isTransitioning = !isOnline && candidates.some(val => {
    const v = String(val).toLowerCase();
    if (['pending', 'stopping', 'shutting', 'starting', 'rebooting', 'initializing'].some(kw => v.includes(kw))) {
      transitionState = String(val);
      return true;
    }
    return false;
  });

  // ---- Expiry reminder ----
  const expiry = info.expiry || null;
  const expiryLvl = expiry ? expiryLevel(expiry.daysLeft, expiryWarnDays) : null;
  let expiryBanner = '';
  if (expiry && (expiryLvl === 'urgent' || expiryLvl === 'soon' || expiryLvl === 'expired')) {
    const msg = expiryLvl === 'expired'
      ? t('expiryExpired', { days: -expiry.daysLeft })
      : (expiryLvl === 'urgent'
        ? t('expiryUrgent', { days: expiry.daysLeft })
        : t('expirySoon', { days: expiry.daysLeft }));
    expiryBanner = `<div class="expiry-banner ${expiryLvl}">${lucideIcon('clock', 14)}<span>${escapeHtml(msg)}</span></div>`;
  }

  main.innerHTML = `
    <div class="content" id="serverDetail">
      ${expiryBanner}
      <div class="info-grid">
        <span class="label">${t('hostname')}</span>
        <span class="value privacy-field" data-field="hostname">${escapeHtml(info.hostname || '-')}</span>
        <span class="label">${t('status')}</span>
        <span class="value"><span class="status-badge ${isOnline ? 'online' : (isTransitioning ? 'transitioning' : 'offline')}" data-field="status">${isOnline ? t('online') : (isTransitioning ? escapeHtml(transitionState) : t('offline'))}</span></span>
        <span class="label">${t('ip')}</span>
        <span class="value privacy-field" data-field="ip">${escapeHtml(info.ipaddress || status.ip || '-')}</span>
        <span class="label">${t('os')}</span>
        <span class="value" data-field="os">${escapeHtml(info.os || info.template || '-')}</span>
        <span class="label">${t('mem')}</span>
        <span class="value" data-field="mem">${formatResource(info.mem)}</span>
        <span class="label">${t('hdd')}</span>
        <span class="value" data-field="hdd">${formatResource(info.hdd)}</span>
        <span class="label">${t('bw')}</span>
        <span class="value" data-field="bw">${formatResource(info.bw)}</span>
        <span class="label">${t('expiry')}</span>
        <span class="value">${expiry
          ? `<span class="expiry-badge ${expiryLvl}">${escapeHtml(expiry.date)} · ${expiryLvl === 'expired' ? escapeHtml(t('expired')) : escapeHtml(t('daysLeft', { days: expiry.daysLeft }))}</span>${info.expirySource === 'api' ? `<span class="expiry-source-tag" title="${escapeHtml(t('expiryApiTagHint'))}">API</span>` : ''}`
          : '—'}</span>
      </div>
      <div class="actions">
        <button class="btn-refresh" id="refreshBtn">${lucideIcon('refresh', 15)}${t('btnRefresh')}</button>
        <button class="btn-ics" id="exportIcsBtn" title="${escapeHtml(t('btnExportIcs'))}">${lucideIcon('calendar', 15)}${escapeHtml(t('btnExportIcs'))}</button>
        ${isTransitioning
          ? `<button class="btn-transitioning" id="transitioningBtn" disabled>${lucideIcon('loader', 15)}${t('stateTransitioning', { state: escapeHtml(transitionState) })}</button>`
          : isOnline
          ? `<button class="btn-reboot" id="rebootBtn">${lucideIcon('reboot', 15)}${t('btnReboot')}</button>
             <button class="btn-shutdown" id="shutdownBtn">${lucideIcon('power', 15)}${t('btnShutdown')}</button>`
          : `<button class="btn-boot" id="bootBtn">${lucideIcon('play', 15)}${t('btnBoot')}</button>`
        }
      </div>
      <div id="confirmPanelHost"></div>
      <div class="batch-select-panel">
        <div class="batch-select-bar">
          <span class="batch-hint">${t('batchSelectHint')}</span>
          <button type="button" class="batch-toggle" id="batchSelectAllBtn">${t('selectAll')}</button>
        </div>
        <div class="batch-server-list" id="batchServerList">
          ${allServers.map(s => {
            const exp = computeExpiry(s.expiryDate);
            const lvl = exp ? expiryLevel(exp.daysLeft, expiryWarnDays) : null;
            const chip = (exp && (lvl === 'soon' || lvl === 'urgent' || lvl === 'expired'))
              ? `<span class="expiry-chip ${lvl}" title="${escapeHtml(t('expiry'))}">${lvl === 'expired' ? escapeHtml(t('expired')) : escapeHtml(t('daysLeft', { days: exp.daysLeft }))}</span>`
              : '';
            return `
            <label class="batch-server-row">
              <input type="checkbox" class="batch-checkbox" value="${escapeHtml(s.id)}">
              <span class="batch-server-name">${escapeHtml(s.name)}</span>
              ${chip}
            </label>`;
          }).join('')}
        </div>
      </div>
      <div class="bulk-bar">
        <button id="batchRefreshBtn">${lucideIcon('refresh', 14)}${t('batchRefresh')}</button>
        <button class="bulk-reboot" id="batchRebootBtn">${lucideIcon('reboot', 14)}${t('batchReboot')}</button>
        <button class="bulk-shutdown" id="batchShutdownBtn">${lucideIcon('power', 14)}${t('batchShutdown')}</button>
      </div>
      <div class="bulk-result" id="bulkResultHost"></div>
    </div>`;

  applyPrivacyMode();

  const hostname = info.hostname || '-';

  $('refreshBtn').addEventListener('click', () => doAction('refresh', t('btnRefresh'), t, main));
  const exportIcsBtn = $('exportIcsBtn');
  if (exportIcsBtn) exportIcsBtn.addEventListener('click', () => exportCurrentServerICS(t));
  if (isTransitioning) {
    // No power actions while transitioning — auto refresh to pick up the settled state
    setTimeout(() => silentUpdateCurrentServer(t), 8000);
  } else if (isOnline) {
    const rebootBtn = $('rebootBtn');
    if (rebootBtn) rebootBtn.addEventListener('click', () => {
      showInlineConfirm({
        message: t('confirmReboot', { hostname }),
        actionLabel: t('btnReboot'),
        danger: false,
        onConfirm: () => doAction('reboot', t('reboot'), t, main)
      });
    });
    const btn = $('shutdownBtn');
    if (btn) btn.addEventListener('click', () => {
      showInlineConfirm({
        message: t('confirmShutdown', { hostname }),
        actionLabel: t('btnShutdown'),
        danger: true,
        onConfirm: () => doAction('shutdown', t('shutdown'), t, main)
      });
    });
  } else {
    const btn = $('bootBtn');
    if (btn) btn.addEventListener('click', () => doAction('boot', t('boot'), t, main));
  }

  // Batch selection: select all / deselect all
  const batchSelectAllBtn = $('batchSelectAllBtn');
  const batchServerList = $('batchServerList');
  if (batchSelectAllBtn && batchServerList) {
    let allSelected = false;
    batchSelectAllBtn.addEventListener('click', () => {
      allSelected = !allSelected;
      const checkboxes = batchServerList.querySelectorAll('.batch-checkbox');
      checkboxes.forEach(cb => { cb.checked = allSelected; });
      batchSelectAllBtn.textContent = allSelected ? t('deselectAll') : t('selectAll');
    });
  }

  // Batch action buttons
  function getSelectedServerIds() {
    const checkboxes = document.querySelectorAll('#batchServerList .batch-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.value);
  }

  const batchRefreshBtn = $('batchRefreshBtn');
  if (batchRefreshBtn) batchRefreshBtn.addEventListener('click', () => {
    const ids = getSelectedServerIds();
    if (ids.length === 0) return;
    doBulkAction('batchRefresh', t('batchRefresh'), t, main, ids);
  });
  const batchRebootBtn = $('batchRebootBtn');
  if (batchRebootBtn) batchRebootBtn.addEventListener('click', () => {
    const ids = getSelectedServerIds();
    if (ids.length === 0) return;
    showInlineConfirm({
      message: t('confirmBatchReboot'),
      actionLabel: t('batchReboot'),
      danger: false,
      onConfirm: () => doBulkAction('batchReboot', t('batchReboot'), t, main, ids)
    });
  });
  const batchShutdownBtn = $('batchShutdownBtn');
  if (batchShutdownBtn) batchShutdownBtn.addEventListener('click', () => {
    const ids = getSelectedServerIds();
    if (ids.length === 0) return;
    showInlineConfirm({
      message: t('confirmBatchShutdown'),
      actionLabel: t('batchShutdown'),
      danger: true,
      onConfirm: () => doBulkAction('batchShutdown', t('batchShutdown'), t, main, ids)
    });
  });
}

function showInlineConfirm({ message, actionLabel, danger, onConfirm }) {
  const host = $('confirmPanelHost');
  if (!host) return;
  host.innerHTML = `
    <div class="confirm-panel ${danger ? 'danger' : ''}">
      <div class="confirm-message">${escapeHtml(message)}</div>
      <div class="confirm-actions">
        <button type="button" class="btn-confirm-cancel" id="confirmCancelBtn">${escapeHtml(window.t('btnCancel'))}</button>
        <button type="button" class="btn-confirm-action ${danger ? 'danger' : ''}" id="confirmActionBtn">${escapeHtml(actionLabel)}</button>
      </div>
    </div>`;

  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const cancelBtn = $('confirmCancelBtn');
  const actionBtn = $('confirmActionBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      host.innerHTML = '';
    });
  }
  if (actionBtn) {
    actionBtn.addEventListener('click', () => {
      host.innerHTML = '';
      onConfirm();
    });
  }
}

// ---- Execute operation ----

function doAction(action, label, t, main) {
  t = t || window.t;

  // Anonymous usage analytics: resolve current server provider, fire one event.
  // Only provider type + action are sent; never server name / IP / instance id.
  if (typeof Analytics !== 'undefined') {
    chrome.storage.local.get(['servers', 'currentServerId'], function (data) {
      var list = (data && data.servers) || [];
      var id = data && data.currentServerId;
      var s = list.find(function (x) { return x.id === id; }) || list[0];
      if (s) Analytics.serverAction(s.panel_type, action);
    });
  }

  const statusBar = $('statusBar');
  if (statusBar) {
    statusBar.style.display = 'block';
    statusBar.textContent = `⏳ ${label}...`;
  }

  if (action === 'refresh') {
    silentUpdateCurrentServer(t);
    return;
  }

  // Reboot / shutdown / boot
  sendMessage(action).then(res => {
    if (res.success) {
      if (statusBar) statusBar.textContent = t('sentAction', { action: label });
      setTimeout(() => silentUpdateCurrentServer(t), 5000);
    } else {
      if (statusBar) statusBar.textContent = t('actionFail', { action: label, error: res.error });
    }
  });
}

// ---- Bulk operations ----

function doBulkAction(action, label, t, main, serverIds) {
  t = t || window.t;
  main = main || $('main');
  const resultHost = $('bulkResultHost');
  if (resultHost) resultHost.innerHTML = `<span style="color:#999;">⏳ ${label}...</span>`;

  // Anonymous usage analytics (plan A): one event per affected server, so the
  // per-provider breakdown is accurate. Only provider type + action are sent.
  if (typeof Analytics !== 'undefined') {
    chrome.storage.local.get(['servers'], function (data) {
      var list = (data && data.servers) || [];
      serverIds.forEach(function (sid) {
        var s = list.find(function (x) { return x.id === sid; });
        if (s) Analytics.batchAction(s.panel_type, action);
      });
    });
  }

  sendMessage(action, { serverIds }).then(res => {
    if (!res.success) {
      if (resultHost) resultHost.innerHTML = `<span class="err">❌ ${res.error}</span>`;
      return;
    }
    const results = res.data || [];
    const okCount = results.filter(r => r.success).length;
    const errCount = results.filter(r => !r.success).length;

    let html = '';
    results.forEach(r => {
      html += r.success
        ? `<div class="ok">✅ ${escapeHtml(r.name)}</div>`
        : `<div class="err">❌ ${escapeHtml(r.name)}: ${escapeHtml(r.error)}</div>`;
    });

    if (resultHost) {
      resultHost.innerHTML = html;
      resultHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (action === 'batchRefresh') {
      setTimeout(() => silentUpdateCurrentServer(t), 1000);
    } else {
      setTimeout(() => silentUpdateCurrentServer(t), 5000);
    }
  });
}

// Silently refresh current server info without full page re-render
async function silentUpdateCurrentServer(t) {
  t = t || window.t;
  const statusBar = $('statusBar');

  try {
    const [statusRes, infoRes] = await Promise.all([
      sendMessage('getStatus'),
      sendMessage('getInfo')
    ]);

    if (!infoRes.success) return;

    const status = statusRes.success ? statusRes.data : {};
    const info = infoRes.data;

    const candidates = [
      status.vmstat,
      info.vmstat,
      status.statusmsg,
      info.statusmsg,
      status.vmstate,
      info.vmstate,
      status.state,
      info.state
    ].filter(v => v && typeof v === 'string' && v.toLowerCase() !== 'success');

    const isOnline = candidates.some(v => {
      const lower = v.toLowerCase();
      if (['offline', 'stopped', 'shutdown'].some(kw => lower.includes(kw)) || lower === 'down') return false;
      return ['online', 'running', 'active', 'started', 'booted'].some(kw => lower.includes(kw));
    }) || String(status.statusmsg || '').toLowerCase() === 'up';

    // Detect transitional states (e.g. EC2: pending / stopping / shutting-down)
    let transitionState = null;
    const isTransitioning = !isOnline && candidates.some(val => {
      const v = String(val).toLowerCase();
      if (['pending', 'stopping', 'shutting', 'starting', 'rebooting', 'initializing'].some(kw => v.includes(kw))) {
        transitionState = String(val);
        return true;
      }
      return false;
    });

    // Update status badge
    const statusBadge = document.querySelector('[data-field="status"]');
    if (statusBadge) {
      statusBadge.className = `status-badge ${isOnline ? 'online' : (isTransitioning ? 'transitioning' : 'offline')}`;
      statusBadge.textContent = isOnline ? t('online') : (isTransitioning ? transitionState : t('offline'));
    }

    // Update action buttons based on online state
    const actionsEl = document.querySelector('.actions');
    if (actionsEl) {
      const hostname = info.hostname || '';
      const powerHtml = isTransitioning
        ? `<button class="btn-transitioning" id="transitioningBtn" disabled>${lucideIcon('loader', 15)}${t('stateTransitioning', { state: escapeHtml(transitionState) })}</button>`
        : isOnline
        ? `<button class="btn-reboot" id="rebootBtn">${lucideIcon('reboot', 15)}${t('btnReboot')}</button>
           <button class="btn-shutdown" id="shutdownBtn">${lucideIcon('power', 15)}${t('btnShutdown')}</button>`
        : `<button class="btn-boot" id="bootBtn">${lucideIcon('play', 15)}${t('btnBoot')}</button>`;
      actionsEl.innerHTML = `
        <button class="btn-refresh" id="refreshBtn">${lucideIcon('refresh', 15)}${t('btnRefresh')}</button>
        <button class="btn-ics" id="exportIcsBtn" title="${escapeHtml(t('btnExportIcs'))}">${lucideIcon('calendar', 15)}${escapeHtml(t('btnExportIcs'))}</button>
        ${powerHtml}
      `;
      // Re-bind action events
      $('refreshBtn').addEventListener('click', () => doAction('refresh', t('btnRefresh'), t, $('main')));
      const exportIcsBtn2 = $('exportIcsBtn');
      if (exportIcsBtn2) exportIcsBtn2.addEventListener('click', () => exportCurrentServerICS(t));
      if (isTransitioning) {
        // Keep polling until the state settles
        setTimeout(() => silentUpdateCurrentServer(t), 8000);
      } else if (isOnline) {
        const rebootBtn = $('rebootBtn');
        if (rebootBtn) rebootBtn.addEventListener('click', () => {
          showInlineConfirm({
            message: t('confirmReboot', { hostname }),
            actionLabel: t('btnReboot'),
            danger: false,
            onConfirm: () => doAction('reboot', t('reboot'), t, $('main'))
          });
        });
        const shutdownBtn = $('shutdownBtn');
        if (shutdownBtn) shutdownBtn.addEventListener('click', () => {
          showInlineConfirm({
            message: t('confirmShutdown', { hostname }),
            actionLabel: t('btnShutdown'),
            danger: true,
            onConfirm: () => doAction('shutdown', t('shutdown'), t, $('main'))
          });
        });
      } else {
        const bootBtn = $('bootBtn');
        if (bootBtn) bootBtn.addEventListener('click', () => doAction('boot', t('boot'), t, $('main')));
      }
    }

    // Update cache
    safeStorageGet(['servers', 'currentServerId'], storageData => {
      if (!storageData) return;
      const currentId = storageData.currentServerId || (storageData.servers && storageData.servers[0] ? storageData.servers[0].id : null);
      if (!currentId) return;
      const cacheKey = 'cache_' + currentId;
      const freshData = {
        ...info,
        status: status.status || info.status,
        statusmsg: status.statusmsg || info.statusmsg,
        vmstat: status.vmstat || info.vmstat,
        vmstate: status.vmstate || info.vmstate,
        state: status.state || info.state,
        lastUpdated: new Date().toLocaleTimeString()
      };
      chrome.storage.local.set({ [cacheKey]: freshData });
    });

    // Update status bar
    if (statusBar) {
      statusBar.style.display = 'block';
      statusBar.textContent = t('lastUpdated', { time: new Date().toLocaleTimeString() });
    }

    // Re-apply privacy mode
    applyPrivacyMode();
  } catch (e) {
    console.error('silentUpdateCurrentServer error:', e);
  }
}
