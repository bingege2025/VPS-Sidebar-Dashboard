// Options page logic — Multi-Panel Driver ready

const $ = id => document.getElementById(id);

let servers = [];
let editingServerId = null;
let defaultServerId = null;
let allTags = [];
let darkModeEnabled = false;
const CONFIG_EXPORT_VERSION = 1;

const t = window.t;
const LANDING_BASE_URL = 'https://a.meng.mom';
const PROVIDER_GUIDE_PATHS = {
  solusvm: '/guides/solusvm-v1.html',
  ec2: '/guides/aws-ec2.html',
  solusvm2: '/guides/solusvm-v2.html',
  virtfusion: '/guides/virtfusion.html',
  virtualizor: '/guides/virtualizor.html',
  proxmox: '/guides/proxmox.html',
  hetzner: '/guides/hetzner.html',
  digitalocean: '/guides/digitalocean.html',
  lightsail: '/guides/lightsail.html'
};

// HTML escape to prevent XSS
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

function showMsg(text, ok) {
  const el = $('msg');
  if (el) {
    el.textContent = text;
    el.className = 'msg ' + (ok ? 'ok' : 'err');
    el.style.display = 'block';
  }
}

function hideMsg() {
  const el = $('msg');
  if (el) {
    el.style.display = 'none';
  }
}

function updateThemeToggle() {
  const btn = $('themeToggle');
  if (!btn) return;
  btn.innerHTML = lucideIcon(darkModeEnabled ? 'sun' : 'moon', 15);
  btn.title = darkModeEnabled ? t('lightMode') : t('darkMode');
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

// normalizeTagList, normalizeServers, getAllTagsFromServers → shared.js

function persistServers(nextServers, currentServerId, callback) {
  allTags = getAllTagsFromServers(nextServers);
  chrome.storage.local.set({
    servers: nextServers,
    tags: allTags,
    currentServerId
  }, callback);
}

function getProviderCredentialSummary(panelType) {
  if (providerUsesAwsRegion(panelType)) return t('providerCredAws');
  if (!providerNeedsApiHash(panelType)) return t('providerCredToken');
  if (panelType === 'virtualizor') return t('providerCredKeyPass');
  return t('providerCredKeyHash');
}

function getProviderEndpointSummary(panelType) {
  if (providerUsesAwsRegion(panelType)) return t('providerEndpointRegion');
  if (getProviderDefaultApiUrl(panelType)) return t('providerEndpointAuto');
  if (panelType === 'solusvm2' || panelType === 'virtfusion') return t('providerEndpointServerUrl');
  return t('providerEndpointPanel');
}

function getProviderList() {
  const ordered = (typeof PROVIDER_ORDER !== 'undefined') ? PROVIDER_ORDER : Object.keys(PROVIDER_META);
  return ordered.filter(panelType => PROVIDER_META[panelType]);
}

function renderProviderCards() {
  const wrap = $('providerCards');
  const select = $('panelType');
  if (!wrap || !select) return;

  const selected = select.value || 'solusvm';
  wrap.innerHTML = getProviderList().map(panelType => {
    const meta = getProviderMeta(panelType);
    const active = panelType === selected;
    return `
      <button type="button" class="provider-card ${active ? 'active' : ''}" data-panel-type="${panelType}" aria-pressed="${active ? 'true' : 'false'}">
        <img class="provider-card-logo" src="${meta.logo}" alt="">
        <span class="provider-card-copy">
          <span class="provider-card-name">${escapeHtml(meta.name)}</span>
          <span class="provider-card-meta">${escapeHtml(getProviderCredentialSummary(panelType))} · ${escapeHtml(getProviderEndpointSummary(panelType))}</span>
        </span>
      </button>
    `;
  }).join('');
}

function updateProviderCards() {
  const selected = $('panelType') ? $('panelType').value : 'solusvm';
  document.querySelectorAll('.provider-card').forEach(card => {
    const active = card.dataset.panelType === selected;
    card.classList.toggle('active', active);
    card.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function maybePrefillProviderEndpoint(panelType) {
  const input = $('apiUrl');
  if (!input) return;
  const defaultUrl = getProviderDefaultApiUrl(panelType);
  if (!defaultUrl) return;

  const current = input.value.trim();
  const defaults = (typeof PROVIDER_DEFAULT_API_URLS !== 'undefined') ? PROVIDER_DEFAULT_API_URLS : {};
  const knownDefaults = Object.values(defaults);
  if (!current || knownDefaults.indexOf(current) !== -1) {
    input.value = defaultUrl;
  }
}

function clearFieldErrors() {
  document.querySelectorAll('.form-group.invalid').forEach(group => {
    group.classList.remove('invalid');
  });
  document.querySelectorAll('.field-error').forEach(el => {
    el.textContent = '';
    el.classList.remove('show');
  });
}

function setFieldError(inputId, message) {
  const input = $(inputId);
  const errorEl = $(`${inputId}Error`);
  if (input) {
    const group = input.closest('.form-group');
    if (group) group.classList.add('invalid');
    input.setAttribute('aria-invalid', 'true');
  }
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.add('show');
  }
}

function clearFieldInvalidState(inputId) {
  const input = $(inputId);
  if (!input) return;
  input.removeAttribute('aria-invalid');
  const group = input.closest('.form-group');
  if (group) group.classList.remove('invalid');
  const errorEl = $(`${inputId}Error`);
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.remove('show');
  }
}

function uniqueServerName(baseName) {
  const base = baseName || 'VPS';
  const used = new Set(
    servers
      .filter(server => server.id !== editingServerId)
      .map(server => String(server.name || '').toLowerCase())
  );
  if (!used.has(base.toLowerCase())) return base;
  let suffix = 2;
  while (used.has(`${base} ${suffix}`.toLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}

function buildAutoServerName(panelType, endpoint) {
  const meta = getProviderMeta(panelType);
  if (providerUsesAwsRegion(panelType)) {
    return uniqueServerName(`${meta.name} ${String(endpoint || '').split('/')[0] || 'Server'}`);
  }
  try {
    const url = new URL(endpoint);
    return uniqueServerName(`${meta.name} ${url.hostname}`);
  } catch (e) {
    return uniqueServerName(`${meta.name} Server`);
  }
}

function syncAdvancedPanel(server) {
  const advanced = $('advancedSettings');
  if (!advanced) return;
  advanced.open = Boolean(server && (
    normalizeTagList(server.tags).length > 0 ||
    server.expiryDate ||
    server.expiryDisabled
  ));
}

function collectServerForm(options = {}) {
  clearFieldErrors();

  const panelType = $('panelType').value;
  const cleanedUrl = normalizeProviderEndpoint(panelType, $('apiUrl').value);
  const apiKey = $('apiKey').value.trim();
  const needsHash = providerNeedsApiHash(panelType);
  const apiHash = needsHash ? $('apiHash').value.trim() : '';
  const missingText = field => t('msgRequiredField', { field });
  const errors = [];

  if (!cleanedUrl) {
    errors.push({ inputId: 'apiUrl', message: missingText($('i18n_labelUrl').textContent) });
  } else if (!isValidProviderEndpoint(panelType, cleanedUrl)) {
    errors.push({
      inputId: 'apiUrl',
      message: providerUsesAwsRegion(panelType) ? t('msgInvalidRegion') : t('msgInvalidUrl')
    });
  }

  if (!apiKey) {
    errors.push({ inputId: 'apiKey', message: missingText($('i18n_labelKey').textContent) });
  }

  if (needsHash && !apiHash) {
    errors.push({ inputId: 'apiHash', message: missingText($('i18n_labelHash').textContent) });
  }

  if (errors.length > 0) {
    errors.forEach(error => setFieldError(error.inputId, error.message));
    const first = $(errors[0].inputId);
    if (first && options.focus !== false) first.focus();
    showMsg(t('msgRequired'), false);
    return null;
  }

  const name = $('serverName').value.trim() || buildAutoServerName(panelType, cleanedUrl);
  if (options.updateInputs) {
    $('serverName').value = name;
    $('apiUrl').value = cleanedUrl;
    if (!needsHash) $('apiHash').value = '';
  }

  return {
    name,
    apiUrl: cleanedUrl,
    apiKey,
    apiHash,
    panelType
  };
}

// Apply internationalization translations
function applyTranslations() {
  $('i18n_title').innerHTML = lucideIcon('settings', 20) + '<span>VPS Dashboard · ' + t('subtitle') + '</span>';
  $('addBtn').innerHTML = lucideIcon('plus', 14) + t('btnAdd');
  $('i18n_labelName').textContent = t('labelName');
  $('i18n_hintName').textContent = t('hintName');
  $('i18n_labelPanelType').textContent = t('labelPanelType');
  $('i18n_hintPanelType').textContent = t('hintPanelType');
  $('i18n_advancedTitle').textContent = t('advancedTitle');
  $('i18n_labelUrl').textContent = t('labelUrl');
  $('i18n_hintUrl').textContent = t('hintUrl');
  $('i18n_labelKey').textContent = t('labelKey');
  $('i18n_hintKey').textContent = t('hintKey');
  $('i18n_labelHash').textContent = t('labelHash');
  $('i18n_hintHash').textContent = t('hintHash');
  $('i18n_labelTags').textContent = t('labelTags');
  $('i18n_hintTags').textContent = t('hintTags');
  $('i18n_prefsTitle').textContent = t('prefsTitle');
  $('i18n_labelReminders').textContent = t('labelReminders');
  $('i18n_hintReminders').textContent = t('hintReminders');
  $('i18n_labelThresholds').textContent = t('labelThresholds');
  $('i18n_hintThresholds').textContent = t('hintThresholds');
  $('i18n_expiryApiNote').textContent = t('expiryApiNote');
  $('i18n_labelExpiryDisabled').textContent = t('labelExpiryDisabled');
  $('i18n_labelAnalytics').textContent = t('labelAnalytics');
  $('i18n_hintAnalytics').textContent = t('hintAnalytics');
  $('testReminderBtn').textContent = t('btnTestReminder');
  $('exportIcsBtn').textContent = t('btnExportIcs');
  $('i18n_labelExpiry').textContent = t('labelExpiry');
  $('i18n_hintExpiry').textContent = t('hintExpiry');
  $('i18n_configToolsTitle').textContent = t('configToolsTitle');
  $('i18n_configToolsHint').textContent = t('configToolsHint');
  
  $('saveBtn').textContent = t('btnSave');
  $('testBtn').textContent = t('btnTest');
  $('exportConfigBtn').textContent = t('btnExportConfig');
  $('importConfigBtn').textContent = t('btnImportConfig');
  
  // placeholder
  $('serverName').placeholder = t('placeholderName');
  $('apiUrl').placeholder = t('placeholderUrl');
  $('apiKey').placeholder = t('placeholderKey');
  $('apiHash').placeholder = t('placeholderHash');
  $('serverTags').placeholder = t('placeholderTags');
  
  // 页面标题
  document.title = t('title');
  
  // Form title
  if (editingServerId) {
    const s = servers.find(item => item.id === editingServerId);
    $('formTitle').textContent = t('formTitleEdit', { name: s ? s.name : '' });
  } else {
    $('formTitle').textContent = t('formTitleAdd');
  }
  
  renderServerList();
  renderProviderCards();
  updatePanelHelp();
}

function updatePanelHelp() {
  const panelType = $('panelType') ? $('panelType').value : 'solusvm';
  const providerMeta = getProviderMeta(panelType);
  const guidePath = PROVIDER_GUIDE_PATHS[panelType];
  const guideWrap = document.querySelector('.provider-guide');
  const guideLink = $('providerGuideLink');
  // Providers without a setup guide hide the callout. Do NOT return early here:
  // the field labels below must still update for every provider.
  if (guidePath) {
    if (guideWrap) guideWrap.style.display = '';
    if ($('providerGuideTitle')) {
      $('providerGuideTitle').textContent = t('providerGuideTitle', { provider: providerMeta.name });
    }
    if ($('providerGuideText')) {
      $('providerGuideText').textContent = t('providerGuideText');
    }
    if (guideLink) {
      // Pass the current plugin UI language so the landing guide opens in the same language.
      const pluginLang = window.currentLang || 'en';
      guideLink.href = LANDING_BASE_URL + guidePath + '?lang=' + encodeURIComponent(pluginLang);
      guideLink.textContent = t('providerGuideLink');
      if (!guideLink._analyticsBound) {
        guideLink._analyticsBound = true;
        guideLink.addEventListener('click', () => {
          const p = $('panelType') ? $('panelType').value : 'solusvm';
          if (typeof Analytics !== 'undefined') Analytics.viewGuide(p).catch(() => {});
        });
      }
    }
  } else if (guideWrap) {
    guideWrap.style.display = 'none';
  }

  maybePrefillProviderEndpoint(panelType);
  updateProviderCards();

  const hashRequired = providerNeedsApiHash(panelType);
  const hashGroup = $('apiHashGroup');
  const hashInput = $('apiHash');
  const endpointInput = $('apiUrl');
  if (endpointInput) {
    endpointInput.type = providerUsesAwsRegion(panelType) ? 'text' : 'url';
  }
  if (hashGroup) hashGroup.style.display = hashRequired ? '' : 'none';
  if (hashInput) {
    hashInput.disabled = !hashRequired;
    if (!hashRequired) {
      clearFieldInvalidState('apiHash');
      hashInput.type = 'password';
    }
  }

  if (panelType === 'lightsail' || panelType === 'ec2') {
    $('i18n_labelUrl').textContent = t('labelUrlLightsail');
    $('i18n_hintUrl').textContent = t('hintUrlLightsail');
    $('i18n_labelKey').textContent = t('labelKeyLightsail');
    $('i18n_hintKey').textContent = t('hintKeyLightsail');
    $('i18n_labelHash').textContent = t('labelHashLightsail');
    $('i18n_hintHash').textContent = t('hintHashLightsail');
    $('apiUrl').placeholder = t('placeholderUrlLightsail');
    $('apiKey').placeholder = t('placeholderKeyLightsail');
    $('apiHash').placeholder = t('placeholderHashLightsail');
  } else if (panelType === 'solusvm2' || panelType === 'virtfusion' || panelType === 'proxmox' || panelType === 'hetzner' || panelType === 'digitalocean') {
    $('i18n_labelUrl').textContent = t('labelUrlV2');
    $('i18n_hintUrl').textContent = t('hintUrlV2');
    $('i18n_labelKey').textContent = t('labelKeyV2');
    $('i18n_hintKey').textContent = t('hintKeyV2');
    $('i18n_labelHash').textContent = t('labelHashV2');
    $('i18n_hintHash').textContent = t('hintHashV2');
    $('apiUrl').placeholder = t('placeholderUrlV2');
    $('apiKey').placeholder = t('placeholderKeyV2');
    $('apiHash').placeholder = t('placeholderHashV2');
  } else {
    $('i18n_labelUrl').textContent = t('labelUrl');
    $('i18n_hintUrl').textContent = t('hintUrl');
    $('i18n_labelKey').textContent = t('labelKey');
    $('i18n_hintKey').textContent = t('hintKey');
    $('i18n_labelHash').textContent = t('labelHash');
    $('i18n_hintHash').textContent = t('hintHash');
    $('apiUrl').placeholder = t('placeholderUrl');
    $('apiKey').placeholder = t('placeholderKey');
    $('apiHash').placeholder = t('placeholderHash');
  }

  clearFieldInvalidState('apiUrl');
  clearFieldInvalidState('apiKey');
}

// Render server list
function renderServerList() {
  const listEl = $('serverList');
  if (servers.length === 0) {
    listEl.innerHTML = `<div style="text-align:center;color:#999;font-size:12px;padding:24px 0;">${t('emptyServers')}</div>`;
    return;
  }
  
  listEl.innerHTML = servers.map(s => {
    let host = s.apiUrl;
    try {
      const urlObj = new URL(s.apiUrl);
      host = urlObj.hostname;
    } catch (e) {}
    
    const isActive = s.id === editingServerId;
    const isDefault = s.id === defaultServerId;
    const providerMeta = getProviderMeta(s.panel_type);

    return `
      <div class="server-item ${isActive ? 'active' : ''}" data-id="${s.id}">
        <img class="server-logo" src="${providerMeta.logo}" alt="" title="${escapeHtml(providerMeta.name)}">
        <div class="server-info">
          <div class="server-title-container">
            <span class="server-name">${escapeHtml(s.name)}</span>
            ${isDefault ? `<span class="badge-default">${t('badgeDefault')}</span>` : ''}
          </div>
          <span class="server-host">${escapeHtml(host)} · ${escapeHtml(providerMeta.name)}</span>
        </div>
        <div class="server-actions">
          <button class="btn-icon copy" data-id="${s.id}" title="${t('copyTitle')}">${lucideIcon('copy', 14)}</button>
          <button class="btn-icon star ${isDefault ? 'active' : ''}" data-id="${s.id}" title="${t('tagDefault')}">${lucideIcon('star', 14, isDefault)}</button>
          <button class="btn-icon del" data-id="${s.id}" title="${t('deleteTitle')}">${lucideIcon('trash', 14)}</button>
        </div>
      </div>
    `;
  }).join('');
  
  // Bind select event
  document.querySelectorAll('.server-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('del') || e.target.classList.contains('star') || e.target.classList.contains('copy')) return;
      selectServer(el.dataset.id);
    });
  });
  
  // Bind delete event
  document.querySelectorAll('.btn-icon.del').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      deleteServer(el.dataset.id);
    });
  });

  // Bind set-default event
  document.querySelectorAll('.btn-icon.star').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const serverId = el.dataset.id;
      const newDefaultId = defaultServerId === serverId ? null : serverId;
      
      chrome.storage.local.set({ defaultServerId: newDefaultId }, () => {
        defaultServerId = newDefaultId;
        renderServerList();
      });
    });
  });

  // Bind copy event
  document.querySelectorAll('.btn-icon.copy').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      copyServer(el.dataset.id);
    });
  });
}

// Select server for editing
function selectServer(id) {
  editingServerId = id;
  const s = servers.find(item => item.id === id);
  if (s) {
    clearFieldErrors();
    $('formTitle').textContent = t('formTitleEdit', { name: s.name });
    $('serverName').value = s.name;
    $('apiUrl').value = s.apiUrl;
    $('apiKey').value = s.apiKey;
    $('apiHash').value = s.apiHash;
    // Reset sensitive fields to hidden when switching servers
    $('apiKey').type = 'password';
    $('apiHash').type = 'password';
    document.querySelectorAll('.toggle-vis').forEach(b => b.innerHTML = lucideIcon('eye', 15));
    // Load panel_type with fallback to 'solusvm'
    $('panelType').value = s.panel_type || 'solusvm';
    updatePanelHelp();
    $('serverTags').value = normalizeTagList(s.tags).join(', ');
    $('expiryDate').value = s.expiryDate || '';
    $('expiryDisabled').checked = !!s.expiryDisabled;
    const apiNote = $('expiryApiNote');
    if (apiNote) apiNote.style.display = (s.expirySource === 'api') ? 'flex' : 'none';
    syncAdvancedPanel(s);
    
    document.querySelectorAll('.server-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });
    hideMsg();
  }
}

// Switch to add-new form
function showNewForm() {
  editingServerId = null;
  clearFieldErrors();
  $('formTitle').textContent = t('formTitleAdd');
  $('serverName').value = '';
  $('apiUrl').value = '';
  $('apiKey').value = '';
  $('apiHash').value = '';
  $('apiKey').type = 'password';
  $('apiHash').type = 'password';
  document.querySelectorAll('.toggle-vis').forEach(b => b.innerHTML = lucideIcon('eye', 15));
  $('panelType').value = 'solusvm';
  updatePanelHelp();
  $('serverTags').value = '';
  $('expiryDate').value = '';
  $('expiryDisabled').checked = false;
  const apiNote = $('expiryApiNote');
  if (apiNote) apiNote.style.display = 'none';
  syncAdvancedPanel(null);
  
  document.querySelectorAll('.server-item').forEach(el => {
    el.classList.remove('active');
  });
  hideMsg();
}

// Normalize all servers — ensure every node has panel_type (backward-compat)
// normalizeServers is defined in shared.js

// Load configuration and migrate from legacy versions
function loadConfig() {
  try {
    chrome.storage.local.get(null, data => {
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message;
        if (errMsg.includes('context invalidated')) {
          console.warn('Extension context invalidated, reloading...');
          location.reload();
          return;
        }
        console.error(chrome.runtime.lastError);
      }
      data = data || {};
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
        chrome.storage.local.set({
          servers: list,
          currentServerId: oldServer.id,
          tags: []
        }, () => {
          chrome.storage.local.remove(['apiUrl', 'apiKey', 'apiHash']);
        });
      }
      
      const normalized = normalizeServers(list);
      if (JSON.stringify(data.servers) !== JSON.stringify(normalized)) {
        chrome.storage.local.set({ servers: normalized });
      }

      // Initialize tags
      allTags = getAllTagsFromServers(normalized);
      const storedTags = data.tags || [];
      if (JSON.stringify(storedTags) !== JSON.stringify(allTags)) {
        chrome.storage.local.set({ tags: allTags });
      }

      // Initialize language
      if (data.lang) {
        window.currentLang = data.lang;
      } else {
        window.currentLang = 'en';
      }
      darkModeEnabled = Boolean(data.darkModeEnabled);
      applyTheme();
      $('languageSelect').value = window.currentLang;

      // Reminder preferences
      const remindersEnabled = data.remindersEnabled !== false;
      $('remindersEnabled').checked = remindersEnabled;
      const thresholds = (Array.isArray(data.expiryThresholds) && data.expiryThresholds.length)
        ? data.expiryThresholds.map(Number).filter(n => n > 0)
        : DEFAULT_EXPIRY_THRESHOLDS.slice();
      document.querySelectorAll('.threshold-cb').forEach(cb => {
        cb.checked = thresholds.indexOf(Number(cb.value)) !== -1;
      });

      // Analytics opt-out switch: analytics_opt_out === true means analytics disabled.
      const analyticsOn = data.analytics_opt_out !== true;
      $('analyticsEnabled').checked = analyticsOn;

      servers = normalized;
      defaultServerId = data.defaultServerId || null;
      
      applyTranslations();

      // Onboarding deep-link: if the user picked a provider from the popup's
      // "Get Started" screen, open the Add Server form preselected to it.
      const pendingPanel = data.pendingPanelType;
      // Accept every supported provider, not just the ones that have a setup guide.
      if (pendingPanel && PROVIDER_META[pendingPanel]) {
        chrome.storage.local.remove(['pendingPanelType']);
        showNewForm();
        $('panelType').value = pendingPanel;
        updatePanelHelp();
        // Entered the configuration state for the provider the user picked
        // from the popup onboarding screen. Kept separate from
        // onboarding_provider_picked so "picked but never configured" is measurable.
        if (typeof Analytics !== 'undefined') Analytics.configurationStarted(pendingPanel).catch(() => {});
        return;
      }

      const activeId = data.currentServerId || (servers[0] ? servers[0].id : null);
      if (activeId) {
        selectServer(activeId);
      } else {
        showNewForm();
      }
    });
  } catch (e) {
    if (e.message.includes('context invalidated')) {
      console.warn('Extension context invalidated, reloading...');
      location.reload();
      return;
    }
    console.error('loadConfig error:', e);
  }
}

// Save configuration
function saveServer() {
  const form = collectServerForm({ updateInputs: true });
  if (!form) return;
  
  const rawExpiry = $('expiryDate').value.trim();
  // Decide expiry provenance: a manual edit always wins; an untouched API
  // value keeps its 'api' source so the background keeps syncing from the API.
  let expirySource;
  const prev = servers.find(item => item.id === editingServerId);
  if (prev && prev.expirySource === 'api' && (prev.expiryDate || '') === rawExpiry) {
    expirySource = 'api';
  } else if (rawExpiry) {
    expirySource = 'manual';
  } else {
    expirySource = 'none';
  }

  const config = {
    name: form.name,
    apiUrl: form.apiUrl,
    apiKey: form.apiKey,
    apiHash: form.apiHash,
    panel_type: form.panelType,
    tags: normalizeTagList($('serverTags').value),
    expiryDate: rawExpiry,
    expirySource,
    expiryDisabled: $('expiryDisabled').checked
  };
  
  try {
    chrome.storage.local.get('currentServerId', data => {
    if (chrome.runtime.lastError) console.error(chrome.runtime.lastError);
    data = data || {};
    let currentId = data.currentServerId;
    const isEditing = !!editingServerId;
      
    if (isEditing) {
      servers = servers.map(s => {
        if (s.id === editingServerId) {
          return { ...s, ...config };
        }
        return s;
      });
    } else {
      const newId = 'server_' + Date.now();
      const newServer = { id: newId, ...config };
      servers.push(newServer);
      editingServerId = newId;
      currentId = newId;
    }
      
    persistServers(servers, currentId, () => {
      renderServerList();
      selectServer(editingServerId);
      if (typeof Analytics !== 'undefined') {
        const _isNew = !isEditing;
        Analytics.serverSaved(form.panelType, _isNew).catch(() => {});
        // configuration_completed: only when a brand-new server is persisted,
        // so later edits aren't double-counted as "finished configuring".
        if (_isNew) Analytics.configurationCompleted(form.panelType).catch(() => {});
      }
      showMsg(t(isEditing ? 'msgSaved' : 'msgAdded'), true);
    });
    });
  } catch (e) {
    console.error('saveServer error:', e);
    if (typeof Analytics !== 'undefined') Analytics.serverSaveFailed(form.panelType, e).catch(() => {});
    showMsg(t('saveError', { error: e.message }), false);
  }
}

// Delete server
function deleteServer(id) {
  const s = servers.find(item => item.id === id);
  if (!s) return;
  if (!confirm(t('confirmDelete', { name: s.name }))) return;
  
  servers = servers.filter(item => item.id !== id);
  
  try {
    chrome.storage.local.get('currentServerId', data => {
      if (chrome.runtime.lastError) console.error(chrome.runtime.lastError);
      data = data || {};
      let currentId = data.currentServerId;
      if (currentId === id) {
        currentId = servers[0] ? servers[0].id : null;
      }
      
      chrome.storage.local.remove('cache_' + id, () => {
        chrome.storage.local.set({
          servers,
          currentServerId: currentId
        }, () => {
          renderServerList();
          if (servers.length > 0) {
            editingServerId = currentId || servers[0].id;
            selectServer(editingServerId);
          } else {
            showNewForm();
          }
          showMsg(t('msgDeleted'), true);
        });
      });
    });
  } catch (e) {
    console.error('deleteServer error:', e);
  }
}

// Copy (duplicate) server config
function copyServer(id) {
  const s = servers.find(item => item.id === id);
  if (!s) return;

  const newId = 'server_' + Date.now();
  const newServer = {
    ...s,
    id: newId,
    name: s.name + t('copiedSuffix')
  };

  servers.push(newServer);

  try {
    chrome.storage.local.get('currentServerId', data => {
      if (chrome.runtime.lastError) console.error(chrome.runtime.lastError);
      data = data || {};
      let currentId = data.currentServerId;
      persistServers(servers, currentId, () => {
        renderServerList();
        editingServerId = newId;
        selectServer(newId);
        showMsg(t('msgCopied', { name: newServer.name }), true);
      });
    });
  } catch (e) {
    console.error('copyServer error:', e);
  }
}

// Test API connection
function testConnection() {
  const form = collectServerForm({ updateInputs: true });
  if (!form) return;
  
  showMsg(t('msgTesting'), true);
  
  const tempConfig = {
    apiUrl: form.apiUrl,
    apiKey: form.apiKey,
    apiHash: form.apiHash,
    panel_type: form.panelType
  };

  // Anonymous usage analytics: count test-connection attempts per provider type.
  // Only provider type is sent; never credentials, URL, or server identity.
  if (typeof Analytics !== 'undefined') Analytics.connectionTestStarted(form.panelType).catch(() => {});

  try {
    chrome.runtime.sendMessage({ action: 'testConnection', config: tempConfig }, resp => {
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message;
        if (errMsg.includes('context invalidated')) {
          console.warn('Extension context invalidated, reloading...');
          location.reload();
          return;
        }
        showMsg(t('msgTestFail', { error: errMsg }), false);
        return;
      }
      if (resp && resp.success) {
        if (typeof Analytics !== 'undefined') Analytics.connectionTestSucceeded(form.panelType).catch(() => {});
        showMsg(t('msgTestOk'), true);
      } else {
        const errMsg = resp ? resp.error : t('apiTimeout');
        if (typeof Analytics !== 'undefined') Analytics.connectionTestFailed(form.panelType, errMsg).catch(() => {});
        showMsg(t('msgTestFail', { error: errMsg }), false);
      }
    });
  } catch (e) {
    if (e.message.includes('context invalidated')) {
      console.warn('Extension context invalidated, reloading...');
      location.reload();
      return;
    }
    showMsg(t('msgTestFail', { error: e.message }), false);
  }
}

function getExportFileName() {
  const date = new Date().toISOString().slice(0, 10);
  return `vps-dashboard-config-${date}.json`;
}

function exportConfig() {
  const keys = [
    'servers',
    'currentServerId',
    'defaultServerId',
    'tags',
    'lang',
    'darkModeEnabled',
    'privacyModeEnabled',
    'expiryWarnDays'
  ];

  chrome.storage.local.get(keys, data => {
    if (chrome.runtime.lastError) {
      showMsg(t('msgExportFail', { error: chrome.runtime.lastError.message }), false);
      return;
    }

    const payload = {
      app: 'VPS Dashboard',
      schemaVersion: CONFIG_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      extensionVersion: chrome.runtime.getManifest().version,
      config: {
        servers: normalizeServers(data.servers || []),
        currentServerId: data.currentServerId || null,
        defaultServerId: data.defaultServerId || null,
        tags: Array.isArray(data.tags) ? data.tags : [],
        lang: data.lang || window.currentLang || 'en',
        darkModeEnabled: Boolean(data.darkModeEnabled),
        privacyModeEnabled: Boolean(data.privacyModeEnabled),
        expiryWarnDays: Number(data.expiryWarnDays) || DEFAULT_EXPIRY_WARN_DAYS
      },
      warning: 'This file contains API credentials. Keep it private.'
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = getExportFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (typeof Analytics !== 'undefined') Analytics.exportConfig().catch(() => {});
    showMsg(t('msgExportOk'), true);
  });
}

function enrichServerForICS(s) {
  const meta = getProviderMeta(s.panel_type);
  return {
    id: s.id,
    name: s.name,
    providerName: meta ? meta.name : '',
    url: s.apiUrl,
    expiryDate: s.expiryDate,
    expirySource: s.expirySource
  };
}

function exportAllICS() {
  chrome.storage.local.get(['servers', 'expiryThresholds'], data => {
    if (chrome.runtime.lastError) {
      showMsg(t('msgExportFail', { error: chrome.runtime.lastError.message }), false);
      return;
    }
    const servers = normalizeServers(data.servers || []);
    const thresholds = (Array.isArray(data.expiryThresholds) && data.expiryThresholds.length)
      ? data.expiryThresholds
      : DEFAULT_EXPIRY_THRESHOLDS.slice();
    const withExpiry = servers.filter(s => s.expiryDate);
    if (withExpiry.length === 0) {
      showMsg(t('msgNoExpiry'), true);
      return;
    }
    const ics = buildICS(withExpiry.map(enrichServerForICS), { thresholds });
    const date = new Date().toISOString().slice(0, 10);
    downloadICS(`vps-dashboard-expiry-${date}.ics`, ics);
    if (typeof Analytics !== 'undefined') Analytics.exportIcs('all').catch(() => {});
    showMsg(t('msgExportIcsOk', { count: withExpiry.length }), true);
  });
}

function normalizeImportedConfig(raw) {
  const config = raw && raw.config ? raw.config : raw;
  if (!config || typeof config !== 'object') {
    throw new Error(t('msgImportInvalid'));
  }

  const importedServers = normalizeServers(config.servers || []);
  if (!Array.isArray(config.servers) || importedServers.length === 0) {
    throw new Error(t('msgImportNoServers'));
  }

  const serverIds = new Set(importedServers.map(server => server.id));
  const currentServerId = serverIds.has(config.currentServerId)
    ? config.currentServerId
    : importedServers[0].id;
  const nextDefaultServerId = serverIds.has(config.defaultServerId)
    ? config.defaultServerId
    : null;
  const nextTags = getAllTagsFromServers(importedServers);

  return {
    servers: importedServers,
    currentServerId,
    defaultServerId: nextDefaultServerId,
    tags: nextTags,
    privacyModeEnabled: Boolean(config.privacyModeEnabled),
    expiryWarnDays: Number(config.expiryWarnDays) || DEFAULT_EXPIRY_WARN_DAYS
  };
}

function removeCacheKeys(callback) {
  chrome.storage.local.get(null, data => {
    const cacheKeys = Object.keys(data || {}).filter(key => key.startsWith('cache_'));
    if (cacheKeys.length === 0) {
      callback();
      return;
    }
    chrome.storage.local.remove(cacheKeys, callback);
  });
}

function importConfigFile(file) {
  if (!file) return;

  // Anonymous usage analytics: a config import was initiated.
  // Only a count is sent; never the file contents or any credentials.
  if (typeof Analytics !== 'undefined') Analytics.configImportStarted().catch(() => {});

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const nextConfig = normalizeImportedConfig(parsed);
      if (!confirm(t('confirmImportConfig', { count: nextConfig.servers.length }))) {
        return;
      }

      removeCacheKeys(() => {
        chrome.storage.local.set(nextConfig, () => {
          if (chrome.runtime.lastError) {
            showMsg(t('msgImportFail', { error: chrome.runtime.lastError.message }), false);
            return;
          }
          servers = nextConfig.servers;
          defaultServerId = nextConfig.defaultServerId;
          editingServerId = nextConfig.currentServerId;
          allTags = nextConfig.tags;
          if (typeof Analytics !== 'undefined') Analytics.configImportSucceeded(nextConfig.servers.length).catch(() => {});
          // Refresh threshold checkboxes from storage (global prefs are not part of config export)
          chrome.storage.local.get(['expiryThresholds'], stored => {
            const thresholds = (Array.isArray(stored.expiryThresholds) && stored.expiryThresholds.length)
              ? stored.expiryThresholds.map(Number).filter(n => n > 0)
              : DEFAULT_EXPIRY_THRESHOLDS.slice();
            document.querySelectorAll('.threshold-cb').forEach(cb => {
              cb.checked = thresholds.indexOf(Number(cb.value)) !== -1;
            });
          });
          applyTranslations();
          selectServer(nextConfig.currentServerId);
          showMsg(t('msgImportOk', { count: nextConfig.servers.length }), true);
        });
      });
    } catch (e) {
      if (typeof Analytics !== 'undefined') Analytics.configImportFailed(e).catch(() => {});
      showMsg(t('msgImportFail', { error: e.message }), false);
    } finally {
      $('importConfigFile').value = '';
    }
  };
  reader.onerror = () => {
    showMsg(t('msgImportFail', { error: reader.error ? reader.error.message : 'Unable to read file' }), false);
    $('importConfigFile').value = '';
  };
  reader.readAsText(file);
}

// Bind DOM events
$('addBtn').addEventListener('click', () => {
  showNewForm();
  // User explicitly started configuring a new server (defaults to SolusVM v1).
  if (typeof Analytics !== 'undefined') Analytics.configurationStarted('solusvm').catch(() => {});
});
$('saveBtn').addEventListener('click', saveServer);
$('testBtn').addEventListener('click', testConnection);
$('panelType').addEventListener('change', () => {
  updatePanelHelp();
  hideMsg();
});
$('providerCards').addEventListener('click', e => {
  const card = e.target.closest('.provider-card');
  if (!card) return;
  $('panelType').value = card.dataset.panelType;
  updatePanelHelp();
  hideMsg();
});
$('apiUrl').addEventListener('blur', () => {
  const panelType = $('panelType').value;
  const cleanedUrl = normalizeProviderEndpoint(panelType, $('apiUrl').value);
  if (cleanedUrl) $('apiUrl').value = cleanedUrl;
});
['apiUrl', 'apiKey', 'apiHash', 'serverName'].forEach(inputId => {
  $(inputId).addEventListener('input', () => clearFieldInvalidState(inputId));
});
$('themeToggle').addEventListener('click', () => setDarkMode(!darkModeEnabled, true));
$('exportConfigBtn').addEventListener('click', exportConfig);
$('importConfigBtn').addEventListener('click', () => $('importConfigFile').click());
$('importConfigFile').addEventListener('change', e => importConfigFile(e.target.files[0]));
$('languageSelect').addEventListener('change', e => {
  const selectedLang = e.target.value;
  chrome.storage.local.set({ lang: selectedLang }, () => {
    window.currentLang = selectedLang;
    applyTranslations();
    applyTheme();
    showMsg(window.t('msgSaved'), true);
  });
});

// Persist master reminder switch
$('remindersEnabled').addEventListener('change', e => {
  chrome.storage.local.set({ remindersEnabled: !!e.target.checked });
  if (e.target.checked && typeof Analytics !== 'undefined') Analytics.expiryReminderEnabled().catch(() => {});
});

// Persist analytics opt-out switch (checked = analytics on; unchecked = disabled)
$('analyticsEnabled').addEventListener('change', e => {
  const willEnable = e.target.checked;
  const msg = willEnable ? t('confirmAnalyticsOn') : t('confirmAnalyticsOff');
  if (!confirm(msg)) {
    // 用户取消，恢复开关状态
    e.target.checked = !willEnable;
    return;
  }
  chrome.storage.local.set({ analytics_opt_out: !willEnable });
});

// Persist multi-threshold reminder windows
document.querySelectorAll('.threshold-cb').forEach(cb => {
  cb.addEventListener('change', () => {
    const selected = Array.from(document.querySelectorAll('.threshold-cb'))
      .filter(c => c.checked)
      .map(c => Number(c.value))
      .sort((a, b) => a - b);
    chrome.storage.local.set({ expiryThresholds: selected });
  });
});

// Send a test notification (verifies the permission + UX)
$('testReminderBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'testReminder' }, resp => {
    if (chrome.runtime.lastError) {
      showMsg(t('msgTestReminderFail', { error: chrome.runtime.lastError.message }), false);
      return;
    }
    if (resp && resp.success) showMsg(t('msgTestReminderOk'), true);
    else showMsg(t('msgTestReminderFail', { error: (resp && resp.error) || t('apiTimeout') }), false);
  });
});

// Export all servers' expiry dates as a calendar (.ics)
$('exportIcsBtn').addEventListener('click', exportAllICS);

// Toggle password visibility for sensitive fields
document.addEventListener('click', e => {
  const btn = e.target.closest('.toggle-vis');
  if (!btn) return;
  const targetId = btn.dataset.target;
  const input = document.getElementById(targetId);
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  btn.innerHTML = lucideIcon(isPassword ? 'eyeOff' : 'eye', 15);
});

// Load configuration on startup
loadConfig();
