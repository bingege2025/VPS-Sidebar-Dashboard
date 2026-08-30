/**
 * Background Service Worker
 * Handles all SolusVM API calls
 */

// normalizeTagList, normalizeServers, getAllTagsFromServers, extractApiExpiry → shared.js
importScripts('shared.js');
// computeReminders (pure reminder engine) → expiry-reminder.js
importScripts('expiry-reminder.js');
// Anonymous GA4 Measurement Protocol analytics → analytics.js
importScripts('analytics.js');

// Check and migrate legacy data structures
function checkAndMigrateConfig(callback) {
  chrome.storage.local.get(['apiUrl', 'apiKey', 'apiHash', 'servers', 'tags'], data => {
    let list = data.servers || [];
    if (list.length === 0 && data.apiUrl && data.apiKey && data.apiHash) {
      const defaultServer = {
        id: 'server_' + Date.now(),
        name: 'Default Server',
        apiUrl: data.apiUrl,
        apiKey: data.apiKey,
        apiHash: data.apiHash,
        panel_type: 'solusvm',
        tags: []
      };
      chrome.storage.local.set({
        servers: [defaultServer],
        tags: [],
        currentServerId: defaultServer.id
      }, () => {
        chrome.storage.local.remove(['apiUrl', 'apiKey', 'apiHash'], () => {
          if (callback) callback();
        });
      });
    } else {
      const normalizedServers = normalizeServers(list);
      const normalizedTags = getAllTagsFromServers(normalizedServers);
      const serversChanged = JSON.stringify(data.servers) !== JSON.stringify(normalizedServers);
      const tagsChanged = JSON.stringify(data.tags || []) !== JSON.stringify(normalizedTags);
      if (serversChanged || tagsChanged) {
        chrome.storage.local.set({
          servers: normalizedServers,
          tags: normalizedTags
        }, () => {
          if (callback) callback();
        });
      } else if (callback) {
        callback();
      }
    }
  });
}

// Get the currently active server configuration (using native Promise for safe await)
function getActiveServerConfig() {
  return new Promise((resolve, reject) => {
    checkAndMigrateConfig(() => {
      chrome.storage.local.get(['servers', 'currentServerId'], data => {
        if (!data.servers || data.servers.length === 0) {
          reject(new Error('Please configure API settings first'));
          return;
        }
        const activeServer = data.servers.find(s => s.id === data.currentServerId) || data.servers[0];
        if (!activeServer) {
          reject(new Error('Selected server configuration is incomplete'));
        } else {
          resolve(activeServer);
        }
      });
    });
  });
}

function getPanelType(config) {
  return (config && config.panel_type) || 'solusvm';
}

function requireSolusVM1Config(config) {
  if (!config || !config.apiUrl || !config.apiKey || !config.apiHash) {
    throw new Error('Selected SolusVM v1 configuration is incomplete, please reconfigure in settings');
  }
}

function requireSolusVM2Config(config) {
  if (!config || !config.apiUrl || !config.apiKey) {
    throw new Error('Selected SolusVM 2 configuration is incomplete. API URL and API token are required');
  }
}

function normalizeSolusVM1Url(config) {
  let url = config.apiUrl.trim();
  url = url.replace(/\/$/, '');
  if (!url.includes('/api/client/command.php')) {
    url = url.replace(/\/api$/, '');
    url = url + '/api/client/command.php';
  }
  return url;
}

// SolusVM v1 API call wrapper
async function callSolusVM1(command, extraParams = {}, configOverride) {
  const config = configOverride || await getActiveServerConfig();
  requireSolusVM1Config(config);

  const url = normalizeSolusVM1Url(config);

  const params = new URLSearchParams();
  params.append('key', config.apiKey);
  params.append('hash', config.apiHash);
  params.append('action', command);
  for (const [key, value] of Object.entries(extraParams)) {
    params.append(key, value);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  }).catch(err => {
    console.error(`[ERROR] fetch failed for ${command}:`, err.message, 'URL:', url);
    throw err;
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  const text = await response.text();
  const result = parseApiResponse(text);
  if (result.status && result.status !== 'success') {
    throw new Error(result.statusmsg || 'Operation failed');
  }
  return result;
}

function normalizeSolusVM2BaseUrl(config) {
  let url = config.apiUrl.trim().replace(/\/$/, '');
  url = url.replace(/\/api\/v\d+\/?$/, '');
  return url;
}

function normalizeSolusVM2ConfiguredUrl(config) {
  const raw = config.apiUrl.trim().replace(/\/$/, '');
  if (/\/api\/v\d+\//.test(raw)) return raw;
  return normalizeSolusVM2BaseUrl(config) + '/api/v1';
}

function getSolusVM2Headers(config) {
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };
  return headers;
}

async function fetchSolusVM2Json(url, config, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: getSolusVM2Headers(config),
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`SolusVM 2 API returned non-JSON response from ${url}`);
    }
  }

  if (!response.ok) {
    const msg = data.message || data.error || data.detail || response.statusText || 'Request failed';
    throw new Error(`SolusVM 2 API request failed: ${response.status} ${msg}`);
  }

  return data;
}

function firstArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const candidates = [
    value.data,
    value.items,
    value.results,
    value.servers,
    value.virtual_servers,
    value.virtualServers
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function pickFirstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function bytesResource(used, total) {
  if (used === undefined && total === undefined) return undefined;
  const usedVal = Number(used || 0);
  const totalVal = Number(total || 0);
  const percent = totalVal > 0 ? Math.round((usedVal / totalVal) * 100) : 0;
  return `${usedVal},${totalVal},${totalVal},${percent}`;
}

function normalizeSolusVM2Server(raw = {}) {
  const server = raw.data && !Array.isArray(raw.data) ? raw.data : raw;
  const status = String(pickFirstDefined(
    server.status,
    server.state,
    server.power_state,
    server.powerState,
    server.vm_state,
    server.vmState,
    server.compute_resource_status
  ) || '').toLowerCase();

  const ips = pickFirstDefined(server.ip_addresses, server.ipAddresses, server.ips, server.ip);
  const firstIp = Array.isArray(ips)
    ? pickFirstDefined(ips[0] && (ips[0].ip || ips[0].address), ips[0])
    : ips;

  const memory = pickFirstDefined(server.memory, server.ram, server.mem, server.resources && server.resources.memory);
  const disk = pickFirstDefined(server.disk, server.hdd, server.resources && server.resources.disk);
  const bandwidth = pickFirstDefined(server.bandwidth, server.traffic, server.bw, server.resources && server.resources.bandwidth);

  return {
    id: pickFirstDefined(server.id, server.uuid, server.server_id, server.virtual_server_id),
    hostname: pickFirstDefined(server.hostname, server.name, server.fqdn, server.domain),
    status: status || 'unknown',
    statusmsg: status || 'unknown',
    vmstate: status || 'unknown',
    ipaddress: firstIp,
    ip: firstIp,
    os: pickFirstDefined(server.os, server.operating_system, server.template && server.template.name, server.image && server.image.name),
    template: pickFirstDefined(server.template_name, server.template && server.template.name, server.image && server.image.name),
    mem: typeof memory === 'object'
      ? bytesResource(pickFirstDefined(memory.used, memory.usage, memory.consumed), pickFirstDefined(memory.total, memory.limit, memory.size))
      : bytesResource(undefined, memory),
    hdd: typeof disk === 'object'
      ? bytesResource(pickFirstDefined(disk.used, disk.usage, disk.consumed), pickFirstDefined(disk.total, disk.limit, disk.size))
      : bytesResource(undefined, disk),
    bw: typeof bandwidth === 'object'
      ? bytesResource(pickFirstDefined(bandwidth.used, bandwidth.usage, bandwidth.consumed), pickFirstDefined(bandwidth.total, bandwidth.limit, bandwidth.size))
      : bytesResource(undefined, bandwidth),
    // Best-effort billing-date extraction — used only when the user lets the
    // extension pull expiry from the API (expirySource !== 'manual').
    apiExpiry: extractApiExpiry(server)
  };
}

async function getSolusVM2Server(config) {
  requireSolusVM2Config(config);
  const configuredUrl = normalizeSolusVM2ConfiguredUrl(config);

  if (/\/api\/v\d+\/.+\/[^/]+$/.test(configuredUrl) && !/\/api\/v\d+$/.test(configuredUrl)) {
    return normalizeSolusVM2Server(await fetchSolusVM2Json(configuredUrl, config));
  }

  const baseUrl = normalizeSolusVM2BaseUrl(config);
  const listEndpoints = [
    '/api/v1/servers'
  ];

  let lastError;
  for (const path of listEndpoints) {
    const url = baseUrl + path;
    try {
      const data = await fetchSolusVM2Json(url, config);
      const servers = firstArray(data);
      if (servers.length === 1) {
        return normalizeSolusVM2Server(servers[0]);
      }
      if (servers.length > 1) {
        throw new Error('Multiple SolusVM 2 servers found. Please use a full API URL for one virtual server instead of the account-level API URL.');
      }
      lastError = new Error(`No servers found from ${url}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('Unable to discover SolusVM 2 server endpoint');
}

async function callSolusVM2Action(action, configOverride) {
  const config = configOverride || await getActiveServerConfig();
  requireSolusVM2Config(config);
  const configuredUrl = normalizeSolusVM2ConfiguredUrl(config);

  if (!/\/api\/v\d+\/.+\/[^/]+$/.test(configuredUrl) || /\/api\/v\d+$/.test(configuredUrl)) {
    throw new Error('SolusVM 2 power actions require a full virtual server API URL, for example https://panel.example.com/api/v1/servers/123');
  }

  const actionPaths = {
    reboot: ['restart'],
    boot: ['start'],
    shutdown: ['stop']
  }[action] || [];

  let lastError;
  for (const actionPath of actionPaths) {
    try {
      return await fetchSolusVM2Json(`${configuredUrl}/${actionPath}`, config, { method: 'POST' });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error(`Unsupported SolusVM 2 action: ${action}`);
}

// ─── VirtFusion API ──────────────────────────────────────────────
// VirtFusion: REST API with Bearer token auth at /api/v1

function requireVirtFusionConfig(config) {
  if (!config || !config.apiUrl || !config.apiKey) {
    throw new Error('VirtFusion configuration is incomplete. API URL and API token are required');
  }
}

function normalizeVirtFusionBaseUrl(config) {
  let url = config.apiUrl.trim().replace(/\/$/, '');
  url = url.replace(/\/api\/v\d+\/?$/, '');
  return url;
}

function normalizeVirtFusionConfiguredUrl(config) {
  const raw = config.apiUrl.trim().replace(/\/$/, '');
  if (/\/api\/v\d+\//.test(raw)) return raw;
  return normalizeVirtFusionBaseUrl(config) + '/api/v1';
}

function getVirtFusionHeaders(config) {
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };
}

async function fetchVirtFusion(url, config, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: getVirtFusionHeaders(config),
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`VirtFusion API returned non-JSON response from ${url}`);
    }
  }

  if (!response.ok) {
    const msg = data.message || data.error || response.statusText || 'Request failed';
    throw new Error(`VirtFusion API request failed: ${response.status} ${msg}`);
  }

  return data;
}

function normalizeVirtFusionServer(server = {}) {
  const status = String(pickFirstDefined(
    server.state,
    server.status,
    server.power_state
  ) || '').toLowerCase();

  const ips = pickFirstDefined(
    server.ipAddresses, server.ip_addresses,
    (server.network && server.network.ipv4 && server.network.ipv4.address)
  );
  const firstIp = Array.isArray(ips)
    ? pickFirstDefined(ips[0] && (ips[0].ip || ips[0].address), ips[0])
    : ips;

  const memory = pickFirstDefined(server.memory, server.ram);
  const disk = pickFirstDefined(server.disk, server.hdd, server.storage);
  const bandwidth = pickFirstDefined(server.bandwidth, server.traffic);

  // Map VirtFusion statuses to SolusVM-compatible statuses
  const statusMap = {
    'online': 'online',
    'running': 'online',
    'offline': 'offline',
    'stopped': 'offline',
    'suspended': 'suspended',
    'complete': 'online',
    'building': 'building',
    'installing': 'building',
    'unknown': 'unknown'
  };
  const mappedStatus = statusMap[status] || status;

  return {
    id: pickFirstDefined(server.id, server.uuid),
    hostname: pickFirstDefined(server.hostname, server.name, server.fqdn),
    status: mappedStatus,
    statusmsg: status || 'unknown',
    vmstate: status || 'unknown',
    ipaddress: firstIp,
    ip: firstIp,
    os: pickFirstDefined(server.os, server.template),
    template: pickFirstDefined(server.template),
    mem: typeof memory === 'object'
      ? bytesResource(pickFirstDefined(memory.used, memory.usage), pickFirstDefined(memory.total, memory.limit))
      : bytesResource(undefined, memory),
    hdd: typeof disk === 'object'
      ? bytesResource(pickFirstDefined(disk.used, disk.usage), pickFirstDefined(disk.total, disk.limit))
      : bytesResource(undefined, disk),
    bw: typeof bandwidth === 'object'
      ? bytesResource(pickFirstDefined(bandwidth.used, bandwidth.usage), pickFirstDefined(bandwidth.total, bandwidth.limit))
      : bytesResource(undefined, bandwidth),
    // Best-effort billing-date extraction (see note in normalizeSolusVM2Server).
    apiExpiry: extractApiExpiry(server)
  };
}

async function getVirtFusionServerList(config) {
  requireVirtFusionConfig(config);
  const url = normalizeVirtFusionBaseUrl(config) + '/api/v1/servers?type=full';
  let response;
  try {
    response = await fetchVirtFusion(url, config);
  } catch (e) {
    // Fallback: try without type=full
    response = await fetchVirtFusion(normalizeVirtFusionBaseUrl(config) + '/api/v1/servers', config);
  }

  const servers = firstArray(response.data || response);
  if (servers.length === 0) {
    throw new Error('No servers found from VirtFusion API');
  }
  return servers.map(s => normalizeVirtFusionServer(s));
}

async function getVirtFusionSingle(config) {
  requireVirtFusionConfig(config);
  const configuredUrl = normalizeVirtFusionConfiguredUrl(config);

  // If URL points to a specific server (e.g. /api/v1/servers/69)
  if (/\/api\/v\d+\/servers\/\d+/.test(configuredUrl)) {
    const url = configuredUrl + '?remoteState=true';
    const response = await fetchVirtFusion(url, config);
    const server = (response.data || response);
    return normalizeVirtFusionServer(server);
  }

  // Otherwise get server list
  const servers = await getVirtFusionServerList(config);
  if (servers.length === 1) return servers[0];
  throw new Error('Multiple VirtFusion servers found. Please use a full server API URL (e.g. https://panel.example.com/api/v1/servers/123)');
}

async function callVirtFusionAction(action, configOverride) {
  const config = configOverride || await getActiveServerConfig();
  requireVirtFusionConfig(config);
  const configuredUrl = normalizeVirtFusionConfiguredUrl(config);

  if (!/\/api\/v\d+\/servers\/\d+/.test(configuredUrl)) {
    throw new Error('VirtFusion power actions require a full server API URL, for example https://panel.example.com/api/v1/servers/123');
  }

  const actionPaths = {
    reboot: 'restart',
    boot: 'boot',
    shutdown: 'shutdown'
  }[action];

  if (!actionPaths) {
    throw new Error(`Unsupported VirtFusion action: ${action}`);
  }

  return await fetchVirtFusion(`${configuredUrl}/power/${actionPaths}`, config, { method: 'POST' });
}

// ─── Virtualizor API ───────────────────────────────────────────
// Virtualizor enduser: GET with query params, api=json&apikey=...&apipass=...

function requireVirtualizorConfig(config) {
  if (!config || !config.apiUrl || !config.apiKey || !config.apiHash) {
    throw new Error('Virtualizor configuration is incomplete. API URL, API Key, and API Password are required');
  }
}

function normalizeVirtualizorBaseUrl(config) {
  let url = config.apiUrl.trim().replace(/\/$/, '');
  if (!url.includes('/index.php')) {
    url = url + '/index.php';
  }
  return url;
}

async function fetchVirtualizor(config, params) {
  const baseUrl = normalizeVirtualizorBaseUrl(config);
  const query = new URLSearchParams({
    api: 'json',
    apikey: config.apiKey,
    apipass: config.apiHash,
    ...params
  });
  const url = baseUrl + '?' + query.toString();

  const response = await fetch(url);
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch (e) {
      throw new Error(`Virtualizor API returned non-JSON: ${text.substring(0, 200)}`);
    }
  }
  if (!response.ok) {
    const msg = data.error || data.message || `HTTP ${response.status}`;
    throw new Error(`Virtualizor API error: ${msg}`);
  }
  // Virtualizor returns error in JSON body even with 200
  if (data.error) {
    const msgs = Array.isArray(data.error) ? data.error.join(', ') : data.error;
    throw new Error(`Virtualizor error: ${msgs}`);
  }
  return data;
}

function normalizeVirtualizorServer(raw) {
  // raw comes from listvs response: vps array items
  const statusMap = { '1': 'online', '0': 'offline', '2': 'suspended' };
  const status = statusMap[raw.status] || 'unknown';

  return {
    id: raw.vpsid,
    hostname: raw.hostname || raw.vps_name,
    status: status,
    statusmsg: status === 'online' ? 'running' : (status === 'offline' ? 'stopped' : status),
    vmstate: status,
    ipaddress: (raw.ips || '').split(',')[0].trim(),
    ip: (raw.ips || '').split(',')[0].trim(),
    os: raw.os_name || raw.os_distro,
    template: raw.os_name || raw.os_distro,
    // Virtualizor units: ram = MB, disk_space = GB, bandwidth(b_used) = GB
    mem: bytesResource(undefined, Number(raw.ram || 0) * 1024 * 1024),
    hdd: bytesResource(undefined, Number(raw.disk_space || 0) * 1024 * 1024 * 1024),
    bw: bytesResource(Number(raw.bandwidth_used || 0) * 1024 * 1024 * 1024, Number(raw.bandwidth || 0) * 1024 * 1024 * 1024)
  };
}

async function getVirtualizorSingle(config) {
  requireVirtualizorConfig(config);
  const data = await fetchVirtualizor(config, { act: 'listvs' });

  let vpsList = [];
  if (Array.isArray(data.vps)) {
    vpsList = data.vps;
  } else if (data.vps && typeof data.vps === 'object') {
    vpsList = Object.values(data.vps);
  }

  // Also check single vps response
  const singleVps = data.vs;
  if (singleVps && !Array.isArray(singleVps)) {
    // Merge vs_info into the vps object
    const info = data.vs_info || {};
    return normalizeVirtualizorServer({ ...singleVps, ...info });
  }

  if (vpsList.length === 0) {
    throw new Error('No VPS found in Virtualizor account');
  }
  if (vpsList.length > 1) {
    throw new Error('Multiple VPS found. Currently only single-VPS accounts are supported.');
  }
  return normalizeVirtualizorServer(vpsList[0]);
}

async function callVirtualizorAction(action, configOverride) {
  const config = configOverride || await getActiveServerConfig();
  requireVirtualizorConfig(config);

  const actionMap = {
    'reboot': 'restart',
    'boot': 'start',
    'shutdown': 'stop'
  };
  const act = actionMap[action];
  if (!act) throw new Error(`Unsupported Virtualizor action: ${action}`);

  // Get VPS ID first
  const listData = await fetchVirtualizor(config, { act: 'listvs' });
  let vpsList = [];
  if (Array.isArray(listData.vps)) {
    vpsList = listData.vps;
  } else if (listData.vps && typeof listData.vps === 'object') {
    vpsList = Object.values(listData.vps);
  }

  let vpsId;
  if (vpsList.length > 0) {
    vpsId = vpsList[0].vpsid;
  } else if (listData.vs && listData.vs.vpsid) {
    vpsId = listData.vs.vpsid;
  } else {
    throw new Error('No VPS found for action');
  }

  return await fetchVirtualizor(config, { act, svs: String(vpsId), do: '1' });
}

// ─── Proxmox VE API ────────────────────────────────────────────
// Proxmox: REST API with API token auth, lists VMs via nodes/{node}/qemu

function requireProxmoxConfig(config) {
  if (!config || !config.apiUrl || !config.apiKey) {
    throw new Error('Proxmox configuration is incomplete. API URL and API Token are required');
  }
}

function normalizeProxmoxBaseUrl(config) {
  let url = config.apiUrl.trim().replace(/\/$/, '');
  if (!url.includes('/api2/json')) {
    url = url + '/api2/json';
  }
  return url;
}

async function fetchProxmox(url, config, options = {}) {
  const headers = {
    'Accept': 'application/json',
    'Authorization': `PVEAPIToken=${config.apiKey}`
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch (e) {
      throw new Error(`Proxmox API returned non-JSON: ${text.substring(0, 200)}`);
    }
  }
  if (!response.ok) {
    const msg = (data.errors && data.errors.message) || data.message || `HTTP ${response.status}`;
    throw new Error(`Proxmox API error: ${msg}`);
  }
  return data;
}

async function getProxmoxNodes(config) {
  const baseUrl = normalizeProxmoxBaseUrl(config);
  const data = await fetchProxmox(baseUrl + '/nodes', config);
  return (data.data || []).map(n => n.node);
}

function normalizeProxmoxServer(raw) {
  const statusMap = {
    'running': 'online',
    'stopped': 'offline',
    'paused': 'paused'
  };
  const status = statusMap[raw.status] || raw.status || 'unknown';

  // Memory in bytes → MB
  const maxmem = raw.maxmem ? Math.round(raw.maxmem / 1048576) : 0;
  // Disk in bytes → MB
  const maxdisk = raw.maxdisk ? Math.round(raw.maxdisk / 1048576) : 0;

  return {
    id: String(raw.vmid),
    hostname: raw.name,
    status: status,
    statusmsg: raw.status || 'unknown',
    vmstate: raw.qmpstatus || raw.status || 'unknown',
    ipaddress: raw.ip || '',
    ip: raw.ip || '',
    os: raw.os || '',
    template: raw.template || '',
    mem: bytesResource(undefined, maxmem),
    hdd: bytesResource(undefined, maxdisk),
    bw: bytesResource(undefined, 0)
  };
}

async function getProxmoxSingle(config) {
  requireProxmoxConfig(config);
  const baseUrl = normalizeProxmoxBaseUrl(config);

  // Check if URL already points to a specific VM
  const vmMatch = baseUrl.match(/\/nodes\/([^/]+)\/(?:qemu|lxc)\/(\d+)\/status\/current/);
  if (vmMatch) {
    const data = await fetchProxmox(baseUrl, config);
    return normalizeProxmoxServer(data.data || {});
  }

  // Auto-discover: list nodes → list VMs
  const nodes = await getProxmoxNodes(config);
  if (nodes.length === 0) throw new Error('No Proxmox nodes found');

  let allVms = [];
  for (const node of nodes) {
    const qemuData = await fetchProxmox(baseUrl + `/nodes/${node}/qemu`, config);
    allVms.push(...(qemuData.data || []).map(v => ({ ...v, _node: node })));
    const lxcData = await fetchProxmox(baseUrl + `/nodes/${node}/lxc`, config);
    allVms.push(...(lxcData.data || []).map(v => ({ ...v, _node: node })));
  }

  if (allVms.length === 0) throw new Error('No VMs/containers found on Proxmox');
  if (allVms.length > 1) throw new Error('Multiple VMs found. Currently only single-VM setups are supported.');

  const vm = allVms[0];
  // Get detailed status
  const vmType = vm.type || 'qemu'; // lxc or qemu
  const statusData = await fetchProxmox(baseUrl + `/nodes/${vm._node}/${vmType}/${vm.vmid}/status/current`, config);
  return normalizeProxmoxServer(statusData.data || vm);
}

async function callProxmoxAction(action, configOverride) {
  const config = configOverride || await getActiveServerConfig();
  requireProxmoxConfig(config);
  const baseUrl = normalizeProxmoxBaseUrl(config);

  const actionMap = {
    'reboot': 'reboot',
    'boot': 'start',
    'shutdown': 'stop'
  };
  const pmAction = actionMap[action];
  if (!pmAction) throw new Error(`Unsupported Proxmox action: ${action}`);

  // Discover VM ID
  const nodes = await getProxmoxNodes(config);
  for (const node of nodes) {
    const qemuData = await fetchProxmox(baseUrl + `/nodes/${node}/qemu`, config);
    const lxcData = await fetchProxmox(baseUrl + `/nodes/${node}/lxc`, config);
    const allVms = [...(qemuData.data || []), ...(lxcData.data || [])];
    if (allVms.length > 0) {
      const vm = allVms[0];
      const vmType = vm.type || 'qemu';
      return await fetchProxmox(baseUrl + `/nodes/${node}/${vmType}/${vm.vmid}/status/${pmAction}`, config, { method: 'POST' });
    }
  }
  throw new Error('No VMs found for action');
}

// ─── Hetzner Cloud API ─────────────────────────────────────────
// Hetzner Cloud: REST API, Bearer token, list /servers

function requireHetznerConfig(config) {
  if (!config || !config.apiUrl || !config.apiKey) {
    throw new Error('Hetzner Cloud configuration is incomplete. API URL and API Token are required');
  }
}

function normalizeHetznerBaseUrl(config) {
  let url = config.apiUrl.trim().replace(/\/$/, '');
  if (!url.includes('/v1')) url = url + '/v1';
  return url;
}

async function fetchHetzner(url, config, options = {}) {
  const headers = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch (e) {
      throw new Error(`Hetzner API returned non-JSON: ${text.substring(0, 200)}`);
    }
  }
  if (!response.ok) {
    const msg = (data.error && data.error.message) || data.message || `HTTP ${response.status}`;
    throw new Error(`Hetzner API error: ${msg}`);
  }
  return data;
}

function normalizeHetznerServer(raw) {
  const statusMap = { 'running': 'online', 'off': 'offline', 'starting': 'pending', 'stopping': 'pending' };
  const status = statusMap[raw.status] || raw.status || 'unknown';
  const publicNet = raw.public_net || {};
  const ipv4 = publicNet.ipv4 || {};
  const serverType = raw.server_type || {};
  const image = raw.image || {};
  const memory = serverType.memory || 0; // GB
  const disk = serverType.disk || 0; // GB
  // Hetzner server detail exposes month-to-date traffic in bytes
  const trafficBytes = (raw.outgoing_traffic || 0) + (raw.ingoing_traffic || 0);

  return {
    id: String(raw.id),
    hostname: raw.name,
    status,
    statusmsg: raw.status || 'unknown',
    vmstate: raw.status || 'unknown',
    ipaddress: ipv4.ip || '',
    ip: ipv4.ip || '',
    os: image.name || image.os_flavor || '',
    template: image.name || '',
    // All values in bytes — popup formatSize() expects bytes
    mem: bytesResource(undefined, memory * 1024 * 1024 * 1024),
    hdd: bytesResource(undefined, disk * 1024 * 1024 * 1024),
    // Hetzner has no bandwidth quota; show month-to-date traffic as a single value
    bw: bytesResource(undefined, trafficBytes)
  };
}

async function getHetznerSingle(config) {
  requireHetznerConfig(config);
  const baseUrl = normalizeHetznerBaseUrl(config);

  // Direct URL for single server
  const idMatch = baseUrl.match(/\/servers\/(\d+)/);
  if (idMatch) {
    const data = await fetchHetzner(baseUrl, config);
    return normalizeHetznerServer(data.server || {});
  }

  const data = await fetchHetzner(baseUrl + '/servers', config);
  const servers = data.servers || [];
  if (servers.length === 0) throw new Error('No Hetzner Cloud servers found');
  if (servers.length > 1) throw new Error('Multiple Hetzner servers found. Currently only single-server setups are supported.');
  return normalizeHetznerServer(servers[0]);
}

async function callHetznerAction(action, configOverride) {
  const config = configOverride || await getActiveServerConfig();
  requireHetznerConfig(config);
  const baseUrl = normalizeHetznerBaseUrl(config);

  const actionMap = {
    'reboot': 'reboot',
    'boot': 'poweron',
    'shutdown': 'shutdown'
  };
  const hAction = actionMap[action];
  if (!hAction) throw new Error(`Unsupported Hetzner action: ${action}`);

  const listData = await fetchHetzner(baseUrl + '/servers', config);
  const servers = listData.servers || [];
  if (servers.length === 0) throw new Error('No Hetzner servers found');

  const serverId = servers[0].id;
  return await fetchHetzner(baseUrl + `/servers/${serverId}/actions/${hAction}`, config, { method: 'POST' });
}

// ─── DigitalOcean API ──────────────────────────────────────────
// DigitalOcean: REST API, Bearer token, list /droplets

function requireDOConfig(config) {
  if (!config || !config.apiUrl || !config.apiKey) {
    throw new Error('DigitalOcean configuration is incomplete. API URL and API Token are required');
  }
}

function normalizeDOBaseUrl(config) {
  let url = config.apiUrl.trim().replace(/\/$/, '');
  if (!url.includes('/v2')) url = url + '/v2';
  return url;
}

async function fetchDO(url, config, options = {}) {
  const headers = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch (e) {
      throw new Error(`DigitalOcean API returned non-JSON: ${text.substring(0, 200)}`);
    }
  }
  if (!response.ok) {
    const msg = data.message || `HTTP ${response.status}`;
    throw new Error(`DigitalOcean API error: ${msg}`);
  }
  return data;
}

function normalizeDOServer(raw) {
  const statusMap = { 'active': 'online', 'off': 'offline', 'new': 'pending', 'archive': 'offline' };
  const status = statusMap[raw.status] || raw.status || 'unknown';
  const networks = raw.networks || {};
  const v4 = networks.v4 || [];
  const publicV4 = v4.find(n => n.type === 'public') || v4[0] || {};
  const image = raw.image || {};
  const memory = raw.memory || 0; // MB
  const disk = raw.disk || 0; // GB

  return {
    id: String(raw.id),
    hostname: raw.name,
    status,
    statusmsg: raw.status || 'unknown',
    vmstate: raw.status || 'unknown',
    ipaddress: publicV4.ip_address || '',
    ip: publicV4.ip_address || '',
    os: image.distribution || image.name || '',
    template: image.name || image.distribution || '',
    mem: bytesResource(undefined, memory),
    hdd: bytesResource(undefined, disk * 1024),
    bw: bytesResource(undefined, 0)
  };
}

async function getDOSingle(config) {
  requireDOConfig(config);
  const baseUrl = normalizeDOBaseUrl(config);

  const idMatch = baseUrl.match(/\/droplets\/(\d+)/);
  if (idMatch) {
    const data = await fetchDO(baseUrl, config);
    return normalizeDOServer(data.droplet || {});
  }

  const data = await fetchDO(baseUrl + '/droplets', config);
  const droplets = data.droplets || [];
  if (droplets.length === 0) throw new Error('No DigitalOcean droplets found');
  if (droplets.length > 1) throw new Error('Multiple droplets found. Currently only single-droplet setups are supported.');
  return normalizeDOServer(droplets[0]);
}

async function callDOAction(action, configOverride) {
  const config = configOverride || await getActiveServerConfig();
  requireDOConfig(config);
  const baseUrl = normalizeDOBaseUrl(config);

  const actionMap = {
    'reboot': 'reboot',
    'boot': 'power_on',
    'shutdown': 'shutdown'
  };
  const doAction = actionMap[action];
  if (!doAction) throw new Error(`Unsupported DigitalOcean action: ${action}`);

  const listData = await fetchDO(baseUrl + '/droplets', config);
  const droplets = listData.droplets || [];
  if (droplets.length === 0) throw new Error('No droplets found');

  return await fetchDO(baseUrl + `/droplets/${droplets[0].id}/actions`, config, {
    method: 'POST',
    body: { type: doAction }
  });
}

// ─── AWS Lightsail API ──────────────────────────────────────────
// AWS Lightsail: JSON-RPC over HTTPS with AWS Signature V4 auth

// --- AWS SigV4 signing utilities (Web Crypto API) ---

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSign(key, data) {
  const enc = new TextEncoder();
  const keyData = typeof key === 'string' ? enc.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
}

async function hmacHex(key, data) {
  const sig = await hmacSign(key, data);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = await hmacSign('AWS4' + key, dateStamp);
  const kRegion = await hmacSign(kDate, regionName);
  const kService = await hmacSign(kRegion, serviceName);
  return hmacSign(kService, 'aws4_request');
}

async function signAWSRequest(accessKeyId, secretAccessKey, region, target, body) {
  const service = 'lightsail';
  const host = `${service}.${region}.amazonaws.com`;
  const contentType = 'application/x-amz-json-1.1';
  const amzTarget = `Lightsail_20161128.${target}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = '/';
  const canonicalQuerystring = '';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:${amzTarget}\n`;
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target';

  const payloadHash = await sha256(body);

  const canonicalRequest = `POST\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${await sha256(canonicalRequest)}`;

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    endpoint: `https://${host}/`,
    headers: {
      'Content-Type': contentType,
      'X-Amz-Date': amzDate,
      'X-Amz-Target': amzTarget,
      'Authorization': authorizationHeader
    }
  };
}

// --- Lightsail config & fetch ---

function requireLightsailConfig(config) {
  if (!config || !config.apiUrl || !config.apiKey || !config.apiHash) {
    throw new Error('AWS Lightsail configuration is incomplete. Region, Access Key ID, and Secret Access Key are required');
  }
}

function normalizeLightsailServer(raw) {
  const state = (raw.state && raw.state.name) || 'unknown';
  const statusMap = {
    'running': 'online',
    'pending': 'pending',
    'stopped': 'offline',
    'stopping': 'offline',
    'rebooting': 'online'
  };
  const mappedStatus = statusMap[state] || state;

  const hardware = raw.hardware || {};
  const disks = hardware.disks || [];
  const diskSizeGb = disks.length > 0 ? (disks[0].sizeInGb || 0) : 0;
  // Lightsail monthly transfer quota (GB) from networking.monthlyTransfer
  const networking = raw.networking || {};
  const bwQuotaGb = (networking.monthlyTransfer && networking.monthlyTransfer.gbAllowed) || 0;

  return {
    id: raw.name || raw.arn,
    hostname: raw.name,
    status: mappedStatus,
    statusmsg: state,
    vmstate: state,
    ipaddress: raw.publicIpAddress,
    ip: raw.publicIpAddress,
    os: raw.blueprintName,
    template: raw.blueprintName,
    // All values in bytes — popup formatSize() expects bytes
    mem: bytesResource(undefined, (hardware.ramSizeInGb || 0) * 1024 * 1024 * 1024),
    hdd: bytesResource(undefined, diskSizeGb * 1024 * 1024 * 1024),
    // Lightsail bandwidth quota (GB) — usage not provided by GetInstance, so shown as a single value
    bw: bytesResource(undefined, bwQuotaGb * 1024 * 1024 * 1024)
  };
}

function parseAWSRegion(raw) {
  let cleaned = (raw || '').trim();
  cleaned = cleaned.replace(/^https?:\/\//i, '');
  const regionMatch = cleaned.match(/([a-z]{2}-[a-z]+-\d+)/i);
  if (regionMatch) {
    return regionMatch[1].toLowerCase();
  }
  return cleaned.split('/')[0].split('?')[0].toLowerCase() || 'us-east-1';
}

function parseEC2RegionAndInstance(rawUrl) {
  const region = parseAWSRegion(rawUrl);
  let targetInstanceId = null;
  let cleaned = (rawUrl || '').trim().replace(/^https?:\/\//i, '');

  const instMatch = cleaned.match(/(i-[0-9a-fA-Z]+)/);
  if (instMatch) {
    targetInstanceId = instMatch[1];
  }
  return { region, targetInstanceId };
}

async function getLightsailSingle(config) {
  requireLightsailConfig(config);
  const region = parseAWSRegion(config.apiUrl);
  const body = '{}';
  const { endpoint, headers } = await signAWSRequest(config.apiKey, config.apiHash, region, 'GetInstances', body);

  const response = await fetch(endpoint, { method: 'POST', headers, body });
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch (e) {
      throw new Error(`AWS Lightsail API returned non-JSON: ${text.substring(0, 200)}`);
    }
  }
  if (!response.ok) {
    const msg = data.message || data.__type || `HTTP ${response.status}`;
    throw new Error(`AWS Lightsail API error: ${msg}`);
  }

  const instances = data.instances || [];
  if (instances.length === 0) {
    throw new Error('No Lightsail instances found in this region');
  }
  if (instances.length > 1) {
    throw new Error('Multiple Lightsail instances found. Currently only single-instance accounts are supported.');
  }
  return normalizeLightsailServer(instances[0]);
}

async function callLightsailAction(action, configOverride) {
  const config = configOverride || await getActiveServerConfig();
  requireLightsailConfig(config);
  const region = parseAWSRegion(config.apiUrl);

  const actionMap = {
    'reboot': 'RebootInstance',
    'boot': 'StartInstance',
    'shutdown': 'StopInstance'
  };
  const apiAction = actionMap[action];
  if (!apiAction) throw new Error(`Unsupported Lightsail action: ${action}`);

  // Fetch instance name first
  const listBody = '{}';
  const { endpoint: listEp, headers: listHeaders } = await signAWSRequest(config.apiKey, config.apiHash, region, 'GetInstances', listBody);
  const listResp = await fetch(listEp, { method: 'POST', headers: listHeaders, body: listBody });
  const listData = await listResp.json();
  const instances = listData.instances || [];
  if (instances.length === 0) throw new Error('No Lightsail instances found');

  const instanceName = instances[0].name;
  const actionBody = JSON.stringify({ instanceName });

  const { endpoint, headers } = await signAWSRequest(config.apiKey, config.apiHash, region, apiAction, actionBody);
  const response = await fetch(endpoint, { method: 'POST', headers, body: actionBody });
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch (e) {
      throw new Error(`AWS Lightsail ${action} error: ${text.substring(0, 200)}`);
    }
  }
  if (!response.ok) {
    const msg = data.message || data.__type || `HTTP ${response.status}`;
    throw new Error(`AWS Lightsail ${action} error: ${msg}`);
  }
  return data;
}

// ─── AWS EC2 API ──────────────────────────────────────────────
// EC2 uses query-based API with SigV4 over POST

// Generic AWS query-API signer (used by EC2 & CloudWatch). params must include Version.
async function signAWSQueryRequest(accessKeyId, secretAccessKey, region, service, host, params) {
  const contentType = 'application/x-www-form-urlencoded';

  const bodyParams = new URLSearchParams(params);
  bodyParams.sort();
  const body = bodyParams.toString();

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = '/';
  const canonicalQuerystring = '';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';

  const payloadHash = await sha256(body);
  const canonicalRequest = `POST\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${await sha256(canonicalRequest)}`;

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  return {
    endpoint: `https://${host}/`,
    headers: {
      'Content-Type': contentType,
      'X-Amz-Date': amzDate,
      'Authorization': `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    },
    body
  };
}

async function signEC2Request(accessKeyId, secretAccessKey, region, params) {
  return signAWSQueryRequest(
    accessKeyId, secretAccessKey, region,
    'ec2', `ec2.${region}.amazonaws.com`,
    { Version: '2016-11-15', ...params }
  );
}

async function signCloudWatchRequest(accessKeyId, secretAccessKey, region, params) {
  return signAWSQueryRequest(
    accessKeyId, secretAccessKey, region,
    'monitoring', `monitoring.${region}.amazonaws.com`,
    { Version: '2010-08-01', ...params }
  );
}

async function fetchEC2WithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      ...options,
      signal: controller.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out');
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeEC2Endpoint(endpoint) {
  try {
    const probeUrl = `${endpoint}?Action=DescribeRegions&Version=2016-11-15`;
    await fetchEC2WithTimeout(probeUrl, { method: 'GET' }, 5000);
    return true;
  } catch (e) {
    return false;
  }
}

function requireEC2Config(config) {
  if (!config || !config.apiUrl || !config.apiKey || !config.apiHash) {
    throw new Error('AWS EC2 configuration is incomplete. Region, Access Key ID, and Secret Access Key are required');
  }
}

// Throw a readable error when an AWS query API returns a non-2xx XML error document
function throwAWSXmlError(prefix, status, text) {
  const codeMatch = text.match(/<Code>([^<]+)<\/Code>/);
  const msgMatch = text.match(/<Message>([^<]+)<\/Message>/);
  const code = codeMatch ? codeMatch[1] : `HTTP ${status}`;
  const msg = msgMatch ? msgMatch[1] : text.substring(0, 200);
  throw new Error(`${prefix}: ${code} — ${msg}`);
}

// Low-level EC2 query call — returns the raw XML response text
async function ec2ApiRaw(region, accessKeyId, secretAccessKey, params) {
  const req = await signEC2Request(accessKeyId, secretAccessKey, region, params);
  const response = await fetchEC2WithTimeout(req.endpoint, {
    method: 'POST',
    headers: req.headers,
    body: req.body
  }, 10000);
  const text = await response.text();
  if (!response.ok) throwAWSXmlError('AWS EC2 error', response.status, text);
  return text;
}

// Low-level CloudWatch query call — returns the raw XML response text
async function cloudWatchApiRaw(region, accessKeyId, secretAccessKey, params) {
  const req = await signCloudWatchRequest(accessKeyId, secretAccessKey, region, params);
  const response = await fetchEC2WithTimeout(req.endpoint, {
    method: 'POST',
    headers: req.headers,
    body: req.body
  }, 10000);
  const text = await response.text();
  if (!response.ok) throwAWSXmlError('AWS CloudWatch error', response.status, text);
  return text;
}

// Total size (GiB) of all EBS volumes attached to the instance
async function getEC2VolumeSizeGiB(region, accessKeyId, secretAccessKey, instanceId) {
  const text = await ec2ApiRaw(region, accessKeyId, secretAccessKey, {
    Action: 'DescribeVolumes',
    'Filter.1.Name': 'attachment.instance-id',
    'Filter.1.Value.1': instanceId
  });
  let totalGiB = 0;
  const sizeRegex = /<size>(\d+)<\/size>/g;
  let m;
  while ((m = sizeRegex.exec(text)) !== null) {
    totalGiB += parseInt(m[1], 10);
  }
  return totalGiB;
}

// Month-to-date network traffic (NetworkIn + NetworkOut) in bytes via CloudWatch
async function getEC2MonthlyTrafficBytes(region, accessKeyId, secretAccessKey, instanceId) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const baseParams = {
    Action: 'GetMetricStatistics',
    Namespace: 'AWS/EC2',
    'Dimensions.member.1.Name': 'InstanceId',
    'Dimensions.member.1.Value': instanceId,
    StartTime: monthStart.toISOString(),
    EndTime: now.toISOString(),
    Period: '86400',
    'Statistics.member.1': 'Sum'
  };

  const sumMetric = async (metricName) => {
    const text = await cloudWatchApiRaw(region, accessKeyId, secretAccessKey, {
      ...baseParams,
      MetricName: metricName
    });
    let total = 0;
    const sumRegex = /<Sum>([\d.eE+-]+)<\/Sum>/g;
    let m;
    while ((m = sumRegex.exec(text)) !== null) {
      total += parseFloat(m[1]) || 0;
    }
    return total;
  };

  const [inBytes, outBytes] = await Promise.all([
    sumMetric('NetworkIn'),
    sumMetric('NetworkOut')
  ]);
  return inBytes + outBytes;
}

// EC2 instance type → memory in MB (common types)
const EC2_INSTANCE_MEMORY_MB = {
  't2.nano': 512, 't2.micro': 1024, 't2.small': 2048, 't2.medium': 4096, 't2.large': 8192, 't2.xlarge': 16384, 't2.2xlarge': 32768,
  't3.nano': 512, 't3.micro': 1024, 't3.small': 2048, 't3.medium': 4096, 't3.large': 8192, 't3.xlarge': 16384, 't3.2xlarge': 32768,
  't3a.nano': 512, 't3a.micro': 1024, 't3a.small': 2048, 't3a.medium': 4096, 't3a.large': 8192, 't3a.xlarge': 16384, 't3a.2xlarge': 32768,
  't4g.nano': 512, 't4g.micro': 1024, 't4g.small': 2048, 't4g.medium': 4096, 't4g.large': 8192, 't4g.xlarge': 16384, 't4g.2xlarge': 32768,
  'm5.large': 8192, 'm5.xlarge': 16384, 'm5.2xlarge': 32768, 'm5.4xlarge': 65536, 'm5.8xlarge': 131072, 'm5.12xlarge': 196608, 'm5.16xlarge': 262144, 'm5.24xlarge': 393216,
  'm5a.large': 8192, 'm5a.xlarge': 16384, 'm5a.2xlarge': 32768, 'm5a.4xlarge': 65536, 'm5a.8xlarge': 131072, 'm5a.12xlarge': 196608, 'm5a.16xlarge': 262144, 'm5a.24xlarge': 393216,
  'm6g.medium': 4096, 'm6g.large': 8192, 'm6g.xlarge': 16384, 'm6g.2xlarge': 32768, 'm6g.4xlarge': 65536, 'm6g.8xlarge': 131072, 'm6g.12xlarge': 196608, 'm6g.16xlarge': 262144,
  'm6i.large': 8192, 'm6i.xlarge': 16384, 'm6i.2xlarge': 32768, 'm6i.4xlarge': 65536, 'm6i.8xlarge': 131072, 'm6i.12xlarge': 196608, 'm6i.16xlarge': 262144, 'm6i.24xlarge': 393216, 'm6i.32xlarge': 524288,
  'c5.large': 4096, 'c5.xlarge': 8192, 'c5.2xlarge': 16384, 'c5.4xlarge': 32768, 'c5.9xlarge': 73728, 'c5.12xlarge': 98304, 'c5.18xlarge': 147456, 'c5.24xlarge': 196608,
  'c5a.large': 4096, 'c5a.xlarge': 8192, 'c5a.2xlarge': 16384, 'c5a.4xlarge': 32768, 'c5a.8xlarge': 65536, 'c5a.12xlarge': 98304, 'c5a.16xlarge': 131072, 'c5a.24xlarge': 196608,
  'c6g.medium': 2048, 'c6g.large': 4096, 'c6g.xlarge': 8192, 'c6g.2xlarge': 16384, 'c6g.4xlarge': 32768, 'c6g.8xlarge': 65536, 'c6g.12xlarge': 98304, 'c6g.16xlarge': 131072,
  'c6i.large': 4096, 'c6i.xlarge': 8192, 'c6i.2xlarge': 16384, 'c6i.4xlarge': 32768, 'c6i.8xlarge': 65536, 'c6i.12xlarge': 98304, 'c6i.16xlarge': 131072, 'c6i.24xlarge': 196608, 'c6i.32xlarge': 262144,
  'r5.large': 16384, 'r5.xlarge': 32768, 'r5.2xlarge': 65536, 'r5.4xlarge': 131072, 'r5.8xlarge': 262144, 'r5.12xlarge': 393216, 'r5.16xlarge': 524288, 'r5.24xlarge': 786432,
  'r5a.large': 16384, 'r5a.xlarge': 32768, 'r5a.2xlarge': 65536, 'r5a.4xlarge': 131072, 'r5a.8xlarge': 262144, 'r5a.12xlarge': 393216, 'r5a.16xlarge': 524288, 'r5a.24xlarge': 786432,
  'r6g.medium': 8192, 'r6g.large': 16384, 'r6g.xlarge': 32768, 'r6g.2xlarge': 65536, 'r6g.4xlarge': 131072, 'r6g.8xlarge': 262144, 'r6g.12xlarge': 393216, 'r6g.16xlarge': 524288,
  'r6i.large': 16384, 'r6i.xlarge': 32768, 'r6i.2xlarge': 65536, 'r6i.4xlarge': 131072, 'r6i.8xlarge': 262144, 'r6i.12xlarge': 393216, 'r6i.16xlarge': 524288, 'r6i.24xlarge': 786432, 'r6i.32xlarge': 1048576,
  'c7g.medium': 2048, 'c7g.large': 4096, 'c7g.xlarge': 8192, 'c7g.2xlarge': 16384, 'c7g.4xlarge': 32768, 'c7g.8xlarge': 65536, 'c7g.12xlarge': 98304, 'c7g.16xlarge': 131072,
  'm7g.medium': 4096, 'm7g.large': 8192, 'm7g.xlarge': 16384, 'm7g.2xlarge': 32768, 'm7g.4xlarge': 65536, 'm7g.8xlarge': 131072, 'm7g.12xlarge': 196608, 'm7g.16xlarge': 262144,
  'r7g.medium': 8192, 'r7g.large': 16384, 'r7g.xlarge': 32768, 'r7g.2xlarge': 65536, 'r7g.4xlarge': 131072, 'r7g.8xlarge': 262144, 'r7g.12xlarge': 393216, 'r7g.16xlarge': 524288,
  'm7i.large': 8192, 'm7i.xlarge': 16384, 'm7i.2xlarge': 32768, 'm7i.4xlarge': 65536, 'm7i.8xlarge': 131072, 'm7i.12xlarge': 196608, 'm7i.16xlarge': 262144, 'm7i.24xlarge': 393216, 'm7i.48xlarge': 786432,
  'c7i.large': 4096, 'c7i.xlarge': 8192, 'c7i.2xlarge': 16384, 'c7i.4xlarge': 32768, 'c7i.8xlarge': 65536, 'c7i.12xlarge': 98304, 'c7i.16xlarge': 131072, 'c7i.24xlarge': 196608, 'c7i.48xlarge': 393216,
  'r7i.large': 16384, 'r7i.xlarge': 32768, 'r7i.2xlarge': 65536, 'r7i.4xlarge': 131072, 'r7i.8xlarge': 262144, 'r7i.12xlarge': 393216, 'r7i.16xlarge': 524288, 'r7i.24xlarge': 786432, 'r7i.48xlarge': 1572864,
};

function getEC2MemoryMB(instanceType) {
  if (!instanceType) return 0;
  return EC2_INSTANCE_MEMORY_MB[instanceType] || 0;
}

// Parse EBS volume total size from DescribeVolumes XML response

function normalizeEC2Server(raw) {
  const state = (raw.State && raw.State.Name) || 'unknown';
  const statusMap = {
    'running': 'online',
    'pending': 'pending',
    'stopped': 'offline',
    'stopping': 'offline',
    'terminated': 'offline',
    'shutting-down': 'offline'
  };
  const mappedStatus = statusMap[state] || state;

  // Name from Tags
  const tags = raw.Tags || [];
  const nameTag = tags.find(t => t.Key === 'Name');
  const hostname = nameTag ? nameTag.Value : raw.InstanceId;

  const instanceType = raw.InstanceType || '';
  const volumeCount = raw.VolumeCount || 0;
  const memMB = getEC2MemoryMB(instanceType);
  const diskGiB = raw.DiskGiB || 0;
  const trafficBytes = raw.TrafficBytes || 0;

  return {
    id: raw.InstanceId,
    hostname,
    status: mappedStatus,
    statusmsg: state,
    vmstate: state,
    ipaddress: raw.PublicIpAddress || '',
    ip: raw.PublicIpAddress || '',
    os: instanceType + (volumeCount > 0 ? ` · ${volumeCount} vol` : ''),
    template: instanceType + (volumeCount > 0 ? ` · ${volumeCount} vol` : ''),
    // All values in bytes — popup formatSize() expects bytes
    mem: bytesResource(undefined, memMB * 1024 * 1024),
    hdd: bytesResource(undefined, diskGiB * 1024 * 1024 * 1024),
    // EC2 has no bandwidth quota; show month-to-date traffic as a single value
    bw: bytesResource(undefined, trafficBytes)
  };
}

// In-flight EC2 request dedup — avoid concurrent DescribeInstances
const _ec2Inflight = new Map();

async function fetchEC2(region, accessKeyId, secretAccessKey, params) {
  const instanceIdParam = params.InstanceId || params['InstanceId.1'] || '';
  const cacheKey = `${region}|${params.Action || ''}|${instanceIdParam}`;
  if (_ec2Inflight.has(cacheKey)) {
    return await _ec2Inflight.get(cacheKey);
  }

  const promise = (async () => {
    const postRequest = await signEC2Request(accessKeyId, secretAccessKey, region, params);

    let response;
    try {
      response = await fetchEC2WithTimeout(postRequest.endpoint, {
        method: 'POST',
        headers: postRequest.headers,
        body: postRequest.body
      }, 10000);
    } catch (e) {
      const endpointReachable = await probeEC2Endpoint(postRequest.endpoint);
      const hint = endpointReachable
        ? 'Endpoint reachable. Check AWS credentials (Access Key / Secret Key), permissions, or region.'
        : `Endpoint unreachable (${postRequest.endpoint}). Check network, VPN/proxy, or region name (e.g. us-east-1, ap-northeast-2).`;
      throw new Error(`AWS EC2 network error: ${e.message || e}. ${hint}`);
    }
    const text = await response.text();

    if (!response.ok) {
      const codeMatch = text.match(/<Code>([^<]+)<\/Code>/);
      const msgMatch = text.match(/<Message>([^<]+)<\/Message>/);
      const code = codeMatch ? codeMatch[1] : `HTTP ${response.status}`;
      const msg = msgMatch ? msgMatch[1] : text.substring(0, 200);
      throw new Error(`AWS EC2 error: ${code} — ${msg}`);
    }

    const instances = [];
    const instSetRegex = /<instancesSet>([\s\S]*?)<\/instancesSet>/g;
    let instSetMatch;
    while ((instSetMatch = instSetRegex.exec(text)) !== null) {
      const instSetXml = instSetMatch[1];
      // Extract instance <item> blocks with nesting awareness
      // EC2 XML nests <item> inside groupSet/tagSet/blockDeviceMapping
      const instancesXml = [];
      let searchFrom = 0;
      while (true) {
        const openIdx = instSetXml.indexOf('<item>', searchFrom);
        if (openIdx === -1) break;
        // Count nesting depth to find matching </item>
        let depth = 1;
        let scanPos = openIdx + 6; // after <item>
        while (depth > 0) {
          const nextOpen = instSetXml.indexOf('<item>', scanPos);
          const nextClose = instSetXml.indexOf('</item>', scanPos);
          if (nextClose === -1) { scanPos = instSetXml.length; depth = 0; break; }
          if (nextOpen !== -1 && nextOpen < nextClose) { depth++; scanPos = nextOpen + 6; }
          else { depth--; scanPos = nextClose + 7; }
        }
        instancesXml.push(instSetXml.substring(openIdx + 6, scanPos - 7));
        searchFrom = scanPos;
      }
      for (const instXml of instancesXml) {
        const parseTag = (tag) => {
          const m = instXml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
          return m ? m[1] : '';
        };
        const stateMatch = instXml.match(/<name>([^<]+)<\/name>/);
        const tagRegex = /<item>\s*<key>Name<\/key>\s*<value>([^<]+)<\/value>\s*<\/item>/;
        const nameMatch = instXml.match(tagRegex);

        // Count EBS volumes from blockDeviceMapping
        let volumeCount = 0;
        const bdmMatch = instXml.match(/<blockDeviceMapping>([\s\S]*?)<\/blockDeviceMapping>/);
        if (bdmMatch) {
          const ebsMatches = bdmMatch[1].match(/<ebs>/g);
          if (ebsMatches) volumeCount = ebsMatches.length;
        }

        instances.push({
          InstanceId: parseTag('instanceId'),
          State: { Name: stateMatch ? stateMatch[1] : 'unknown' },
          PublicIpAddress: parseTag('ipAddress'),
          InstanceType: parseTag('instanceType'),
          VolumeCount: volumeCount,
          Tags: nameMatch ? [{ Key: 'Name', Value: nameMatch[1] }] : []
        });
      }
    }

    return { Reservations: [{ Instances: instances }] };
  })();

  _ec2Inflight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    _ec2Inflight.delete(cacheKey);
  }
}

async function getEC2Single(config) {
  requireEC2Config(config);
  const { region, targetInstanceId } = parseEC2RegionAndInstance(config.apiUrl);

  const data = await fetchEC2(region, config.apiKey, config.apiHash, { Action: 'DescribeInstances' });
  const reservations = data.Reservations || [];
  const instances = reservations.flatMap(r => r.Instances || []);

  const runningInstances = instances.filter(i => {
    const state = (i.State && i.State.Name) || '';
    return state !== 'terminated';
  });

  if (runningInstances.length === 0) {
    throw new Error('No running EC2 instances found in this region');
  }

  // If user specified an instance ID, find that one
  let instance = null;
  if (targetInstanceId) {
    instance = runningInstances.find(i => i.InstanceId === targetInstanceId);
    if (!instance) {
      throw new Error(`EC2 instance ${targetInstanceId} not found or not running. Available: ${runningInstances.map(i => i.InstanceId).join(', ')}`);
    }
  } else if (runningInstances.length === 1) {
    instance = runningInstances[0];
  } else {
    const ids = runningInstances.map(i => i.InstanceId).join(', ');
    throw new Error(`Multiple EC2 instances found (${runningInstances.length}). Enter the instance ID in the URL: region/instance-id. Available: ${ids}`);
  }

  // Enrich with disk size (DescribeVolumes) and month-to-date traffic (CloudWatch).
  // Both are best-effort: failures (e.g. missing IAM permission) must not break status refresh.
  const [diskGiB, trafficBytes] = await Promise.all([
    getEC2VolumeSizeGiB(region, config.apiKey, config.apiHash, instance.InstanceId)
      .catch(e => { console.warn('[EC2] DescribeVolumes failed (disk hidden). If AccessDenied, attach the `ec2:DescribeVolumes` permission. Error:', e.message || e); return 0; }),
    getEC2MonthlyTrafficBytes(region, config.apiKey, config.apiHash, instance.InstanceId)
      .catch(e => { console.warn('[EC2] CloudWatch traffic failed (bandwidth hidden). If AccessDenied, attach the `cloudwatch:GetMetricStatistics` permission to the IAM key. Error:', e.message || e); return 0; })
  ]);
  instance.DiskGiB = diskGiB;
  instance.TrafficBytes = trafficBytes;

  const server = normalizeEC2Server(instance);
  return server;
}

async function callEC2Action(action, configOverride) {
  const config = configOverride || await getActiveServerConfig();
  requireEC2Config(config);
  const { region, targetInstanceId } = parseEC2RegionAndInstance(config.apiUrl);

  const actionMap = {
    'reboot': 'RebootInstances',
    'boot': 'StartInstances',
    'shutdown': 'StopInstances'
  };
  const apiAction = actionMap[action];
  if (!apiAction) throw new Error(`Unsupported EC2 action: ${action}`);

  // 1. If user specified an instance ID in URL, use it
  let instanceId = targetInstanceId;

  // 2. If config already has server ID starting with i-, reuse directly
  if (!instanceId && config.id && String(config.id).startsWith('i-')) {
    instanceId = config.id;
  }

  // 3. Otherwise discover single running instance
  if (!instanceId) {
    const listData = await fetchEC2(region, config.apiKey, config.apiHash, { Action: 'DescribeInstances' });
    const reservations = listData.Reservations || [];
    const instances = reservations.flatMap(r => r.Instances || []);
    const runningInstances = instances.filter(i => ((i.State && i.State.Name) || '') !== 'terminated');
    if (runningInstances.length === 0) throw new Error('No EC2 instances found');
    if (runningInstances.length > 1) throw new Error('Multiple instances found — specify instance ID in URL: region/instance-id');
    instanceId = runningInstances[0].InstanceId;
  }

  try {
    return await fetchEC2(region, config.apiKey, config.apiHash, {
      Action: apiAction,
      'InstanceId.1': instanceId
    });
  } catch (e) {
    // Friendlier message for state-race errors (instance was mid-transition when clicked)
    const msg = String(e && e.message || '');
    if (msg.includes('IncorrectInstanceState') || msg.includes('IncorrectState')) {
      throw new Error(`Instance is mid-transition — wait a few seconds and refresh. (${msg})`);
    }
    throw e;
  }
}

async function withActivePanel(handlerByPanel) {
  const config = await getActiveServerConfig();
  const panelType = getPanelType(config);
  const handler = handlerByPanel[panelType] || handlerByPanel.solusvm;
  const server = await handler(config);
  // Attach the effective expiry (user-set OR API-pulled) and keep storage in sync.
  if (server && typeof server === 'object') {
    if (!server.apiExpiry) server.apiExpiry = extractApiExpiry(server);
    resolveExpiry(server, config);
    syncApiExpiryToStorage(config, server);
  }
  return server;
}

// Resolve the effective expiry date + source for a server.
// Priority: manual override > API-pulled > manual entry (fallback).
function resolveExpiry(server, config) {
  const manual = config.expiryDate || '';
  const api = server.apiExpiry || '';
  let effDate, source;
  if (config.expirySource === 'manual') {
    effDate = manual;
    source = manual ? 'manual' : 'none';
  } else if (api) {
    effDate = api;
    source = 'api';
  } else {
    effDate = manual;
    source = manual ? 'manual' : 'none';
  }
  const exp = computeExpiry(effDate);
  if (exp) {
    server.expiry = exp;
    server.expiryDate = effDate;
    server.expirySource = source;
  }
  server.expiryDisabled = !!config.expiryDisabled;
  return server;
}

// If the API returned an expiry and the user hasn't manually overridden it,
// persist that date back into storage so the background reminder can use it
// without re-hitting the network every cycle.
function syncApiExpiryToStorage(config, server) {
  if (config.expirySource === 'manual') return;
  if (!server.apiExpiry) return;
  if (server.apiExpiry === (config.expiryDate || '') && config.expirySource === 'api') return;
  const id = config.id;
  chrome.storage.local.get(['servers'], data => {
    const list = Array.isArray(data.servers) ? data.servers : [];
    let changed = false;
    const next = list.map(s => {
      if (s.id === id) {
        changed = true;
        return Object.assign({}, s, { expiryDate: server.apiExpiry, expirySource: 'api' });
      }
      return s;
    });
    if (changed) chrome.storage.local.set({ servers: next });
  });
}

// Parse SolusVM API response, compatible with both XML and key-value formats
function parseApiResponse(text) {
  text = text.trim();
  if (text.startsWith('<')) {
    const result = {};
    // Regex to extract flat XML nodes (e.g., <hostname>vps.test.com</hostname>)
    const regex = /<([^>]+)>([^<]*)<\/\1>/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      result[match[1]] = match[2];
    }
    return result;
  } else {
    const lines = text.split('\n');
    const result = {};
    for (const line of lines) {
      const idx = line.indexOf(',');
      if (idx > 0) {
        const key = line.substring(0, idx).trim();
        const value = line.substring(idx + 1).trim();
        result[key] = value;
      }
    }
    return result;
  }
}

// Get server list
async function listServers() {
  return await withActivePanel({
    solusvm: config => callSolusVM1('list', {}, config),
    solusvm2: config => getSolusVM2Server(config),
    virtfusion: config => getVirtFusionSingle(config),
    virtualizor: config => getVirtualizorSingle(config),
    proxmox: config => getProxmoxSingle(config),
    hetzner: config => getHetznerSingle(config),
    digitalocean: config => getDOSingle(config),
    lightsail: config => getLightsailSingle(config),
    ec2: config => getEC2Single(config)
  });
}

// Get server details
async function getServerInfo() {
  return await withActivePanel({
    solusvm: config => callSolusVM1('info', { status: 'true', bw: 'true', hdd: 'true', mem: 'true', ipaddr: 'true' }, config),
    solusvm2: config => getSolusVM2Server(config),
    virtfusion: config => getVirtFusionSingle(config),
    virtualizor: config => getVirtualizorSingle(config),
    proxmox: config => getProxmoxSingle(config),
    hetzner: config => getHetznerSingle(config),
    digitalocean: config => getDOSingle(config),
    lightsail: config => getLightsailSingle(config),
    ec2: config => getEC2Single(config)
  });
}

// Get server status
async function getServerStatus() {
  return await withActivePanel({
    solusvm: config => callSolusVM1('status', {}, config),
    solusvm2: config => getSolusVM2Server(config),
    virtfusion: config => getVirtFusionSingle(config),
    virtualizor: config => getVirtualizorSingle(config),
    proxmox: config => getProxmoxSingle(config),
    hetzner: config => getHetznerSingle(config),
    digitalocean: config => getDOSingle(config),
    lightsail: config => getLightsailSingle(config),
    ec2: config => getEC2Single(config)
  });
}

// Reboot server
async function rebootServer() {
  return await withActivePanel({
    solusvm: config => callSolusVM1('reboot', {}, config),
    solusvm2: config => callSolusVM2Action('reboot', config),
    virtfusion: config => callVirtFusionAction('reboot', config),
    virtualizor: config => callVirtualizorAction('reboot', config),
    proxmox: config => callProxmoxAction('reboot', config),
    hetzner: config => callHetznerAction('reboot', config),
    digitalocean: config => callDOAction('reboot', config),
    lightsail: config => callLightsailAction('reboot', config),
    ec2: config => callEC2Action('reboot', config)
  });
}

// Boot server
async function bootServer() {
  return await withActivePanel({
    solusvm: config => callSolusVM1('boot', {}, config),
    solusvm2: config => callSolusVM2Action('boot', config),
    virtfusion: config => callVirtFusionAction('boot', config),
    virtualizor: config => callVirtualizorAction('boot', config),
    proxmox: config => callProxmoxAction('boot', config),
    hetzner: config => callHetznerAction('boot', config),
    digitalocean: config => callDOAction('boot', config),
    lightsail: config => callLightsailAction('boot', config),
    ec2: config => callEC2Action('boot', config)
  });
}

// Shutdown server
async function shutdownServer() {
  return await withActivePanel({
    solusvm: config => callSolusVM1('shutdown', {}, config),
    solusvm2: config => callSolusVM2Action('shutdown', config),
    virtfusion: config => callVirtFusionAction('shutdown', config),
    virtualizor: config => callVirtualizorAction('shutdown', config),
    proxmox: config => callProxmoxAction('shutdown', config),
    hetzner: config => callHetznerAction('shutdown', config),
    digitalocean: config => callDOAction('shutdown', config),
    lightsail: config => callLightsailAction('shutdown', config),
    ec2: config => callEC2Action('shutdown', config)
  });
}

// Test the connection status of temporary configuration
async function testConnection(config) {
  const panelType = getPanelType(config);
  const handlers = {
    solusvm: () => {
      requireSolusVM1Config(config);
      return callSolusVM1('info', {}, config);
    },
    solusvm2: () => getSolusVM2Server(config),
    virtfusion: () => getVirtFusionSingle(config),
    virtualizor: () => getVirtualizorSingle(config),
    proxmox: () => getProxmoxSingle(config),
    hetzner: () => getHetznerSingle(config),
    digitalocean: () => getDOSingle(config),
    lightsail: () => getLightsailSingle(config),
    ec2: () => getEC2Single(config)
  };
  const handler = handlers[panelType];
  if (!handler) throw new Error(`Unknown panel type: ${panelType}`);
  return await handler();
}

// ─── Bulk operations ───────────────────────────────────────────

function getAllServerConfigs() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['servers'], data => {
      const list = data.servers || [];
      resolve(list);
    });
  });
}

const PANEL_HANDLERS = {
  solusvm: {
    info: config => callSolusVM1('info', { status: 'true', bw: 'true', hdd: 'true', mem: 'true', ipaddr: 'true' }, config),
    status: config => callSolusVM1('status', {}, config),
    reboot: config => callSolusVM1('reboot', {}, config),
    boot: config => callSolusVM1('boot', {}, config),
    shutdown: config => callSolusVM1('shutdown', {}, config)
  },
  solusvm2: {
    info: config => getSolusVM2Server(config),
    status: config => getSolusVM2Server(config),
    reboot: config => callSolusVM2Action('reboot', config),
    boot: config => callSolusVM2Action('boot', config),
    shutdown: config => callSolusVM2Action('shutdown', config)
  },
  virtfusion: {
    info: config => getVirtFusionSingle(config),
    status: config => getVirtFusionSingle(config),
    reboot: config => callVirtFusionAction('reboot', config),
    boot: config => callVirtFusionAction('boot', config),
    shutdown: config => callVirtFusionAction('shutdown', config)
  },
  virtualizor: {
    info: config => getVirtualizorSingle(config),
    status: config => getVirtualizorSingle(config),
    reboot: config => callVirtualizorAction('reboot', config),
    boot: config => callVirtualizorAction('boot', config),
    shutdown: config => callVirtualizorAction('shutdown', config)
  },
  proxmox: {
    info: config => getProxmoxSingle(config),
    status: config => getProxmoxSingle(config),
    reboot: config => callProxmoxAction('reboot', config),
    boot: config => callProxmoxAction('boot', config),
    shutdown: config => callProxmoxAction('shutdown', config)
  },
  hetzner: {
    info: config => getHetznerSingle(config),
    status: config => getHetznerSingle(config),
    reboot: config => callHetznerAction('reboot', config),
    boot: config => callHetznerAction('boot', config),
    shutdown: config => callHetznerAction('shutdown', config)
  },
  digitalocean: {
    info: config => getDOSingle(config),
    status: config => getDOSingle(config),
    reboot: config => callDOAction('reboot', config),
    boot: config => callDOAction('boot', config),
    shutdown: config => callDOAction('shutdown', config)
  },
  lightsail: {
    info: config => getLightsailSingle(config),
    status: config => getLightsailSingle(config),
    reboot: config => callLightsailAction('reboot', config),
    boot: config => callLightsailAction('boot', config),
    shutdown: config => callLightsailAction('shutdown', config)
  },
  ec2: {
    info: config => getEC2Single(config),
    status: config => getEC2Single(config),
    reboot: config => callEC2Action('reboot', config),
    boot: config => callEC2Action('boot', config),
    shutdown: config => callEC2Action('shutdown', config)
  }
};

async function batchRefresh(serverIds) {
  const allConfigs = await getAllServerConfigs();
  const configs = serverIds && serverIds.length
    ? allConfigs.filter(cfg => serverIds.indexOf(cfg.id) !== -1)
    : allConfigs;
  const results = [];
  for (const cfg of configs) {
    try {
      const panel = PANEL_HANDLERS[cfg.panel_type] || PANEL_HANDLERS.solusvm;
      const data = await panel.status(cfg);
      if (data && typeof data === 'object') {
        if (!data.apiExpiry) data.apiExpiry = extractApiExpiry(data);
        resolveExpiry(data, cfg);
        syncApiExpiryToStorage(cfg, data);
      }
      results.push({ name: cfg.name, success: true, data });
    } catch (e) {
      results.push({ name: cfg.name, success: false, error: e.message });
    }
  }
  return results;
}

async function batchAction(action, serverIds) {
  const allConfigs = await getAllServerConfigs();
  const configs = serverIds && serverIds.length
    ? allConfigs.filter(cfg => serverIds.indexOf(cfg.id) !== -1)
    : allConfigs;
  const results = [];
  for (const cfg of configs) {
    try {
      const panel = PANEL_HANDLERS[cfg.panel_type] || PANEL_HANDLERS.solusvm;
      await panel[action](cfg);
      results.push({ name: cfg.name, success: true });
    } catch (e) {
      results.push({ name: cfg.name, success: false, error: e.message });
    }
  }
  return results;
}

// Listen for messages from popup / options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    // "打开插件" is delegated here from the popup so the MP request is sent from a
    // long-lived SW context (a popup may be torn down before an async fetch finishes,
    // silently dropping the event). The handler keeps the SW alive until sendResponse.
    analytics_opened: () => (typeof Analytics !== 'undefined'
      ? Analytics.extensionOpened().then(function () { return {}; })
      : Promise.resolve({})),
    getStatus: getServerStatus,
    getInfo: getServerInfo,
    reboot: rebootServer,
    boot: bootServer,
    shutdown: shutdownServer,
    batchRefresh: () => batchRefresh(message.serverIds),
    batchReboot: () => batchAction('reboot', message.serverIds),
    batchShutdown: () => batchAction('shutdown', message.serverIds),
    testConnection: () => testConnection(message.config).then(result => {
      if (typeof Analytics !== 'undefined') Analytics.providerConnected(getPanelType(message.config)).catch(() => {});
      return result;
    }),
    testReminder: () => Promise.resolve(sendSampleReminder())
  };

  const handler = handlers[message.action];
  if (handler) {
    handler()
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Asynchronous response
  }
});

// ─── Expiry reminder engine ───────────────────────────────────
const REMINDER_ALARM = 'vpsExpiryReminder';
const REMINDER_PERIOD_MIN = 360; // check every 6 hours

function loadReminderConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(['remindersEnabled', 'expiryThresholds', 'reminderState'], data => {
      const enabled = data.remindersEnabled !== false; // default ON
      const thresholds = (Array.isArray(data.expiryThresholds) && data.expiryThresholds.length)
        ? data.expiryThresholds.map(Number).filter(n => n > 0).sort((a, b) => a - b)
        : DEFAULT_EXPIRY_THRESHOLDS.slice();
      const state = (data.reminderState && typeof data.reminderState === 'object') ? data.reminderState : {};
      resolve({ enabled, thresholds, state });
    });
  });
}

function sendReminderNotification(r) {
  const notifId = r.level === 'expired'
    ? `vps-exp-${r.serverId}-expired`
    : `vps-exp-${r.serverId}-${r.threshold}`;
  const title = r.level === 'expired'
    ? `VPS expired: ${r.name}`
    : `VPS expiry in ${r.daysLeft}d: ${r.name}`;
  const message = r.level === 'expired'
    ? `${r.name} expired ${Math.abs(r.daysLeft)} days ago — renew now.`
    : `${r.name} expires in ${r.daysLeft} day(s). Reminder threshold: ${r.threshold} day(s).`;
  try {
    chrome.notifications.create(notifId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
      priority: 2
    }, () => {});
  } catch (e) {
    console.warn('[reminder] notification failed', e);
  }
}

function sendSampleReminder() {
  try {
    chrome.notifications.create('vps-exp-sample', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'VPS Dashboard · Reminder test',
      message: 'If you can see this, expiry reminders are working. Notifications will fire 30/7/3 days before a server expires.',
      priority: 2
    }, () => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

async function checkExpiryReminders() {
  try {
    const { enabled, thresholds, state } = await loadReminderConfig();
    if (!enabled) return;
    const servers = await getAllServerConfigs();
    const now = new Date();
    const { toNotify, nextState } = computeReminders(servers, { thresholds, now, state });
    chrome.storage.local.set({ reminderState: nextState });
    toNotify.forEach(sendReminderNotification);
    if (toNotify.length) {
      console.log(`[reminder] ${toNotify.length} notification(s) fired`);
      if (typeof Analytics !== 'undefined') Analytics.expiryReminderFired().catch(() => {});
    }
  } catch (e) {
    console.warn('[reminder] check failed', e);
  }
}

// Set the uninstall page (anonymous client_id only, no PII) so we can learn
// about churn without identifying the user. The host is injected at build time
// via the UNINSTALL_URL env var (see package-extension.sh); the source only
// carries a build-time placeholder, never a real domain.
function setupUninstallUrl() {
  if (!chrome.runtime || !chrome.runtime.setUninstallURL) return;
  Analytics.getClientId().then(function (cid) {
    chrome.storage.local.get(['lang'], function (data) {
      var lang = (data && data.lang) || 'en';
      var url = 'https://__UNINSTALL_URL__/uninstall?src=vps-dashboard&v=1&cid=' + encodeURIComponent(cid) + '&lang=' + encodeURIComponent(lang);
      chrome.runtime.setUninstallURL(url, function () {
        if (chrome.runtime.lastError) console.warn('[analytics] setUninstallURL failed', chrome.runtime.lastError);
      });
    });
  }).catch(function () {});
}

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.lang) {
      setupUninstallUrl();
    }
  });
}

// Schedule the periodic check (and run once on install) when the APIs exist.
if (typeof chrome !== 'undefined' && chrome.alarms) {
  const ensureAlarm = () => {
    try {
      chrome.alarms.create(REMINDER_ALARM, { periodInMinutes: REMINDER_PERIOD_MIN });
    } catch (e) {
      console.warn('[reminder] alarm create failed', e);
    }
  };
  if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      ensureAlarm();
      checkExpiryReminders();
      setupUninstallUrl();
    });
  }
  if (chrome.runtime && chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(ensureAlarm);
  }
  if (chrome.alarms.onAlarm) {
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm && alarm.name === REMINDER_ALARM) checkExpiryReminders();
    });
  }
}

if (typeof chrome !== 'undefined' && chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener(() => {
    // Open the popup so the user can act on the reminder.
    if (chrome.action && chrome.action.openPopup) {
      try { chrome.action.openPopup(); } catch (e) {}
    }
  });
}
