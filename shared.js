/**
 * Shared utilities — used by popup.js, options.js, and background.js
 * Keep this file in sync across all three environments.
 */

function normalizeTagList(value) {
  const rawTags = Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,，]+/);

  const seen = new Set();
  return rawTags
    .map(tag => String(tag).trim())
    .filter(Boolean)
    .filter(tag => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeServers(list) {
  return (Array.isArray(list) ? list : []).map(server => ({
    id: server.id || 'server_' + Math.random().toString(36).substr(2, 9),
    name: server.name || 'Default Server',
    apiUrl: (server.apiUrl || '').trim(),
    apiKey: (server.apiKey || '').trim(),
    apiHash: (server.apiHash || '').trim(),
    panel_type: server.panel_type || 'solusvm',
    tags: normalizeTagList(server.tags),
    expiryDate: (server.expiryDate || '').trim(),
    // Expiry provenance: 'api' = pulled from provider API, 'manual' = user-entered,
    // 'none' = not set. When 'manual', the background must never overwrite from API.
    expirySource: server.expirySource === 'api' || server.expirySource === 'manual'
      ? server.expirySource
      : (server.expiryDate ? 'manual' : 'none'),
    // Per-server opt-out of the background reminder notifications.
    expiryDisabled: Boolean(server.expiryDisabled)
  }));
}

// Default lead time (in days) before expiry at which a warning is shown.
const DEFAULT_EXPIRY_WARN_DAYS = 7;

// Default multi-threshold reminder windows (days before expiry).
const DEFAULT_EXPIRY_THRESHOLDS = [3, 7, 30];

// Compute days remaining until a server expires.
// Accepts an ISO date string (YYYY-MM-DD) or any Date-parseable string.
// Returns { date, daysLeft } or null when no valid date is set.
function computeExpiry(expiryDate) {
  if (!expiryDate || typeof expiryDate !== 'string') return null;
  const exp = new Date(expiryDate + (expiryDate.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(exp.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((exp.getTime() - today.getTime()) / 86400000);
  return { date: expiryDate, daysLeft: diffDays };
}

// Map days remaining to an urgency level given a warning threshold.
// Levels: 'expired' (< 0), 'urgent' (<= warnDays), 'soon' (<= warnDays*2), 'ok'.
function expiryLevel(daysLeft, warnDays) {
  const w = Number(warnDays) > 0 ? Number(warnDays) : DEFAULT_EXPIRY_WARN_DAYS;
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= w) return 'urgent';
  if (daysLeft <= w * 2) return 'soon';
  return 'ok';
}

// Tolerant extraction of an expiry date from a provider API response.
// Many panels expose a billing/expiry field under various names; this scans
// object keys (case-insensitive) for known patterns and tries to parse the
// value as a date. Returns an ISO 'YYYY-MM-DD' string or null.
const EXPIRY_KEY_RE = /(next_?due_?date|due_?date|next_?invoice|invoice_?due|expir(y|es)_?at|expiry_?date|renew_?at|next_?renew|paid_?until|billing_?cycle_?end|valid_?until|end_?date|termination_?date|suspend_?date|expire_?at)/i;

function isoDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

function parseFlexibleDate(value) {
  if (value === null || value === undefined || value === '') return null;
  // Unix timestamp (seconds or milliseconds)
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : (value > 1e9 ? value * 1000 : 0);
    if (!ms) return null;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return isoDateOnly(d);
  }
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  // Reject implausible years to avoid false positives (e.g. random numbers).
  if (year < 2000 || year > 2100) return null;
  return isoDateOnly(d);
}

function extractApiExpiry(obj, _depth) {
  if (!obj || typeof obj !== 'object') return null;
  const depth = _depth || 0;
  if (depth > 4) return null;
  // 1) Scan own keys for known date field names
  const keys = Object.keys(obj);
  for (const key of keys) {
    if (EXPIRY_KEY_RE.test(key)) {
      const found = parseFlexibleDate(obj[key]);
      if (found) return found;
    }
  }
  // 2) Recurse one level deeper into nested objects/arrays
  for (const key of keys) {
    const val = obj[key];
    if (val && typeof val === 'object') {
      const found = extractApiExpiry(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function getAllTagsFromServers(list) {
  const seen = new Map();
  list.forEach(server => {
    normalizeTagList(server.tags).forEach(tag => {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    });
  });
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

// Provider display metadata (name + bundled logo) keyed by panel_type
const PROVIDER_META = {
  solusvm:      { name: 'SolusVM v1',    logo: 'logos/solusvm.svg' },
  solusvm2:     { name: 'SolusVM v2',    logo: 'logos/solusvm2.svg' },
  ec2:          { name: 'AWS EC2',       logo: 'logos/ec2.svg' },
  lightsail:    { name: 'AWS Lightsail', logo: 'logos/lightsail.svg' },
  virtfusion:   { name: 'VirtFusion',    logo: 'logos/virtfusion.svg' },
  virtualizor:   { name: 'Virtualizor',   logo: 'logos/default.svg' },
  proxmox:      { name: 'Proxmox VE',    logo: 'logos/proxmox.svg' },
  hetzner:      { name: 'Hetzner',       logo: 'logos/hetzner.svg' },
  digitalocean: { name: 'DigitalOcean',  logo: 'logos/digitalocean.svg' }
};
const PROVIDER_META_DEFAULT = { name: 'VPS', logo: 'logos/default.svg' };
const PROVIDER_ORDER = [
  'solusvm',
  'solusvm2',
  'virtfusion',
  'virtualizor',
  'proxmox',
  'hetzner',
  'digitalocean',
  'lightsail',
  'ec2'
];
const PROVIDER_HASH_OPTIONAL = ['solusvm2', 'virtfusion', 'proxmox', 'hetzner', 'digitalocean'];
const PROVIDER_AWS_REGIONS = ['lightsail', 'ec2'];
const PROVIDER_DEFAULT_API_URLS = {
  hetzner: 'https://api.hetzner.cloud/v1',
  digitalocean: 'https://api.digitalocean.com/v2'
};

function getProviderMeta(panelType) {
  return PROVIDER_META[panelType] || PROVIDER_META_DEFAULT;
}

function providerNeedsApiHash(panelType) {
  return PROVIDER_HASH_OPTIONAL.indexOf(panelType) === -1;
}

function providerUsesAwsRegion(panelType) {
  return PROVIDER_AWS_REGIONS.indexOf(panelType) !== -1;
}

function getProviderDefaultApiUrl(panelType) {
  return PROVIDER_DEFAULT_API_URLS[panelType] || '';
}

function normalizeAwsRegionSetting(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/^https?:\/\//i, '');
  const regionMatch = cleaned.match(/([a-z]{2}-[a-z]+-\d+)/i);
  const instanceMatch = cleaned.match(/(i-[0-9a-fA-F]+)/);
  const region = (regionMatch ? regionMatch[1] : cleaned.split('/')[0].split('?')[0]).toLowerCase();
  return instanceMatch ? `${region}/${instanceMatch[1]}` : region;
}

function normalizeProviderEndpoint(panelType, rawValue) {
  let value = String(rawValue || '').trim();
  const defaultUrl = getProviderDefaultApiUrl(panelType);
  if (!value && defaultUrl) return defaultUrl;

  if (panelType === 'hetzner' && /^\d+$/.test(value)) {
    return `${PROVIDER_DEFAULT_API_URLS.hetzner}/servers/${value}`;
  }
  if (panelType === 'digitalocean' && /^\d+$/.test(value)) {
    return `${PROVIDER_DEFAULT_API_URLS.digitalocean}/droplets/${value}`;
  }
  if (providerUsesAwsRegion(panelType)) {
    return normalizeAwsRegionSetting(value);
  }
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  value = value.replace(/\/$/, '');

  if (panelType === 'solusvm') {
    value = value.replace(/\/api$/i, '');
    if (!/\/api\/client\/command\.php$/i.test(value)) {
      value = `${value}/api/client/command.php`;
    }
  } else if (panelType === 'solusvm2' || panelType === 'virtfusion') {
    if (!/\/api\/v\d+(\/|$)/i.test(value)) {
      value = /\/servers(\/|$)/i.test(value)
        ? value.replace(/\/servers/i, '/api/v1/servers')
        : `${value}/api/v1`;
    }
  } else if (panelType === 'virtualizor') {
    if (!/\/index\.php$/i.test(value)) {
      value = `${value}/index.php`;
    }
  } else if (panelType === 'proxmox') {
    if (!/\/api2\/json(\/|$)/i.test(value)) {
      value = /\/nodes(\/|$)/i.test(value)
        ? value.replace(/\/nodes/i, '/api2/json/nodes')
        : `${value}/api2/json`;
    }
  } else if (panelType === 'hetzner') {
    if (!/\/v1(\/|$)/i.test(value)) {
      value = /\/servers(\/|$)/i.test(value)
        ? value.replace(/\/servers/i, '/v1/servers')
        : `${value}/v1`;
    }
  } else if (panelType === 'digitalocean') {
    if (!/\/v2(\/|$)/i.test(value)) {
      value = /\/droplets(\/|$)/i.test(value)
        ? value.replace(/\/droplets/i, '/v2/droplets')
        : `${value}/v2`;
    }
  }

  return value;
}

function isValidProviderEndpoint(panelType, value) {
  if (!value) return false;
  if (providerUsesAwsRegion(panelType)) {
    return /^[a-z]{2}-[a-z]+-\d(\/i-[0-9a-f]+)?$/i.test(value);
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

// Lucide icons (lucide.dev) — unified: 24x24 viewBox, stroke 2, round caps, currentColor
const LUCIDE = {
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  reboot: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  power: '<path d="M12 2v10"/><path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
};

function lucideIcon(name, size, filled) {
  const fill = filled ? 'currentColor' : 'none';
  return `<svg class="lucide" width="${size || 16}" height="${size || 16}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LUCIDE[name] || ''}</svg>`;
}
