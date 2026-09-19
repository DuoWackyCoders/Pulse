/* ============================================
   STORAGE KEYS
   ============================================ */
const STORAGE_KEY = 'patientRouter.patients.v1';
const GROUP_SIZE_KEY = 'patientRouter.groupSizeMax.v1';
const THEME_KEY = 'patientRouter.theme.v1';
const PROVIDER_FILTER_KEY = 'patientRouter.providerFilter.v1';
const SCHEDULES_KEY = 'patientRouter.schedules.v1'; // { 'YYYY-MM-DD': [{id,name,group,provider,arrivalMinutes}, ...] }
const HOME_ADDR_KEY = 'patientRouter.homeAddress.v1'; // id referencing a saved start address — used for SCHEDULING only, not grouping

/* ============================================
   STATE
   ============================================ */
let patients = loadPatients();     // array of patient objects
let groupSizeMax = loadGroupSizeMax(); // max patients per auto-formed group
let activeProviderFilter = localStorage.getItem(PROVIDER_FILTER_KEY) || '';
let activeGroupFilter = '';

/* ============================================
   THEME
   ============================================ */
function loadTheme() {
  return localStorage.getItem(THEME_KEY) || 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  const headerSel = document.getElementById('themeToggle');
  if (headerSel) headerSel.value = theme;
  const adminSel = document.getElementById('themeSelect');
  if (adminSel) adminSel.value = theme;
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ============================================
   PERSISTENCE
   ============================================ */
function loadPatients() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load patients from storage', e);
    return [];
  }
}
function savePatients() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patients));
    return true;
  } catch (e) {
    console.error('Failed to save patients to storage', e);
    setStatus('Could not save — your browser storage may be full.', 'error');
    return false;
  }
}
function loadGroupSizeMax() {
  const raw = localStorage.getItem(GROUP_SIZE_KEY);
  return raw ? parseInt(raw, 10) : 20;
}
function saveGroupSizeMax() {
  localStorage.setItem(GROUP_SIZE_KEY, String(groupSizeMax));
}

/* ============================================
   PROVIDER FILTER
   ============================================ */
function getFilteredPatients() {
  if (!activeProviderFilter) return patients;
  return patients.filter(p => p.provider === activeProviderFilter);
}

function populateProviderFilter() {
  const sel = document.getElementById('providerFilter');
  if (!sel) return;
  const providers = Array.from(new Set(patients.map(p => p.provider).filter(Boolean))).sort();
  sel.innerHTML = '<option value="">All Providers</option>' +
    providers.map(pr => `<option value="${escapeHtml(pr)}" ${pr === activeProviderFilter ? 'selected' : ''}>${escapeHtml(pr)}</option>`).join('');
}

/* ============================================
   CSV PARSING (handles quoted fields with commas)
   ============================================ */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
    } else {
      if (char === '"') inQuotes = true;
      else if (char === ',') { row.push(field); field = ''; }
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && next === '\n') i++;
        row.push(field); field = '';
        if (row.some(f => f.trim() !== '')) rows.push(row);
        row = [];
      } else { field += char; }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some(f => f.trim() !== '')) rows.push(row);
  }
  return rows;
}

// Tracks every "extra" (not specially-handled) column label seen so far,
// in original CSV casing, so the table/export can render them consistently.
let extraColumns = loadExtraColumns();
function loadExtraColumns() {
  try {
    const raw = localStorage.getItem('patientRouter.extraColumns.v1');
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function saveExtraColumns() {
  localStorage.setItem('patientRouter.extraColumns.v1', JSON.stringify(extraColumns));
}

/**
 * CSV "Last Visit" columns come from real-world spreadsheets, which almost
 * never use ISO format on their own (Excel defaults to M/D/YYYY). Blindly
 * storing whatever text is in the cell means any non-ISO date silently
 * breaks date math later (shows up as "NaNd ago" in the UI) with no
 * indication of why. This normalizes on the way in instead: try ISO first,
 * then common US-style separators, then fall back to whatever JS's own
 * Date parser can make sense of. Anything truly unparseable is dropped
 * (empty string) rather than stored as garbage that breaks later.
 */
function normalizeDateString(raw) {
  if (!raw) return '';
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const usMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (usMatch) {
    let [, m, d, y] = usMatch;
    if (y.length === 2) y = (parseInt(y, 10) < 50 ? '20' : '19') + y;
    const candidate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (!isNaN(new Date(candidate + 'T00:00:00').getTime())) return candidate;
  }

  const generic = new Date(s);
  if (!isNaN(generic.getTime())) {
    return `${generic.getFullYear()}-${String(generic.getMonth() + 1).padStart(2, '0')}-${String(generic.getDate()).padStart(2, '0')}`;
  }
  return '';
}

function csvToPatients(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];

  const rawHeader = rows[0].map(h => h.trim());
  const header = rawHeader.map(h => h.toLowerCase());
  const idx = {
    name: header.findIndex(h => h.includes('name')),
    address: header.findIndex(h => h.includes('address')),
    dob: header.findIndex(h => h.includes('dob') || h.includes('birth')),
    coordinator: header.findIndex(h => h.includes('coordinator')),
    provider: header.findIndex(h => h.includes('provider')),
    lastVisit: header.findIndex(h => h.includes('last visit') || h.includes('lastvisit')),
  };
  const knownIdx = new Set(Object.values(idx).filter(i => i >= 0));

  // Any column not specially handled above becomes an "extra" field,
  // keyed by its original header text, so new columns just work.
  const extraIdx = []; // [{ colIndex, label }]
  rawHeader.forEach((label, i) => {
    if (!knownIdx.has(i) && label) {
      extraIdx.push({ colIndex: i, label });
      if (!extraColumns.includes(label)) extraColumns.push(label);
    }
  });
  saveExtraColumns();

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const name = idx.name >= 0 ? (cols[idx.name] || '').trim() : '';
    const address = idx.address >= 0 ? (cols[idx.address] || '').trim() : '';
    if (!name && !address) continue;

    const extra = {};
    extraIdx.forEach(({ colIndex, label }) => {
      extra[label] = (cols[colIndex] || '').trim();
    });

    out.push({
      id: 'p_' + Date.now() + '_' + r + '_' + Math.random().toString(36).slice(2, 7),
      name,
      address,
      dob: idx.dob >= 0 ? (cols[idx.dob] || '').trim() : '',
      coordinator: idx.coordinator >= 0 ? (cols[idx.coordinator] || '').trim() : '',
      provider: idx.provider >= 0 ? (cols[idx.provider] || '').trim() : '',
      lastVisitDate: idx.lastVisit >= 0 ? normalizeDateString(cols[idx.lastVisit] || '') : '',
      extra,
      lat: null,
      lng: null,
      group: null,
      manualGroup: false,
    });
  }
  return out;
}

function patientsToCSV(list) {
  const header = ['Name', 'Address', 'DOB', 'Coordinator', 'Provider', 'Last Visit', ...extraColumns, 'Group'];
  const escape = (v) => {
    const s = (v ?? '').toString();
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [header.join(',')];
  for (const p of list) {
    const extraValues = extraColumns.map(col => (p.extra && p.extra[col]) || '');
    lines.push([p.name, p.address, p.dob, p.coordinator, p.provider, p.lastVisitDate || '', ...extraValues, p.group || '']
      .map(escape).join(','));
  }
  return lines.join('\n');
}

/* ============================================
   GEOCODING (OpenStreetMap Nominatim — free, rate-limited)
   ============================================ */
async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Geocoding request failed');
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

// Respect Nominatim's ~1 req/sec limit
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function geocodeAllPending() {
  const pending = patients.filter(p => p.address && (p.lat === null || p.lng === null));
  if (pending.length === 0) return;

  setStatus(`Geocoding ${pending.length} address(es)... this may take a moment.`, '');
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    try {
      const coords = await geocodeAddress(p.address);
      if (coords) { p.lat = coords.lat; p.lng = coords.lng; }
      else { p.geocodeFailed = true; }
    } catch (e) {
      console.error('Geocode failed for', p.address, e);
      p.geocodeFailed = true;
    }
    setStatus(`Geocoding ${i + 1} of ${pending.length}...`, '');
    await sleep(1100); // stay under 1 req/sec
  }
  savePatients();
  regroup();
  setStatus('Geocoding complete.', 'success');
}

/* ============================================
   CLUSTERING (greedy radius-based grouping)
   ============================================ */
function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function groupLetter(n) {
  // 0 -> A, 1 -> B ... 25 -> Z, 26 -> AA, etc.
  let s = '';
  n = n + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function calculateBearing(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

function bearingToCompass(bearing) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(bearing / 45) % 8;
  return dirs[idx];
}

function buildLocationUnits(patientList) {
  const units = [];
  const assigned = new Set();
  patientList.forEach(p => {
    if (assigned.has(p.id)) return;
    const unit = [p];
    assigned.add(p.id);
    patientList.forEach(q => {
      if (assigned.has(q.id)) return;
      if (isSameLocation(p, q)) { unit.push(q); assigned.add(q.id); }
    });
    units.push(unit);
  });
  return units;
}

// A manual group override is never accidental — it's a deliberate signal
// that this patient has a real constraint (availability, in this case)
// different from their household. The same-address-same-day rule should
// never steamroll that the way pure geography naturally would. Split any
// manually-overridden minority out of their address unit into their own
// (still address-matched) sub-unit, so they're scheduled independently —
// same "manual always wins" principle already used everywhere else.
function splitManualOutliers(units) {
  const result = [];
  units.forEach(unit => {
    if (unit.length === 1) { result.push(unit); return; }
    const nonManual = unit.filter(p => !p.manualGroup);
    const householdGroup = nonManual.length > 0 ? nonManual[0].group : unit[0].group;
    const buckets = {};
    unit.forEach(p => {
      const key = (p.manualGroup && p.group !== householdGroup) ? p.group : householdGroup;
      (buckets[key] = buckets[key] || []).push(p);
    });
    Object.values(buckets).forEach(bucket => result.push(bucket));
  });
  return result;
}

function regroup() {
  // Keep manually-assigned patients fixed (this includes anything you drew
  // and assigned on the map). Auto-cluster only what's left.
  const manual = patients.filter(p => p.manualGroup && p.group);
  const auto = patients.filter(p => !p.manualGroup && p.lat !== null && p.lng !== null);
  const noCoords = patients.filter(p => p.lat === null || p.lng === null);

  const usedLabels = new Set(manual.map(p => p.group));
  let nextIdx = 0;
  const nextFreeLetter = () => {
    let letter;
    do { letter = groupLetter(nextIdx++); } while (usedLabels.has(letter));
    usedLabels.add(letter);
    return letter;
  };

  const MAX_SPREAD_MILES = 8; // stop growing a group rather than force in a distant outlier
  const OVERFLOW_TOLERANCE = 3; // let the cleanup pass slightly exceed the cap when a patient is CLEARLY closer to that group than any other

  // Same-address patients are ALWAYS kept together as one atomic unit
  // throughout clustering — a unit of 14 people at one building moves as a
  // single block, never split across groups, even if that means a group
  // ends up well over the requested size. This is the fix for two people
  // at the same address (e.g. a married couple) ending up in different
  // groups just because of where the greedy growth happened to be when it
  // reached each of them individually.
  const units = buildLocationUnits(auto);
  const unitCentroid = (unit) => ({
    lat: unit.reduce((s, m) => s + m.lat, 0) / unit.length,
    lng: unit.reduce((s, m) => s + m.lng, 0) / unit.length
  });

  // No radius, no home anchor — keep grabbing the nearest remaining unit
  // to the cluster's CENTER (not the last one added), until the group hits
  // the size cap, runs out of units, OR the nearest remaining unit is
  // farther than a sane spread — better to leave a group smaller than to
  // stretch it across the map just to hit the count.
  //
  // When a cluster fills up (or stops early), the NEXT cluster's seed is
  // whichever unclustered unit is nearest to where we just left off —
  // turning this into a spatial sweep instead of a random jump.
  const unclustered = [...units];
  let lastCentroid = null;
  while (unclustered.length) {
    let seedUnit;
    if (lastCentroid) {
      let bestIdx = 0, bestDist = Infinity;
      unclustered.forEach((cand, i) => {
        const c = unitCentroid(cand);
        const d = haversineMiles(lastCentroid.lat, lastCentroid.lng, c.lat, c.lng);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });
      seedUnit = unclustered.splice(bestIdx, 1)[0];
    } else {
      seedUnit = unclustered.shift();
    }

    const letter = nextFreeLetter();
    let members = [...seedUnit];
    seedUnit.forEach(p => { p.group = letter; });

    while (members.length < groupSizeMax && unclustered.length) {
      const centroidLat = members.reduce((s, m) => s + m.lat, 0) / members.length;
      const centroidLng = members.reduce((s, m) => s + m.lng, 0) / members.length;
      let bestIdx = 0, bestDist = Infinity;
      unclustered.forEach((cand, i) => {
        const c = unitCentroid(cand);
        const d = haversineMiles(centroidLat, centroidLng, c.lat, c.lng);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });
      if (bestDist > MAX_SPREAD_MILES) break; // don't force in a distant outlier
      const nextUnit = unclustered.splice(bestIdx, 1)[0];
      nextUnit.forEach(p => { p.group = letter; });
      members = members.concat(nextUnit);
    }

    lastCentroid = {
      lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
      lng: members.reduce((s, m) => s + m.lng, 0) / members.length
    };
  }

  // Cleanup pass: any UNIT closer to a DIFFERENT group's center than its
  // own gets reassigned there as a whole, as long as that group still has
  // room for the whole unit. This fixes jagged/interleaved boundaries left
  // over from the one-pass greedy sweep above — same as before, just
  // operating on units instead of individual patients so nothing splits.
  for (let iter = 0; iter < 4; iter++) {
    const byGroup = {};
    auto.forEach(p => { if (p.group) { (byGroup[p.group] = byGroup[p.group] || []).push(p); } });
    const centroids = {};
    Object.keys(byGroup).forEach(g => {
      const arr = byGroup[g];
      centroids[g] = {
        lat: arr.reduce((s, m) => s + m.lat, 0) / arr.length,
        lng: arr.reduce((s, m) => s + m.lng, 0) / arr.length
      };
    });

    let changed = false;
    units.forEach(unit => {
      const currentGroup = unit[0].group; // every member of a unit always shares one group by construction
      if (!currentGroup || !centroids[currentGroup]) return;
      const c = unitCentroid(unit);
      const currentDist = haversineMiles(centroids[currentGroup].lat, centroids[currentGroup].lng, c.lat, c.lng);
      let bestGroup = currentGroup, bestDist = currentDist;
      Object.keys(centroids).forEach(g => {
        if (g === currentGroup) return;
        if (byGroup[g].length + unit.length > groupSizeMax + OVERFLOW_TOLERANCE) return; // hard ceiling for the WHOLE unit, but allow a little flex
        const d = haversineMiles(centroids[g].lat, centroids[g].lng, c.lat, c.lng);
        if (d > MAX_SPREAD_MILES) return; // never reassign to a group this far away, even if it's the "closest available"
        if (d < bestDist) { bestDist = d; bestGroup = g; }
      });
      if (bestGroup !== currentGroup) {
        byGroup[currentGroup] = byGroup[currentGroup].filter(x => !unit.includes(x));
        (byGroup[bestGroup] = byGroup[bestGroup] || []).push(...unit);
        unit.forEach(p => { p.group = bestGroup; });
        changed = true;
      }
    });
    if (!changed) break;
  }

  noCoords.forEach(p => { if (!p.manualGroup) p.group = null; });

  savePatients();
  renderTable();
  renderGroupSummary();
  renderClientsMap();
}

function getHomeCoords() {
  const homeId = localStorage.getItem(HOME_ADDR_KEY);
  if (!homeId) return null;
  const saved = loadStartAddresses().find(a => a.id === homeId);
  return saved ? { lat: saved.lat, lng: saved.lng } : null;
}

function populateHomeAddressSelect() {
  const sel = document.getElementById('homeAddressSelect');
  if (!sel) return;
  const saved = loadStartAddresses();
  const current = localStorage.getItem(HOME_ADDR_KEY) || '';
  sel.innerHTML = '<option value="">No home set — using upload order</option>' +
    saved.map(a => `<option value="${a.id}">${escapeHtml(a.label)} — ${escapeHtml(a.address)}</option>`).join('');
  if (saved.some(a => a.id === current)) sel.value = current;
}

/* ============================================
   RENDERING
   ============================================ */
function setStatus(msg, kind) {
  const el = document.getElementById('statusLine');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-line' + (kind ? ' ' + kind : '');
}

function lastVisitCellHtml(p) {
  if (!p.lastVisitDate) {
    return `<span class="due-badge due-overdue">Never — Due</span>`;
  }
  const last = new Date(p.lastVisitDate + 'T00:00:00');
  if (isNaN(last.getTime())) {
    return `<span class="due-badge due-overdue" title="Stored value: ${escapeHtml(p.lastVisitDate)}">⚠ Invalid date — click ✏️ Edit to fix</span>`;
  }
  const today = new Date();
  const daysSince = Math.floor((today - last) / 86400000);
  if (daysSince >= 30) {
    return `${escapeHtml(p.lastVisitDate)}<br><span class="due-badge due-overdue">${daysSince}d — Due</span>`;
  }
  if (daysSince >= 23) {
    return `${escapeHtml(p.lastVisitDate)}<br><span class="due-badge due-soon">${daysSince}d — Due Soon</span>`;
  }
  return `${escapeHtml(p.lastVisitDate)}<br><span class="due-badge due-ok">${daysSince}d ago</span>`;
}

function renderTableHeader() {
  const thead = document.getElementById('patientTableHead');
  if (!thead) return;
  const cols = ['Name', 'Address', 'DOB', 'Coordinator', ...extraColumns, 'Last Visit', 'Group', 'Override', 'Edit'];
  thead.innerHTML = '<tr>' + cols.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr>';
}

// Same 12 hues as before, but reordered so index N and N+1 are always on
// opposite sides of the color wheel — since spatially adjacent groups tend
// to get consecutive letters (A, B, C...), this keeps neighboring clusters
// from ever landing on near-identical shades.
const GROUP_PALETTE = ['#E03131', '#0C8599', '#F76707', '#1971C2', '#F0A202', '#4263EB', '#74B816', '#9C36B5', '#2F9E44', '#D6336C', '#0CA678', '#E64980'];
function groupColor(label) {
  if (!label || label === 'unassigned') return '#8A7480';
  const allLabels = Array.from(new Set(patients.map(p => p.group).filter(Boolean))).sort();
  const idx = allLabels.indexOf(label);
  if (idx === -1) return '#8A7480';
  if (idx < GROUP_PALETTE.length) return GROUP_PALETTE[idx];
  // More active groups than curated colors — generate further distinct hues
  // via golden-angle rotation so nothing repeats even at large counts.
  const hue = (idx * 137.508) % 360;
  return `hsl(${hue}, 65%, 40%)`;
}

/* ============================================
   CLIENTS MAP (draw-to-group tool)
   ============================================ */
let clientsMap = null;
let clientsMarkersLayer = null;
let drawnItemsLayer = null;
let pendingDrawSelection = [];
let pendingDrawLayer = null;

function ensureClientsMap() {
  if (clientsMap) return;
  clientsMap = L.map('clientsMap');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(clientsMap);

  drawnItemsLayer = new L.FeatureGroup();
  clientsMap.addLayer(drawnItemsLayer);

  const drawControl = new L.Control.Draw({
    draw: {
      circle: true,
      marker: false, polygon: false, polyline: false, rectangle: false, circlemarker: false
    },
    edit: { featureGroup: drawnItemsLayer, remove: true }
  });
  clientsMap.addControl(drawControl);

  clientsMap.on(L.Draw.Event.CREATED, (e) => {
    const layer = e.layer;
    drawnItemsLayer.clearLayers();
    drawnItemsLayer.addLayer(layer);
    pendingDrawLayer = layer;

    const center = layer.getLatLng();
    const radiusMi = layer.getRadius() / 1609.34;
    pendingDrawSelection = getFilteredPatients().filter(p =>
      p.lat !== null && p.lng !== null &&
      haversineMiles(center.lat, center.lng, p.lat, p.lng) <= radiusMi
    );

    const bar = document.getElementById('drawAssignBar');
    document.getElementById('drawAssignCount').textContent = `${pendingDrawSelection.length} patient(s) selected —`;
    bar.style.display = 'flex';
  });
}

function groupChangeControlHtml(p) {
  const groupOptions = availableGroupLetters()
    .map(l => `<option value="${l}" ${p.group === l ? 'selected' : ''}>Group ${l}</option>`)
    .join('');
  return `
    <div style="margin-top:8px;">
      <select id="clientGroupSel_${p.id}" style="width:100%; font-size:0.8rem; padding:4px 6px;" onchange="document.getElementById('clientGroupNewWrap_${p.id}').style.display = this.value === '__new__' ? 'block' : 'none';">
        ${groupOptions}
        <option value="__new__">+ New group...</option>
      </select>
    </div>
    <div id="clientGroupNewWrap_${p.id}" style="display:none; margin-top:6px;">
      <input type="text" id="clientGroupNew_${p.id}" placeholder="New group label (e.g. I)" style="width:100%; font-size:0.8rem; padding:4px 6px;">
    </div>
    <button type="button" style="margin-top:6px; font-size:0.8rem; padding:4px 8px; width:100%;" onclick="window.saveClientGroupFromMap('${p.id}')">Save</button>
  `;
}

function renderClientsMap() {
  ensureClientsMap();
  if (clientsMarkersLayer) clientsMarkersLayer.remove();
  clientsMarkersLayer = L.layerGroup().addTo(clientsMap);

  const withCoords = getFilteredPatients().filter(p => p.lat !== null && p.lng !== null);
  if (withCoords.length === 0) {
    setTimeout(() => clientsMap.invalidateSize(), 100);
    return;
  }

  // Same-address patients used to render as individual markers stacked
  // exactly on top of each other — visually one pin, but only the topmost
  // one was ever clickable, hiding everyone else (and any group mismatch
  // among them) completely. Consolidate into one marker with a count badge
  // instead, with every patient listed and editable in the popup.
  const units = buildLocationUnits(withCoords);

  units.forEach(unit => {
    const lat = unit[0].lat, lng = unit[0].lng;

    if (unit.length === 1) {
      const p = unit[0];
      const color = groupColor(p.group);
      L.circleMarker([lat, lng], { radius: 8, color, fillColor: color, fillOpacity: 0.85, weight: 2 })
        .addTo(clientsMarkersLayer)
        .bindTooltip(`${p.name} — Group ${p.group || 'unassigned'}`)
        .bindPopup(`
          <div style="min-width:170px;">
            <strong>${escapeHtml(p.name)}</strong><br>
            <span style="color:var(--text-soft); font-size:0.8rem;">Currently: Group ${escapeHtml(p.group || 'unassigned')}</span>
            ${groupChangeControlHtml(p)}
          </div>
        `);
      return;
    }

    const groupCounts = {};
    unit.forEach(p => { const g = p.group || 'unassigned'; groupCounts[g] = (groupCounts[g] || 0) + 1; });
    const dominantGroup = Object.entries(groupCounts).sort((a, b) => b[1] - a[1])[0][0];
    const mixed = Object.keys(groupCounts).length > 1;
    const badgeColor = groupColor(dominantGroup === 'unassigned' ? 'unassigned' : dominantGroup);

    const badgeIcon = L.divIcon({
      className: 'cluster-pin',
      html: `<div class="cluster-pin-badge${mixed ? ' cluster-pin-mixed' : ''}" style="background:${badgeColor};">${unit.length}${mixed ? '<span class="cluster-pin-warn">⚠️</span>' : ''}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    const popupHtml = `
      <div style="min-width:220px; max-height:320px; overflow-y:auto;">
        <strong>${unit.length} patients at this address</strong>
        ${mixed ? '<br><span style="color:var(--pink-deep); font-size:0.78rem; font-weight:700;">⚠️ Mixed groups — not all the same</span>' : ''}
        ${unit.map(p => `
          <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
            <strong>${escapeHtml(p.name)}</strong> <span style="color:var(--text-soft); font-size:0.78rem;">(Group ${escapeHtml(p.group || 'unassigned')})</span>
            ${groupChangeControlHtml(p)}
          </div>
        `).join('')}
      </div>
    `;

    L.marker([lat, lng], { icon: badgeIcon })
      .addTo(clientsMarkersLayer)
      .bindTooltip(`${unit.length} patients here${mixed ? ' (mixed groups)' : ''}`)
      .bindPopup(popupHtml);
  });

  const bounds = L.latLngBounds(withCoords.map(p => [p.lat, p.lng]));
  clientsMap.fitBounds(bounds, { padding: [30, 30] });
  setTimeout(() => clientsMap.invalidateSize(), 150);
}

window.saveClientGroupFromMap = function (patientId) {
  const sel = document.getElementById(`clientGroupSel_${patientId}`);
  if (!sel) return;
  let label = sel.value;
  if (label === '__new__') {
    const newInput = document.getElementById(`clientGroupNew_${patientId}`);
    label = newInput ? newInput.value.trim() : '';
  }
  if (!label) { alert('Type a group label first.'); return; }

  const master = patients.find(p => p.id === patientId);
  if (!master) return;
  master.manualGroup = true;
  master.group = label;
  savePatients();
  renderTable();
  renderGroupSummary();
  renderClientsMap();
  if (clientsMap) clientsMap.closePopup();
};

function wireClientsMap() {
  document.getElementById('drawAssignBtn').addEventListener('click', () => {
    const label = document.getElementById('drawGroupLabel').value.trim();
    if (!label) { alert('Type a group label first (e.g. A).'); return; }
    if (pendingDrawSelection.length === 0) { alert('No patients were inside that circle.'); return; }

    pendingDrawSelection.forEach(p => {
      const master = patients.find(pt => pt.id === p.id);
      if (master) { master.manualGroup = true; master.group = label; }
    });
    savePatients();
    renderTable();
    renderGroupSummary();
    renderClientsMap();

    if (drawnItemsLayer) drawnItemsLayer.clearLayers();
    document.getElementById('drawAssignBar').style.display = 'none';
    document.getElementById('drawGroupLabel').value = '';
    pendingDrawSelection = [];
  });

  document.getElementById('drawCancelBtn').addEventListener('click', () => {
    if (drawnItemsLayer) drawnItemsLayer.clearLayers();
    document.getElementById('drawAssignBar').style.display = 'none';
    document.getElementById('drawGroupLabel').value = '';
    pendingDrawSelection = [];
  });
}

function renderTable() {
  const tbody = document.getElementById('patientTableBody');
  const emptyState = document.getElementById('emptyState');
  const tableWrap = document.getElementById('tableWrap');
  if (!tbody) return;

  renderTableHeader();

  if (patients.length === 0) {
    tableWrap.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  const searchInput = document.getElementById('clientsSearchInput');
  const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const providerScoped = getFilteredPatients();
  const searchScoped = providerScoped.filter(p => !searchTerm || p.name.toLowerCase().includes(searchTerm));
  const displayed = searchScoped.filter(p => !activeGroupFilter || (p.group || 'Unassigned') === activeGroupFilter);

  const countEl = document.getElementById('clientsFilterCount');
  if (countEl) {
    const isFiltered = displayed.length !== patients.length;
    if (isFiltered) {
      const reasons = [];
      if (activeProviderFilter) reasons.push(`Viewing as: ${activeProviderFilter}`);
      if (searchTerm) reasons.push(`search: "${searchInput.value.trim()}"`);
      if (activeGroupFilter) reasons.push(`Group: ${activeGroupFilter}`);
      countEl.innerHTML = `⚠️ Showing ${displayed.length} of ${patients.length} patients (${reasons.join(', ')}) — <button type="button" id="clearClientsFiltersBtn" class="btn-tiny">Clear filters</button>`;
      countEl.style.display = 'block';
      countEl.className = 'status-line error';
    } else {
      countEl.style.display = 'none';
    }
  }

  if (displayed.length === 0) {
    tableWrap.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.innerHTML = activeGroupFilter
      ? `<p>No patients in Group ${escapeHtml(activeGroupFilter)}${searchTerm ? ` matching "${escapeHtml(searchInput.value)}"` : ''}.</p>`
      : `<p>No patients match "${escapeHtml(searchInput.value)}".</p>`;
    return;
  }
  tableWrap.style.display = 'block';
  emptyState.style.display = 'none';
  emptyState.innerHTML = '<p>No patients yet.</p><p>Upload a CSV above to get started.</p>';

  tbody.innerHTML = '';
  displayed.forEach(p => {
    const tr = document.createElement('tr');

    const groupLabel = p.group || 'unassigned';
    const extraCells = extraColumns.map(col =>
      `<td>${escapeHtml(p.extra && p.extra[col])}</td>`).join('');

    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.address)}${p.geocodeFailed ? ' <span style="color:var(--pink-deep)">(not found)</span>' : ''}</td>
      <td>${escapeHtml(p.dob)}</td>
      <td>${escapeHtml(p.coordinator)}</td>
      ${extraCells}
      <td>${lastVisitCellHtml(p)}</td>
      <td><span class="group-pill" style="background:${groupColor(groupLabel)}; color:#fff;">${escapeHtml(groupLabel)}</span></td>
      <td>
        <select class="group-select" data-id="${p.id}">
          <option value="">Auto</option>
          ${availableGroupLetters().map(l => `<option value="${l}" ${p.manualGroup && p.group === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </td>
      <td><button type="button" class="btn-tiny" onclick="window.openEditPatient('${p.id}')">✏️ Edit</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.group-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-id');
      const patient = patients.find(p => p.id === id);
      if (!patient) return;
      if (e.target.value === '') {
        patient.manualGroup = false;
      } else {
        patient.manualGroup = true;
        patient.group = e.target.value;
      }
      regroup();
    });
  });
}

function availableGroupLetters() {
  const letters = new Set(patients.map(p => p.group).filter(Boolean));
  // always offer at least A, B, C as options even if not yet created
  ['A', 'B', 'C'].forEach(l => letters.add(l));
  return Array.from(letters).sort();
}

function renderGroupSummary() {
  const el = document.getElementById('groupSummary');
  if (!el) return;
  const counts = {};
  getFilteredPatients().forEach(p => {
    const key = p.group || 'Unassigned';
    counts[key] = (counts[key] || 0) + 1;
  });
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = entries.map(([g, c]) => {
    const isActive = activeGroupFilter === g;
    const ring = isActive ? 'box-shadow: 0 0 0 3px var(--pink-deep); ' : '';
    return `<span class="group-pill" data-group="${escapeHtml(g)}" style="background:${groupColor(g === 'Unassigned' ? 'unassigned' : g)}; color:#fff; margin-right:8px; cursor:pointer; ${ring}" onclick="window.toggleGroupFilter('${escapeHtml(g)}')" title="Click to show only Group ${escapeHtml(g)}">${g} — ${c}</span>`;
  }).join('');
}

window.toggleGroupFilter = function (g) {
  activeGroupFilter = (activeGroupFilter === g) ? '' : g;
  renderTable();
  renderGroupSummary();
  const tableWrap = document.getElementById('tableWrap');
  if (activeGroupFilter && tableWrap) tableWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function escapeHtml(str) {
  return (str ?? '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ============================================
   UPLOAD HANDLING
   ============================================ */
function isDuplicatePatient(candidate, existingList) {
  const norm = (s) => (s || '').trim().toLowerCase();
  return existingList.some(p =>
    norm(p.name) === norm(candidate.name) &&
    norm(p.address) === norm(candidate.address) &&
    norm(p.dob) === norm(candidate.dob)
  );
}

function downloadAllPatientsCsv() {
  const list = getFilteredPatients();
  if (list.length === 0) { setStatus('Nothing to download yet.', 'error'); return false; }
  const csv = patientsToCSV(list);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = activeProviderFilter ? `patients-${activeProviderFilter}.csv` : 'patients.csv';
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/* ============================================
   CLEAR ALL — two-step confirmation with backup offer
   ============================================ */
function showClearAllStep1() {
  const modal = document.getElementById('clearAllModal');
  document.getElementById('clearAllTitle').textContent = 'Erase all patient data?';
  document.getElementById('clearAllText').textContent =
    `This removes all ${patients.length} patient(s) from this browser. This cannot be undone.`;
  document.getElementById('clearAllActions').innerHTML = `
    <button id="clearAllBackOut" class="btn btn-secondary" type="button">Oh No, Back Out</button>
    <button id="clearAllYes" class="btn btn-primary" type="button">Yes, Continue</button>
  `;
  modal.style.display = 'flex';
  document.getElementById('clearAllBackOut').addEventListener('click', () => { modal.style.display = 'none'; });
  document.getElementById('clearAllYes').addEventListener('click', showClearAllStep2);
}

function showClearAllStep2() {
  document.getElementById('clearAllTitle').textContent = 'Back up first?';
  document.getElementById('clearAllText').textContent =
    'Recommended: download your current patient list before removing it, just in case.';
  document.getElementById('clearAllActions').innerHTML = `
    <button id="clearAllSkip" class="btn btn-ghost" type="button">Skip (data will be permanently deleted)</button>
    <button id="clearAllBackup" class="btn btn-primary" type="button">⬇️ Back Up, Then Erase</button>
  `;
  document.getElementById('clearAllSkip').addEventListener('click', performClearAll);
  document.getElementById('clearAllBackup').addEventListener('click', () => {
    downloadAllPatientsCsv();
    performClearAll();
  });
}

function performClearAll() {
  patients = [];
  savePatients();
  renderTable();
  renderGroupSummary();
  if (clientsMap) renderClientsMap();
  document.getElementById('clearAllModal').style.display = 'none';
  setStatus('All patient data cleared.', '');
}

/* ============================================
   MANUAL ADD (Client Center)
   ============================================ */
let manualRowCount = 0;

function manualRowHtml(idx) {
  return `
    <div class="manual-row" data-row="${idx}">
      <input type="text" placeholder="Name" data-field="name">
      <input type="text" placeholder="Address" data-field="address">
      <input type="text" placeholder="DOB" data-field="dob">
      <input type="text" placeholder="Coordinator" data-field="coordinator">
      <input type="text" placeholder="Provider" data-field="provider">
      <button type="button" class="btn-tiny btn-tiny-danger" onclick="window.removeManualRow(${idx})">✖</button>
    </div>
  `;
}

function addManualRow() {
  manualRowCount++;
  document.getElementById('manualAddRows').insertAdjacentHTML('beforeend', manualRowHtml(manualRowCount));
}

window.removeManualRow = function (idx) {
  const rows = document.querySelectorAll('.manual-row');
  if (rows.length <= 1) {
    // Keep at least one row — just clear it instead of removing.
    const row = document.querySelector(`.manual-row[data-row="${idx}"]`);
    if (row) row.querySelectorAll('input').forEach(inp => inp.value = '');
    return;
  }
  const row = document.querySelector(`.manual-row[data-row="${idx}"]`);
  if (row) row.remove();
};

function resetManualRows() {
  document.getElementById('manualAddRows').innerHTML = '';
  manualRowCount = 0;
  addManualRow();
}

function checkHiddenByCurrentView(addedList) {
  const reasons = [];
  if (activeProviderFilter) {
    const hiddenByProvider = addedList.filter(p => p.provider !== activeProviderFilter);
    if (hiddenByProvider.length > 0) {
      reasons.push(`${hiddenByProvider.length} won't show under "Viewing as: ${activeProviderFilter}" (their Provider field doesn't match) — switch to "All Providers" to see them`);
    }
  }
  const searchInput = document.getElementById('clientsSearchInput');
  const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
  if (searchTerm) {
    const hiddenBySearch = addedList.filter(p => !p.name.toLowerCase().includes(searchTerm));
    if (hiddenBySearch.length > 0) {
      reasons.push(`${hiddenBySearch.length} won't show under the current Clients search — clear the search box to see them`);
    }
  }
  return reasons;
}

async function submitManualAdd() {
  const rows = document.querySelectorAll('.manual-row');
  const candidates = [];
  rows.forEach(row => {
    const get = (f) => row.querySelector(`input[data-field="${f}"]`).value.trim();
    const name = get('name');
    const address = get('address');
    if (!name && !address) return; // skip fully blank rows
    candidates.push({
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name, address,
      dob: get('dob'),
      coordinator: get('coordinator'),
      provider: get('provider'),
      notes: '', lat: null, lng: null, group: null, manualGroup: false
    });
  });

  if (candidates.length === 0) {
    document.getElementById('manualAddStatus').textContent = 'Fill in at least a name and address on one row.';
    document.getElementById('manualAddStatus').className = 'status-line error';
    return;
  }

  let skipped = 0;
  const toAdd = [];
  candidates.forEach(c => {
    if (isDuplicatePatient(c, patients) || isDuplicatePatient(c, toAdd)) skipped++;
    else toAdd.push(c);
  });

  patients = patients.concat(toAdd);
  const saveOk = savePatients();
  renderTable();
  renderGroupSummary();
  populateProviderFilter();
  resetManualRows();

  const statusEl = document.getElementById('manualAddStatus');
  if (!saveOk) {
    statusEl.textContent = 'Save failed — your browser storage may be full. The patient(s) may not persist after reload.';
    statusEl.className = 'status-line error';
  } else {
    const hiddenReasons = checkHiddenByCurrentView(toAdd);
    const hiddenNote = hiddenReasons.length > 0 ? ' ⚠️ ' + hiddenReasons.join('; ') + '.' : '';
    statusEl.textContent = `Added ${toAdd.length} patient(s).` + (skipped > 0 ? ` Skipped ${skipped} duplicate(s).` : '') + hiddenNote + ' Geocoding now...';
    statusEl.className = 'status-line' + (hiddenNote ? ' error' : ' success');
  }

  await geocodeAllPending();
}

function handleFile(file, mode) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target.result;
    const parsed = csvToPatients(text);
    if (parsed.length === 0) {
      setStatus('No valid rows found in that CSV. Check the column headers (Name, Address, DOB...).', 'error');
      return;
    }
    let skippedDupes = 0;
    let justAdded;
    if (mode === 'replace') {
      patients = parsed;
      justAdded = parsed;
    } else {
      const toAdd = [];
      parsed.forEach(candidate => {
        if (isDuplicatePatient(candidate, patients) || isDuplicatePatient(candidate, toAdd)) {
          skippedDupes++;
        } else {
          toAdd.push(candidate);
        }
      });
      patients = patients.concat(toAdd);
      justAdded = toAdd;
    }
    const saveOk = savePatients();
    renderTable();
    renderGroupSummary();
    populateProviderFilter();
    const addedCount = parsed.length - skippedDupes;
    if (!saveOk) {
      setStatus('Save failed — your browser storage may be full. This data may not persist after reload.', 'error');
    } else {
      const hiddenReasons = checkHiddenByCurrentView(justAdded);
      const hiddenNote = hiddenReasons.length > 0 ? ' ⚠️ ' + hiddenReasons.join('; ') + '.' : '';
      setStatus(`Loaded ${addedCount} patient(s).` + (skippedDupes > 0 ? ` Skipped ${skippedDupes} duplicate(s) (matching name, address, and DOB).` : '') + hiddenNote + ' Geocoding addresses next...', hiddenNote ? 'error' : 'success');
    }
    await geocodeAllPending();
  };
  reader.onerror = () => setStatus('Could not read that file.', 'error');
  reader.readAsText(file);
}

/* ============================================
   MAP VIEW (Leaflet + free OpenStreetMap tiles)
   ============================================ */
let leafletMap = null;
let leafletLayer = null;
let lastRouteGeometry = null; // actual road-path coordinates from the last successful route fetch

function ensureMap() {
  if (leafletMap) return;
  leafletMap = L.map('routeMap');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(leafletMap);
}

function renderMap() {
  if (!startCoords || scheduledPatients.length === 0) return;
  ensureMap();

  if (leafletLayer) leafletLayer.remove();
  leafletLayer = L.layerGroup().addTo(leafletMap);

  const homeIcon = L.divIcon({
    className: 'home-pin',
    html: '<div class="home-pin-badge">🏠</div>',
    iconSize: [34, 34],
    iconAnchor: [17, 30]
  });
  L.marker([startCoords.lat, startCoords.lng], { icon: homeIcon })
    .addTo(leafletLayer)
    .bindPopup('Start (home base)');

  scheduledPatients.forEach((p, i) => {
    L.marker([p.lat, p.lng])
      .addTo(leafletLayer)
      .bindPopup(`
        #${i + 1} ${escapeHtml(p.name)}<br>
        ${minutesToClock(p.arrivalMinutes)} — Group ${escapeHtml(p.group || '—')}<br>
        <div style="margin-top:6px; display:flex; gap:6px; align-items:center;">
          <input type="text" id="groupChange_${p.id}" placeholder="New group" style="width:70px; font-size:0.8rem; padding:3px 6px;">
          <button type="button" style="font-size:0.8rem; padding:3px 8px;" onclick="window.changeStopGroup('${p.id}', document.getElementById('groupChange_${p.id}').value)">Save</button>
        </div>
        <button type="button" style="margin-top:6px; width:100%; font-size:0.8rem; padding:4px 8px; background:var(--pink-deep); color:#fff; border:none; border-radius:6px; cursor:pointer;" onclick="window.removeFromRouteToLeftover('${p.id}')">✖ Remove from route</button>
      `);
  });

  const points = [[startCoords.lat, startCoords.lng], ...scheduledPatients.map(p => [p.lat, p.lng])];
  if (lastRouteGeometry && lastRouteGeometry.length > 1) {
    // Real road path from the routing service — solid line, hugs actual streets.
    L.polyline(lastRouteGeometry, { color: '#EE7EAB', weight: 4, opacity: 0.85 }).addTo(leafletLayer);
  } else {
    // Fallback only: straight lines between stops, used when the routing
    // service was unreachable. Dashed so it visually reads as an estimate,
    // not an actual path.
    L.polyline(points, { color: '#EE7EAB', weight: 3, dashArray: '1,8' }).addTo(leafletLayer);
  }

  // Ghost pins: other patients not currently on today's route. Split into
  // eligible (pink — could be pulled in) vs. recently-visited/ineligible
  // (grey, hollow — this is WHY the route skipped them despite being close).
  const scheduledIds = new Set(scheduledPatients.map(p => p.id));
  const scheduleDateForMap = document.getElementById('scheduleDate').value || new Date().toISOString().slice(0, 10);
  const includeRecentForMap = document.getElementById('includeRecent').checked;
  const otherPatients = getFilteredPatients().filter(p => p.lat !== null && p.lng !== null && !scheduledIds.has(p.id));

  const ghostIconEligible = L.divIcon({
    className: 'ghost-pin',
    html: '<div class="ghost-pin-dot"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
  const ghostIconIneligible = L.divIcon({
    className: 'ghost-pin',
    html: '<div class="ghost-pin-dot ghost-pin-ineligible"></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });

  otherPatients.forEach(p => {
    const ineligible = !includeRecentForMap && isRecentlyVisited(p, scheduleDateForMap);
    const icon = ineligible ? ghostIconIneligible : ghostIconEligible;
    const popup = ineligible
      ? `${escapeHtml(p.name)} (Group ${escapeHtml(p.group || '—')})<br><span style="color:var(--text-soft); font-size:0.8rem;">Recently visited (${escapeHtml(p.lastVisitDate || '')}) — not eligible for 30 days</span>`
      : `${escapeHtml(p.name)} (Group ${escapeHtml(p.group || '—')})<br>
         <div style="margin-top:6px; display:flex; gap:6px;">
           <button type="button" style="flex:1; font-size:0.8rem; padding:4px 6px;" onclick="window.addPatientToLeftover('${p.id}')">+ Leftover</button>
           <button type="button" style="flex:1; font-size:0.8rem; padding:4px 6px; background:var(--lime-deep); color:#fff; border:none; border-radius:6px; cursor:pointer;" onclick="window.addPatientToScheduleDirectly('${p.id}')">+ Route</button>
         </div>`;
    L.marker([p.lat, p.lng], { icon }).addTo(leafletLayer).bindPopup(popup);
  });

  leafletMap.fitBounds(L.latLngBounds(points), { padding: [30, 30] });
  setTimeout(() => leafletMap.invalidateSize(), 150);
}

window.changeStopGroup = function (patientId, newLabel) {
  const label = (newLabel || '').trim();
  if (!label) { alert('Type a group label first.'); return; }
  const master = patients.find(p => p.id === patientId);
  if (!master) return;
  master.manualGroup = true;
  master.group = label;
  savePatients();
  renderTable();
  renderGroupSummary();
  if (clientsMap) renderClientsMap();
  if (leafletMap) leafletMap.closePopup();
  setScheduleStatus(`Moved ${master.name} to Group ${label}.`, 'success');
};

function renderScheduleSearchResults(term) {
  const container = document.getElementById('scheduleSearchResults');
  if (!term) { container.style.display = 'none'; container.innerHTML = ''; return; }

  const scheduledIds = new Set(scheduledPatients.map(p => p.id));
  const matches = getFilteredPatients()
    .filter(p => p.lat !== null && p.lng !== null && p.name.toLowerCase().includes(term.toLowerCase()))
    .slice(0, 6);

  if (matches.length === 0) {
    container.innerHTML = '<p class="status-line">No matches.</p>';
    container.style.display = 'block';
    return;
  }

  container.innerHTML = matches.map(p => {
    const alreadyScheduled = scheduledIds.has(p.id);
    return `
      <div class="search-result-row">
        <span>${escapeHtml(p.name)} — ${escapeHtml(p.address)} (Grp ${escapeHtml(p.group || '—')})</span>
        ${alreadyScheduled
          ? `<span style="color:var(--lime-deep); font-weight:700; font-size:0.78rem; flex-shrink:0;">✓ Already scheduled</span>`
          : `<div style="display:flex; gap:6px; flex-shrink:0;">
              <button type="button" class="btn-tiny" onclick="window.addPatientToLeftover('${p.id}')">+ Leftover</button>
              <button type="button" class="btn-tiny" onclick="window.addPatientToScheduleDirectly('${p.id}')">+ To Schedule</button>
            </div>`}
      </div>
    `;
  }).join('');
  container.style.display = 'block';
}

/**
 * Re-optimizes stop order after a mid-route addition — same nearest-neighbor
 * + 2-opt logic used when the route was first generated, just re-run on the
 * updated set. This is the "auto restructure" piece: adding a patient via
 * search or map doesn't just tack them onto the end, it re-slots everyone
 * into a sensible geographic order before recalculating real-road times.
 */
async function reorderAndRecalc() {
  if (startCoords && scheduledPatients.length > 1) {
    scheduledPatients = nearestNeighborOrder(startCoords.lat, startCoords.lng, scheduledPatients);
  }
  return await recalcAndRender();
}

window.addPatientToScheduleDirectly = async function (patientId) {
  if (!startCoords) {
    alert('Generate a route first (need a starting address set) before adding a patient directly.');
    return;
  }
  const p = patients.find(pt => pt.id === patientId);
  if (!p) return;
  if (scheduledPatients.some(sp => sp.id === patientId)) return;

  const includeRecent = document.getElementById('includeRecent').checked;
  const scheduleDate = document.getElementById('scheduleDate').value || new Date().toISOString().slice(0, 10);
  if (!includeRecent && isRecentlyVisited(p, scheduleDate)) {
    alert(`${p.name} was visited within the last 30 days. Check "Include patients visited in the last 30 days" to add them anyway.`);
    return;
  }

  scheduledPatients.push(p);
  leftoverPatients = leftoverPatients.filter(lp => lp.id !== patientId);
  document.getElementById('scheduleSearchInput').value = '';
  document.getElementById('scheduleSearchResults').style.display = 'none';
  if (leafletMap) leafletMap.closePopup();
  await reorderAndRecalc();
  setScheduleStatus(`Added ${p.name} to the route — order re-optimized, times recalculated.`, 'success');
};

window.removeFromRouteToLeftover = async function (patientId) {
  const idx = scheduledPatients.findIndex(p => p.id === patientId);
  if (idx === -1) return;
  const [removed] = scheduledPatients.splice(idx, 1);
  delete removed.manualArrivalOverride; // clear any manual time edit — it no longer applies once off the route
  leftoverPatients.push(removed);
  if (leafletMap) leafletMap.closePopup();
  await recalcAndRender();
  setScheduleStatus(`Removed ${removed.name} from the route — moved to Leftover, remaining times recalculated.`, '');
};

window.addPatientToLeftover = function (patientId) {
  const p = patients.find(pt => pt.id === patientId);
  if (!p) return;
  const alreadyScheduled = scheduledPatients.some(sp => sp.id === patientId);
  const alreadyLeftover = leftoverPatients.some(lp => lp.id === patientId);
  if (alreadyScheduled) return;

  const includeRecent = document.getElementById('includeRecent').checked;
  const scheduleDate = document.getElementById('scheduleDate').value || new Date().toISOString().slice(0, 10);
  if (!includeRecent && isRecentlyVisited(p, scheduleDate)) {
    alert(`${p.name} was visited within the last 30 days. Check "Include patients visited in the last 30 days" to add them anyway.`);
    return;
  }

  if (!alreadyLeftover) {
    p.justAdded = true;
    leftoverPatients.push(p);
  } else {
    const existing = leftoverPatients.find(lp => lp.id === patientId);
    existing.justAdded = true;
  }
  renderScheduleLists();
  if (leafletMap) leafletMap.closePopup();
};

/* ============================================
   ROUTE BUILDER (Schedule tab)
   ============================================ */
const AVG_MPH = 25; // straight-line estimate assumption for suburban driving
const START_ADDR_KEY = 'patientRouter.startAddresses.v1';
let startCoords = null;
let scheduledPatients = [];
let leftoverPatients = [];
let draggedId = null;
let draggedFrom = null;

function loadStartAddresses() {
  try {
    const raw = localStorage.getItem(START_ADDR_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function saveStartAddresses(list) {
  localStorage.setItem(START_ADDR_KEY, JSON.stringify(list));
}

function populateStartAddressSelect() {
  const sel = document.getElementById('startAddressSelect');
  if (!sel) return;
  const saved = loadStartAddresses();
  const current = sel.value;
  sel.innerHTML = '<option value="">+ Add new address...</option>' +
    saved.map(a => `<option value="${a.id}">${escapeHtml(a.label)} — ${escapeHtml(a.address)}</option>`).join('');
  if (saved.some(a => a.id === current)) sel.value = current;
  else if (saved.length) sel.value = saved[0].id;
  updateAddressFormVisibility();
}

function updateAddressFormVisibility() {
  const sel = document.getElementById('startAddressSelect');
  const form = document.getElementById('newAddressForm');
  if (sel && form) form.style.display = sel.value === '' ? 'flex' : 'none';
}

async function addStartAddress(label, address, statusEl) {
  if (!address) { if (statusEl) { statusEl.textContent = 'Enter an address to save.'; statusEl.className = 'status-line error'; } return null; }
  if (statusEl) { statusEl.textContent = 'Looking up that address...'; statusEl.className = 'status-line'; }
  try {
    const coords = await geocodeAddress(address);
    if (!coords) { if (statusEl) { statusEl.textContent = 'Could not find that address.'; statusEl.className = 'status-line error'; } return null; }
    const saved = loadStartAddresses();
    const entry = { id: 'a_' + Date.now(), label: label || 'Location', address, lat: coords.lat, lng: coords.lng };
    saved.push(entry);
    saveStartAddresses(saved);
    populateStartAddressSelect();
    if (statusEl) { statusEl.textContent = 'Address saved.'; statusEl.className = 'status-line success'; }
    return entry;
  } catch (e) {
    if (statusEl) { statusEl.textContent = 'Error looking up that address.'; statusEl.className = 'status-line error'; }
    return null;
  }
}

function deleteStartAddress(id) {
  const saved = loadStartAddresses().filter(a => a.id !== id);
  saveStartAddresses(saved);
  populateStartAddressSelect();
}

async function handleSaveNewAddress() {
  const label = document.getElementById('newAddressLabel').value.trim() || 'Home base';
  const address = document.getElementById('newAddressText').value.trim();
  const statusEl = document.getElementById('scheduleStatus');
  const entry = await addStartAddress(label, address, statusEl);
  if (entry) {
    document.getElementById('startAddressSelect').value = entry.id;
    document.getElementById('newAddressForm').style.display = 'none';
    document.getElementById('newAddressLabel').value = '';
    document.getElementById('newAddressText').value = '';
  }
}

function groupSelectOptionsHtml() {
  const groups = Array.from(new Set(getFilteredPatients().map(p => p.group).filter(Boolean))).sort();
  return '<option value="__ANY__">🔀 Closest Mix (any group)</option>' +
    groups.map(g => `<option value="${g}">Group ${g}</option>`).join('');
}

function groupOnlyOptionsHtml() {
  const groups = Array.from(new Set(getFilteredPatients().map(p => p.group).filter(Boolean))).sort();
  return '<option value="">None</option>' + groups.map(g => `<option value="${g}">Group ${g}</option>`).join('');
}

function populateGroupSelect() {
  const sel = document.getElementById('groupSelect');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = groupSelectOptionsHtml();
  const groups = Array.from(new Set(getFilteredPatients().map(p => p.group).filter(Boolean)));
  if (current && (current === '__ANY__' || groups.includes(current))) sel.value = current;

  const sel2 = document.getElementById('groupSelect2');
  if (sel2) {
    const current2 = sel2.value;
    sel2.innerHTML = groupOnlyOptionsHtml();
    if (current2 && groups.includes(current2)) sel2.value = current2;
    updateGroup2Availability();
  }
}

function updateGroup2Availability() {
  const sel = document.getElementById('groupSelect');
  const sel2 = document.getElementById('groupSelect2');
  if (!sel || !sel2) return;
  const isMix = sel.value === '__ANY__';
  sel2.disabled = isMix;
  if (isMix) sel2.value = '';
}

function milesToMinutes(miles) {
  return (miles / AVG_MPH) * 60;
}

function nearestNeighborOrder(fromLat, fromLng, list) {
  const remaining = [...list];
  const ordered = [];
  let curLat = fromLat, curLng = fromLng;
  while (remaining.length) {
    let bestIdx = 0, bestDist = Infinity;
    remaining.forEach((p, i) => {
      const d = haversineMiles(curLat, curLng, p.lat, p.lng);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    curLat = next.lat; curLng = next.lng;
  }
  return twoOptImprove(fromLat, fromLng, ordered);
}

// Orders whole location units geographically instead of individual patients
// — reuses the exact same nearest-neighbor + 2-opt engine above by feeding
// it each unit's centroid as a pseudo-point, then mapping back to the real
// units afterward. No duplicated routing logic.
function nearestNeighborOrderUnits(fromLat, fromLng, units) {
  const pseudoPoints = units.map((unit, idx) => {
    const c = unit.reduce((acc, m) => ({ lat: acc.lat + m.lat, lng: acc.lng + m.lng }), { lat: 0, lng: 0 });
    return { lat: c.lat / unit.length, lng: c.lng / unit.length, __unitIdx: idx };
  });
  const orderedPseudo = nearestNeighborOrder(fromLat, fromLng, pseudoPoints);
  return orderedPseudo.map(pp => units[pp.__unitIdx]);
}

// Packs geographically-ordered units into stop-count-sized chunks WITHOUT
// ever splitting a unit — a chunk closes out as soon as the next unit would
// push it over the cap, so a same-address group can push a single day over
// the requested size, but never gets divided across two days.
function chunkUnitsRespectingAddress(orderedUnits, stopCount) {
  const chunks = [];
  let current = [];
  orderedUnits.forEach(unit => {
    if (current.length > 0 && current.length + unit.length > stopCount) {
      chunks.push(current);
      current = [];
    }
    current = current.concat(unit);
  });
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Nearest-neighbor is greedy and near-sighted — it can walk right past a
 * stop only to have to double back for it later, which is exactly the
 * "drove past a client, had to take the road again" pattern. 2-opt fixes
 * this: repeatedly check pairs of route segments and un-cross them
 * whenever doing so shortens the total path, until no more improvements
 * are found. Standard, well-proven technique for cleaning up greedy tours.
 * Runs on straight-line distance (cheap, no extra API calls) — the actual
 * real-road times are still fetched fresh from the routing service on
 * this final, improved order.
 */
function twoOptImprove(fromLat, fromLng, list) {
  if (list.length < 3) return list;

  const legLength = (route) => {
    let total = haversineMiles(fromLat, fromLng, route[0].lat, route[0].lng);
    for (let i = 0; i < route.length - 1; i++) {
      total += haversineMiles(route[i].lat, route[i].lng, route[i + 1].lat, route[i + 1].lng);
    }
    return total;
  };

  let route = [...list];
  let improved = true;
  let guard = 0;
  while (improved && guard < 200) {
    improved = false;
    guard++;
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const candidate = route.slice(0, i).concat(route.slice(i, j + 1).reverse(), route.slice(j + 1));
        if (legLength(candidate) < legLength(route) - 1e-9) {
          route = candidate;
          improved = true;
        }
      }
    }
  }
  return route;
}

const SAME_COMPLEX_MILES = 0.03; // ~50 meters — close enough to call it the same building/complex

function isSameLocation(a, b) {
  if (!a.address || !b.address) return false;
  if (a.address.trim().toLowerCase() === b.address.trim().toLowerCase()) return true;
  if (a.lat !== null && a.lng !== null && b.lat !== null && b.lng !== null) {
    return haversineMiles(a.lat, a.lng, b.lat, b.lng) <= SAME_COMPLEX_MILES;
  }
  return false;
}

function isRecentlyVisited(patient, asOfDateStr) {
  if (!patient.lastVisitDate) return false;
  const asOf = new Date(asOfDateStr + 'T00:00:00');
  const last = new Date(patient.lastVisitDate + 'T00:00:00');
  const daysSince = Math.floor((asOf - last) / 86400000);
  return daysSince < 30;
}

/**
 * Pure route-selection core — no DOM reads, no global state writes.
 * Returns the picked patients (unordered pool selection) plus bookkeeping
 * counts. Ordering + real-road timing happens separately in recalcAndRender
 * (Daily) or computeAndOrderDay (Weekly), since both need the same logic.
 */
function selectRoutePatients({ group, group2, stopCount, startCoords, scheduleDate, includeRecent, excludeIds, routeDirection }) {
  const isMixMode = group === '__ANY__';
  const strictGroup = !isMixMode;
  const excludeSet = excludeIds || new Set();
  const targetGroups = group2 ? [group, group2] : [group];

  const allEligible = getFilteredPatients().filter(p => p.lat !== null && p.lng !== null && !excludeSet.has(p.id));
  const eligible = includeRecent ? allEligible : allEligible.filter(p => !isRecentlyVisited(p, scheduleDate));
  const excludedCount = allEligible.length - eligible.length;

  let pool;
  let fillCount = 0;
  let groupOnlyCount = 0;

  if (strictGroup) {
    const groupPatients = eligible.filter(p => targetGroups.includes(p.group));
    groupOnlyCount = groupPatients.length;
    if (groupPatients.length === 0) {
      return { error: excludedCount > 0
        ? `All patients in ${group2 ? 'those groups' : 'that group'} were visited within the last 30 days (or already used elsewhere this week). Check "Include patients visited in the last 30 days" to override.`
        : `No geocoded patients in ${group2 ? 'those groups' : 'that group'} yet.` };
    }
    pool = groupPatients;
    if (groupPatients.length < stopCount) {
      const needed = stopCount - groupPatients.length;
      const otherByDistance = eligible.filter(p => !targetGroups.includes(p.group))
        .map(p => ({ p, dist: haversineMiles(startCoords.lat, startCoords.lng, p.lat, p.lng) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, needed)
        .map(x => x.p);
      pool = groupPatients.concat(otherByDistance);
      fillCount = otherByDistance.length;
    }
  } else {
    pool = eligible;
    if (pool.length === 0) {
      return { error: excludedCount > 0
        ? `All eligible patients were visited within the last 30 days (or already used elsewhere this week). Check "Include patients visited in the last 30 days" to override.`
        : 'No geocoded patients available yet.' };
    }
  }

  const byDistance = pool
    .map(p => ({ p, dist: haversineMiles(startCoords.lat, startCoords.lng, p.lat, p.lng) }))
    .sort((a, b) => a.dist - b.dist);

  let closestN = byDistance.slice(0, stopCount).map(x => x.p);

  const addressMates = byDistance
    .map(x => x.p)
    .filter(p => !closestN.includes(p) && closestN.some(sel => isSameLocation(sel, p)));
  closestN = closestN.concat(addressMates);

  const remainder = byDistance.map(x => x.p).filter(p => !closestN.includes(p));

  // A path's total distance is identical whether driven forward or backward
  // — reversing the already-optimized order costs nothing and lets the
  // provider start far (to beat traffic) and finish near home instead.
  let ordered = nearestNeighborOrder(startCoords.lat, startCoords.lng, closestN);
  if (routeDirection === 'furthest') ordered = ordered.slice().reverse();

  return {
    scheduled: ordered,
    leftover: remainder,
    excludedCount, fillCount, groupOnlyCount,
    addressMateCount: addressMates.length,
    strictGroup
  };
}

/**
 * Reusable per-day timing calculator — same logic as recalcAndRender's loop,
 * but returns a plain snapshot instead of mutating global state, so both
 * Daily's live editor and Weekly's multi-day batch can share it safely.
 */
async function computeTimingForDay(startCoords, orderedPatients, startTimeStr, defaultVisitDuration) {
  if (orderedPatients.length === 0) {
    return { stops: [], totalHours: 0, usingRealRoads: false, dayStartMinutes: 0, returnHomeMinutes: 0 };
  }
  const [h, m] = startTimeStr.split(':').map(Number);
  let cursorMinutes = h * 60 + m;
  const dayStartMinutes = cursorMinutes;

  const legsResult = await fetchRouteLegs(startCoords.lat, startCoords.lng, orderedPatients);
  const legs = legsResult ? legsResult.legs : null;
  const usingRealRoads = !!legs;

  let prevLat = startCoords.lat, prevLng = startCoords.lng, prevPatient = null;
  const stops = [];
  orderedPatients.forEach((p, i) => {
    const sameAsPrev = prevPatient && isSameLocation(prevPatient, p);
    let travelMinutes = 0, travelMiles = 0;
    if (!sameAsPrev) {
      if (legs && legs[i]) {
        travelMinutes = legs[i].minutes;
        travelMiles = legs[i].miles;
      } else {
        travelMiles = haversineMiles(prevLat, prevLng, p.lat, p.lng);
        travelMinutes = milesToMinutes(travelMiles);
      }
      cursorMinutes += travelMinutes;
    }
    const arrivalMinutes = p.manualArrivalOverride != null ? Math.max(cursorMinutes, p.manualArrivalOverride) : cursorMinutes;
    cursorMinutes = arrivalMinutes;
    const duration = p.visitDuration || defaultVisitDuration;
    cursorMinutes += duration;
    stops.push({ id: p.id, name: p.name, dob: p.dob, address: p.address, provider: p.provider, group: p.group, lat: p.lat, lng: p.lng, arrivalMinutes, travelMinutes, travelMiles, manualArrivalOverride: p.manualArrivalOverride });
    prevLat = p.lat; prevLng = p.lng; prevPatient = p;
  });

  let returnTripMinutes = 0;
  let returnTripMiles = 0;
  if (legs && legs[legs.length - 1]) {
    returnTripMinutes = legs[legs.length - 1].minutes;
    returnTripMiles = legs[legs.length - 1].miles;
  } else {
    const last = orderedPatients[orderedPatients.length - 1];
    returnTripMiles = haversineMiles(last.lat, last.lng, startCoords.lat, startCoords.lng);
    returnTripMinutes = milesToMinutes(returnTripMiles);
  }
  const returnHomeMinutes = cursorMinutes + returnTripMinutes;
  const totalHours = (returnHomeMinutes - dayStartMinutes) / 60;

  return { stops, totalHours, usingRealRoads, dayStartMinutes, returnHomeMinutes, returnTripMinutes, returnTripMiles };
}

/**
 * Wraps computeTimingForDay with an optional "be home by X" cap. If the
 * full list already fits, this is a no-op pass-through. If not, it drops
 * whole address units from the end (never splitting a same-address cluster)
 * until the day fits — and if even the smallest unavoidable unit alone
 * exceeds the target, keeps it whole anyway and flags the exception rather
 * than either splitting a household or silently excluding it.
 */
async function trimStopsToReturnTime(startCoords, orderedPatients, startTimeStr, defaultVisitDuration, returnTimeMinutes) {
  let timing = await computeTimingForDay(startCoords, orderedPatients, startTimeStr, defaultVisitDuration);
  if (!returnTimeMinutes || orderedPatients.length === 0 || timing.returnHomeMinutes <= returnTimeMinutes) {
    return { ...timing, trimmedCount: 0, returnTimeException: false };
  }

  const units = buildLocationUnits(orderedPatients);
  let keepUnits = [...units];
  let exception = false;
  while (keepUnits.length > 0) {
    const flatStops = keepUnits.flat();
    const check = await computeTimingForDay(startCoords, flatStops, startTimeStr, defaultVisitDuration);
    if (check.returnHomeMinutes <= returnTimeMinutes) { timing = check; break; }
    if (keepUnits.length === 1) { timing = check; exception = true; break; }
    keepUnits = keepUnits.slice(0, -1);
  }

  const trimmedCount = orderedPatients.length - timing.stops.length;
  return { ...timing, trimmedCount, returnTimeException: exception };
}

/* ============================================
   WEEKLY SCHEDULING MODE
   ============================================ */
const WEEK_DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const STANDARD_WORK_DAYS_KEY = 'patientRouter.standardWorkDays.v1'; // array of 5 booleans, Mon..Fri

function loadStandardWorkDays() {
  try {
    const raw = localStorage.getItem(STANDARD_WORK_DAYS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through to default */ }
  return [true, true, true, true, true]; // default: every weekday is a standard work day until they say otherwise
}
function saveStandardWorkDays(arr) {
  localStorage.setItem(STANDARD_WORK_DAYS_KEY, JSON.stringify(arr));
}
let standardWorkDays = loadStandardWorkDays();
let weekResults = []; // populated after Generate Week — array of {date, dayLabel, group, stopCount, stops, error, totalHours, usingRealRoads}
let weekStartCoordsGlobal = null;

/* ============================================
   WEEKLY UNDO (mirrors the Monthly undo system exactly)
   ============================================ */
let weekUndoStack = [];
let weekGenerationSnapshot = null;
const WEEK_UNDO_MAX = 100;

function snapshotWeekState() {
  return { weekResults: structuredClone(weekResults) };
}

function pushWeekUndoSnapshot() {
  weekUndoStack.push(snapshotWeekState());
  if (weekUndoStack.length > WEEK_UNDO_MAX) weekUndoStack.shift();
  updateWeekUndoButtons();
}

function updateWeekUndoButtons() {
  const undoBtn = document.getElementById('undoWeekBtn');
  const undoAllBtn = document.getElementById('undoAllWeekBtn');
  if (undoBtn) undoBtn.disabled = weekUndoStack.length === 0;
  if (undoAllBtn) undoAllBtn.disabled = !weekGenerationSnapshot || weekUndoStack.length === 0;
}

window.undoWeekChange = function () {
  if (weekUndoStack.length === 0) return;
  const snapshot = weekUndoStack.pop();
  weekResults = snapshot.weekResults;
  renderWeekResults();
  updateWeekUndoButtons();
  setWeekStatus('Undid last change.', '');
};

window.undoAllWeekChanges = function () {
  if (!weekGenerationSnapshot) return;
  weekResults = structuredClone(weekGenerationSnapshot.weekResults);
  weekUndoStack = [];
  renderWeekResults();
  updateWeekUndoButtons();
  setWeekStatus('Reverted every change back to right after generation.', '');
};

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow; // shift back to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

function renderWeekDayCards() {
  const container = document.getElementById('weekDayCards');
  const startInput = document.getElementById('weekStartDate');
  if (!startInput.value) {
    const today = new Date();
    startInput.value = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  }
  const monday = mondayOf(startInput.value);

  let html = '';
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    const isStandardOff = !standardWorkDays[i];

    html += `
      <div class="week-day-card${isStandardOff ? ' wdc-off' : ''}" data-day-index="${i}">
        <h4>${WEEK_DAY_LABELS[i]}</h4>
        <div class="wdc-date">${dateStr}</div>
        ${isStandardOff ? `
          <p class="wdc-off-label">Not in Service</p>
          <label class="wdc-override-check">
            <input type="checkbox" class="wdc-work-anyway"> Work this day anyway
          </label>
          <div class="wdc-fields" style="display:none;">
            <select class="wdc-group">${groupSelectOptionsHtml()}</select>
            <select class="wdc-group2"><option value="">+ Also include (optional)</option>${groupSelectOptionsHtml()}</select>
            <input type="number" class="wdc-count" min="1" value="8" placeholder="Stops">
          </div>
        ` : `
          <div class="wdc-fields">
            <select class="wdc-group">${groupSelectOptionsHtml()}</select>
            <select class="wdc-group2"><option value="">+ Also include (optional)</option>${groupSelectOptionsHtml()}</select>
            <input type="number" class="wdc-count" min="1" value="8" placeholder="Stops">
          </div>
        `}
      </div>
    `;
  }
  container.innerHTML = html;

  container.querySelectorAll('.wdc-work-anyway').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const card = e.target.closest('.week-day-card');
      card.querySelector('.wdc-fields').style.display = e.target.checked ? 'block' : 'none';
    });
  });
}

function syncWorkDayCheckboxesUI() {
  document.querySelectorAll('.workDayToggle').forEach(cb => {
    const idx = parseInt(cb.getAttribute('data-day'), 10);
    cb.checked = standardWorkDays[idx];
  });
}

function populateWeekStartAddressSelect() {
  const sel = document.getElementById('weekStartAddressSelect');
  const saved = loadStartAddresses();
  sel.innerHTML = saved.length
    ? saved.map(a => `<option value="${a.id}">${escapeHtml(a.label)} — ${escapeHtml(a.address)}</option>`).join('')
    : '<option value="">No saved address — add one on the Daily tab first</option>';
}

async function generateWeek() {
  const startAddrId = document.getElementById('weekStartAddressSelect').value;
  if (!startAddrId) { setWeekStatus('Pick a starting address first (add one on the Daily tab if needed).', 'error'); return; }
  const saved = loadStartAddresses().find(a => a.id === startAddrId);
  if (!saved) { setWeekStatus('That saved address could not be found.', 'error'); return; }
  const weekStartCoords = { lat: saved.lat, lng: saved.lng };
  weekStartCoordsGlobal = weekStartCoords;

  const startTime = document.getElementById('weekStartTime').value || '08:00';
  const returnTimeStr = document.getElementById('weekReturnTime').value;
  const returnTimeMinutes = returnTimeStr ? timeInputValueToMinutes(returnTimeStr) : null;
  const visitDuration = parseFloat(document.getElementById('weekVisitDuration').value) || 15;
  const includeRecent = document.getElementById('weekIncludeRecent').checked;
  const routeDirection = document.getElementById('weekRouteDirection').value;
  const monday = mondayOf(document.getElementById('weekStartDate').value);

  const genBtn = document.getElementById('generateWeekBtn');
  genBtn.disabled = true;
  genBtn.textContent = '⏳ Generating 5 days (this takes a bit longer)...';
  setWeekStatus('Working through Monday–Friday, one real-road route at a time...', '');

  weekResults = [];
  const usedThisWeek = new Set();

  try {
    const dayCards = document.querySelectorAll('.week-day-card');
    for (let i = 0; i < dayCards.length; i++) {
      const card = dayCards[i];
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = dateKey(d.getFullYear(), d.getMonth(), d.getDate());

      const isStandardOff = !standardWorkDays[i];
      const workAnywayCb = card.querySelector('.wdc-work-anyway');
      const workingToday = !isStandardOff || (workAnywayCb && workAnywayCb.checked);

      if (!workingToday) {
        weekResults.push({ date: dateStr, dayLabel: WEEK_DAY_LABELS[i], offDay: true });
        continue;
      }

      const group = card.querySelector('.wdc-group').value;
      const group2Raw = card.querySelector('.wdc-group2').value;
      const group2 = (group2Raw && group2Raw !== group) ? group2Raw : null;
      const stopCount = parseInt(card.querySelector('.wdc-count').value, 10) || 0;

      setWeekStatus(`Generating ${WEEK_DAY_LABELS[i]} (${i + 1} of 5)...`, '');

      const selection = selectRoutePatients({
        group, group2, stopCount, startCoords: weekStartCoords, scheduleDate: dateStr, includeRecent, excludeIds: usedThisWeek, routeDirection
      });

      if (selection.error) {
        weekResults.push({ date: dateStr, dayLabel: WEEK_DAY_LABELS[i], group, group2, stopCount, error: selection.error });
        continue;
      }

      const timing = await trimStopsToReturnTime(weekStartCoords, selection.scheduled, startTime, visitDuration, returnTimeMinutes);
      timing.stops.forEach(s => usedThisWeek.add(s.id));

      weekResults.push({
        date: dateStr, dayLabel: WEEK_DAY_LABELS[i], group, group2, stopCount, routeDirection,
        stops: timing.stops, totalHours: timing.totalHours, usingRealRoads: timing.usingRealRoads,
        fillCount: selection.fillCount, excludedCount: selection.excludedCount,
        dayStartMinutes: timing.dayStartMinutes, returnHomeMinutes: timing.returnHomeMinutes,
        returnTripMinutes: timing.returnTripMinutes, returnTripMiles: timing.returnTripMiles,
        returnTimeTarget: returnTimeMinutes, returnTimeException: timing.returnTimeException, returnTimeTrimmedCount: timing.trimmedCount
      });
    }

    renderWeekResults();
    const successDays = weekResults.filter(d => !d.error && !d.offDay).length;
    setWeekStatus(`Generated ${successDays} of 5 days. Review below, then Approve Whole Week.`, 'success');
    document.getElementById('approveWeekBtn').style.display = weekResults.some(d => !d.error) ? 'inline-block' : 'none';
    weekGenerationSnapshot = snapshotWeekState();
    weekUndoStack = [];
    updateWeekUndoButtons();
  } catch (e) {
    console.error('generateWeek failed', e);
    setWeekStatus('Something went wrong generating the week. Try again.', 'error');
  } finally {
    genBtn.disabled = false;
    genBtn.textContent = 'Generate Week';
  }
}

window.openWeekDayInGoogleMaps = function (dayIdx) {
  const day = weekResults[dayIdx];
  if (!day || !day.stops || day.stops.length === 0 || !weekStartCoordsGlobal) {
    alert('No stops to map for this day.');
    return;
  }
  if (day.stops.length > 23) {
    alert('Google Maps supports up to ~23 stops in one link — this day has more. Split it or use My Maps export instead.');
    return;
  }
  const origin = `${weekStartCoordsGlobal.lat},${weekStartCoordsGlobal.lng}`;
  const last = day.stops[day.stops.length - 1];
  const destination = `${last.lat},${last.lng}`;
  const waypointStops = day.stops.slice(0, -1);
  const waypoints = waypointStops.map(s => `${s.lat},${s.lng}`).join('|');
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
  window.open(url, '_blank');
};

function renderWeekResults() {
  const container = document.getElementById('weekResults');
  container.innerHTML = weekResults.map((day, dayIdx) => {
    if (day.offDay) {
      return `
        <div class="week-result-card wrc-off">
          <h3>${day.dayLabel} — ${day.date}</h3>
          <p class="wrc-meta">Not in Service — no route generated.</p>
        </div>
      `;
    }
    if (day.error) {
      return `
        <div class="week-result-card wrc-error">
          <h3>${day.dayLabel} — ${day.date}</h3>
          <p class="wrc-meta" style="color:var(--pink-deep);">${escapeHtml(day.error)}</p>
        </div>
      `;
    }
    const fillNote = day.fillCount > 0 ? ` — ${day.fillCount} pulled from nearby groups to fill the count` : '';
    const excludedNote = day.excludedCount > 0 ? ` — ${day.excludedCount} excluded (visited &lt;30 days)` : '';
    const returnTimeNote = day.returnTimeException ? `
      <div style="margin-top:10px; padding:10px; border-radius:var(--radius-sm); border:1px solid var(--pink-deep); background:rgba(238,126,171,0.1);">
        <p style="margin:0; font-size:0.85rem; color:var(--pink-deep); font-weight:700;">‼️ Today you'll be home past ${minutesToClock(day.returnTimeTarget)} — everyone at one address had to stay together and alone that visit runs past your target return time.</p>
      </div>
    ` : (day.returnTimeTrimmedCount > 0 ? `
      <p class="card-subtitle" style="color:var(--peach-deep);">⏱️ ${day.returnTimeTrimmedCount} patient(s) held back to make your ${minutesToClock(day.returnTimeTarget)} return time — still due, pick them up another day.</p>
    ` : '');
    const totalMiles = day.stops.reduce((sum, s) => sum + (s.travelMiles || 0), 0) + (day.returnTripMiles || 0);
    return `
      <div class="week-result-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
          <h3>${day.dayLabel} — ${day.date}</h3>
          <button type="button" class="btn-tiny" onclick="window.openWeekDayInGoogleMaps(${dayIdx})">🗺️ Open in Google Maps</button>
          <button type="button" class="btn-tiny" onclick="window.openDayReviewModal('week', ${dayIdx})">📍 See Map View</button>
        </div>
        <p class="card-subtitle" style="margin:6px 0;">
          Group ${escapeHtml(day.group === '__ANY__' ? 'Closest Mix' : day.group)}${day.group2 ? ` + ${escapeHtml(day.group2)}` : ''}${fillNote}${excludedNote}
        </p>
        <div class="route-summary" style="margin:10px 0;">
          <span class="rs-item"><span class="rs-label">Start:</span> Home ${minutesToClock(day.dayStartMinutes)}</span>
          <span class="rs-item"><span class="rs-label">Return trip:</span> 🚗 ${Math.round(day.returnTripMinutes)} min / ${day.returnTripMiles.toFixed(1)} mi</span>
          <span class="rs-item"><span class="rs-label">Arrive home:</span> ${minutesToClock(day.returnHomeMinutes)}</span>
          <span class="rs-item"><span class="rs-label">Stops:</span> ${day.stops.length}</span>
          <span class="rs-item"><span class="rs-label">Total hrs:</span> ${day.totalHours.toFixed(1)}</span>
          <span class="rs-item"><span class="rs-label">Total miles:</span> ${totalMiles.toFixed(1)} mi</span>
          <span class="rs-item" style="color:${day.usingRealRoads ? 'var(--lime-deep)' : 'var(--pink-deep)'};">${day.usingRealRoads ? '✓ real road times' : '⚠ straight-line estimate'}</span>
        </div>
        ${returnTimeNote}
        <p class="card-subtitle" style="margin-bottom:8px;">Drag a patient to another day's card to move them — group, remove, and time are all editable right here.</p>
        <div class="week-card-droplist" data-day-idx="${dayIdx}">
          ${day.stops.map((s, i) => {
            const idleMin = idleGapBeforeStop(day.stops, i, parseFloat(document.getElementById('weekVisitDuration').value) || 15);
            const idleRow = idleMin > 0 ? `<div class="idle-gap-row">⏱️ Idle: ${idleMin} min — room to add someone here</div>` : '';
            return `
            ${idleRow}
            <div class="week-stop-row week-card-stop" draggable="true" data-day-idx="${dayIdx}" data-patient-id="${s.id}" style="flex-direction:column; align-items:stretch; gap:6px; cursor:grab;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                <span>⠿⠿ #${i + 1} ${escapeHtml(s.name)}</span>
                <span>${minutesToClock(s.arrivalMinutes)}${s.manualArrivalOverride != null ? ' <span style="color:var(--pink-deep); font-weight:700; font-size:0.75em;">(edited)</span>' : ''}</span>
              </div>
              <div draggable="false" style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                <select class="week-card-group-sel" data-day-idx="${dayIdx}" data-patient-id="${s.id}" style="font-size:0.78rem; padding:3px 6px; max-width:110px;">
                  ${availableGroupLetters().map(l => `<option value="${l}" ${s.group === l ? 'selected' : ''}>Group ${l}</option>`).join('')}
                </select>
                <div style="display:flex; gap:4px;">
                  <button type="button" class="btn-tiny" onclick="window.openEditArrivalWeekCard(${dayIdx}, '${s.id}')">✏️ Time</button>
                  <button type="button" class="btn-tiny btn-tiny-danger" onclick="window.removeWeekCardStop(${dayIdx}, '${s.id}')">✖ Remove</button>
                </div>
              </div>
            </div>
          `; }).join('')}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.week-card-group-sel').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const dayIdx = parseInt(e.target.getAttribute('data-day-idx'), 10);
      window.changeWeekCardStopGroup(dayIdx, e.target.getAttribute('data-patient-id'), e.target.value);
    });
  });

  attachWeekCardDragHandlers();
}

function setWeekStatus(msg, kind) {
  const el = document.getElementById('weekStatus');
  el.textContent = msg;
  el.className = 'status-line' + (kind ? ' ' + kind : '');
}

let weekCardDraggedId = null;
let weekCardDraggedFromDay = null;
let weekCardDragBusy = false;

function attachWeekCardDragHandlers() {
  document.querySelectorAll('.week-card-stop').forEach(row => {
    row.addEventListener('dragstart', () => {
      weekCardDraggedId = row.getAttribute('data-patient-id');
      weekCardDraggedFromDay = parseInt(row.getAttribute('data-day-idx'), 10);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
  });

  document.querySelectorAll('.week-card-droplist').forEach(zone => {
    zone.addEventListener('dragover', (e) => e.preventDefault());
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetDayIdx = parseInt(zone.getAttribute('data-day-idx'), 10);
      await handleWeekCardDrop(targetDayIdx, zone, e.clientY);
    });
  });
}

async function recomputeWeekDay(dayIdx) {
  const day = weekResults[dayIdx];
  if (!day) return;
  const startCoords = weekStartCoordsGlobal;
  const startTime = document.getElementById('weekStartTime').value || '08:00';
  const visitDuration = parseFloat(document.getElementById('weekVisitDuration').value) || 15;

  if (day.stops.length === 0) {
    day.totalHours = 0;
    return;
  }
  const timing = await computeTimingForDay(startCoords, day.stops, startTime, visitDuration);
  day.stops = timing.stops;
  day.totalHours = timing.totalHours;
  day.usingRealRoads = timing.usingRealRoads;
  day.dayStartMinutes = timing.dayStartMinutes;
  day.returnHomeMinutes = timing.returnHomeMinutes;
  day.returnTripMinutes = timing.returnTripMinutes;
  day.returnTripMiles = timing.returnTripMiles;
}

async function handleWeekCardDrop(targetDayIdx, zoneEl, dropClientY) {
  if (weekCardDragBusy) return;
  if (weekCardDraggedId === null || weekCardDraggedFromDay === null) return;

  pushWeekUndoSnapshot();

  if (weekCardDraggedFromDay === targetDayIdx) {
    const day = weekResults[targetDayIdx];
    if (!day || !day.stops) { weekCardDraggedId = null; weekCardDraggedFromDay = null; return; }
    const originalIdx = day.stops.findIndex(s => s.id === weekCardDraggedId);
    if (originalIdx === -1) { weekCardDraggedId = null; weekCardDraggedFromDay = null; return; }

    const [moved] = day.stops.splice(originalIdx, 1);
    const items = zoneEl ? Array.from(zoneEl.querySelectorAll('.week-card-stop')) : [];
    let insertAt = day.stops.length;
    if (zoneEl && dropClientY != null) {
      for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        if (dropClientY < rect.top + rect.height / 2) { insertAt = i; break; }
      }
    }
    day.stops.splice(insertAt, 0, moved);

    weekCardDragBusy = true;
    setWeekStatus('⏳ Recalculating...', '');
    try {
      await recomputeWeekDay(targetDayIdx);
      const visitDuration = parseFloat(document.getElementById('weekVisitDuration').value) || 15;
      await checkAndHandleAnchorOverflow(
        day.stops,
        async () => {
          const idxNow = day.stops.findIndex(s => s.id === moved.id);
          if (idxNow !== -1) day.stops.splice(idxNow, 1);
          day.stops.splice(originalIdx, 0, moved);
          await recomputeWeekDay(targetDayIdx);
        }
      );
      renderWeekResults();
      setWeekStatus('Reordered — times recalculated.', 'success');
    } catch (e) {
      console.error('handleWeekCardDrop (same-day) failed', e);
      setWeekStatus(`Something went wrong reordering: ${e.message || e}`, 'error');
    } finally {
      weekCardDragBusy = false;
      weekCardDraggedId = null;
      weekCardDraggedFromDay = null;
    }
    return;
  }

  const fromDay = weekResults[weekCardDraggedFromDay];
  const toDay = weekResults[targetDayIdx];
  if (!fromDay || !toDay || !fromDay.stops || !toDay.stops) { weekCardDraggedId = null; weekCardDraggedFromDay = null; return; }

  const idx = fromDay.stops.findIndex(s => s.id === weekCardDraggedId);
  if (idx === -1) { weekCardDraggedId = null; weekCardDraggedFromDay = null; return; }

  weekCardDragBusy = true;
  setWeekStatus('⏳ Moving patient and recalculating both days...', '');
  try {
    const [moved] = fromDay.stops.splice(idx, 1);
    await recomputeWeekDay(weekCardDraggedFromDay);

    const startCoords = weekStartCoordsGlobal;
    let newOrder = nearestNeighborOrder(startCoords.lat, startCoords.lng, toDay.stops.concat([moved]));
    if (toDay.routeDirection === 'furthest') newOrder = newOrder.slice().reverse();
    toDay.stops = newOrder;
    await recomputeWeekDay(targetDayIdx);

    await checkAndHandleAnchorOverflow(
      toDay.stops,
      async () => {
        toDay.stops = toDay.stops.filter(s => s.id !== moved.id);
        fromDay.stops.push(moved);
        await recomputeWeekDay(targetDayIdx);
        await recomputeWeekDay(weekCardDraggedFromDay);
      }
    );

    renderWeekResults();
    setWeekStatus('Moved — both days recalculated.', 'success');
  } catch (e) {
    console.error('handleWeekCardDrop (cross-day) failed', e);
    setWeekStatus(`Something went wrong moving that patient: ${e.message || e}`, 'error');
  } finally {
    weekCardDragBusy = false;
    weekCardDraggedId = null;
    weekCardDraggedFromDay = null;
  }
}

window.changeWeekCardStopGroup = function (dayIdx, patientId, newGroup) {
  const day = weekResults[dayIdx];
  if (!day || !day.stops) return;
  const stop = day.stops.find(s => s.id === patientId);
  if (!stop) return;
  pushWeekUndoSnapshot();
  stop.group = newGroup;
  const master = patients.find(p => p.id === patientId);
  if (master) { master.manualGroup = true; master.group = newGroup; savePatients(); }
};

window.removeWeekCardStop = async function (dayIdx, patientId) {
  const day = weekResults[dayIdx];
  if (!day || !day.stops) return;
  if (!day.stops.some(s => s.id === patientId)) return;
  pushWeekUndoSnapshot();
  day.stops = day.stops.filter(s => s.id !== patientId);

  weekCardDragBusy = true;
  setWeekStatus('⏳ Recalculating this day...', '');
  try {
    await recomputeWeekDay(dayIdx);
    renderWeekResults();
    setWeekStatus('Removed — day recalculated.', 'success');
  } finally {
    weekCardDragBusy = false;
  }
};

window.openEditArrivalWeekCard = function (dayIdx, patientId) {
  const day = weekResults[dayIdx];
  if (!day || !day.stops) return;
  const p = day.stops.find(s => s.id === patientId);
  if (!p || p.arrivalMinutes === undefined) return;
  pendingArrivalEdit = { context: 'weekcard', patientId, dayIdx };

  document.getElementById('editArrivalSubtitle').textContent = `${p.name} — adjust arrival time for this day.`;
  document.getElementById('editArrivalInput').value = minutesToTimeInputValue(p.arrivalMinutes);
  document.getElementById('editArrivalNote').textContent = 'Every patient scheduled after this one that day will shift by the same amount.';
  document.getElementById('editArrivalNote').className = 'status-line';
  document.getElementById('editArrivalResetBtn').style.display = 'none';
  document.getElementById('editArrivalModal').style.display = 'flex';
};

/**
 * Detects a patient already approved on a DIFFERENT date than the one
 * about to be approved — the exact gap that let a patient get scheduled
 * on both the 16th and 17th with no warning. excludeDates lets a whole
 * week's worth of target dates all be excluded at once (so approving
 * Mon-Fri together doesn't flag patients against each other within that
 * same batch — only against dates outside it).
 */
function findDoubleBookedPatients(patientList, excludeDates) {
  const schedules = loadSchedules();
  const excludeSet = new Set(excludeDates);
  const conflicts = [];
  patientList.forEach(p => {
    Object.keys(schedules).forEach(dateStr => {
      if (excludeSet.has(dateStr)) return;
      if (schedules[dateStr].some(entry => entry.id === p.id)) {
        conflicts.push({ name: p.name, date: dateStr });
      }
    });
  });
  return conflicts;
}

function approveWeek() {
  const datesToApprove = weekResults
    .filter(d => !d.offDay && !d.error && d.stops && d.stops.length > 0)
    .map(d => d.date);
  const conflicts = datesWithExistingSchedule(datesToApprove);

  const proceedPastOverwriteCheck = () => {
    if (conflicts.length > 0) {
      showOverwriteConfirm(
        `${conflicts.length} day(s) this week already have an approved schedule (${conflicts.join(', ')}). Continuing will overwrite those days' patient lists on the calendar — the prior schedule for those specific dates will be replaced, not merged. Continue?`,
        commitApproveWeek
      );
    } else {
      commitApproveWeek();
    }
  };

  const allPatientsThisWeek = weekResults
    .filter(d => !d.offDay && !d.error && d.stops)
    .flatMap(d => d.stops);
  const doubleBooked = findDoubleBookedPatients(allPatientsThisWeek, datesToApprove);

  if (doubleBooked.length > 0) {
    const list = doubleBooked.map(c => `${c.name} (already on ${c.date})`).join(', ');
    showOverwriteConfirm(
      `⚠️ ${doubleBooked.length} patient(s) already have an approved visit on a different date: ${list}. Approving this week will schedule them again — their "last visit" will reflect whichever date is most recent. Continue?`,
      proceedPastOverwriteCheck
    );
  } else {
    proceedPastOverwriteCheck();
  }
}

function commitApproveWeek() {
  let totalApproved = 0;
  weekResults.forEach(day => {
    if (day.offDay || day.error || !day.stops || day.stops.length === 0) return;
    recordApprovedSchedule(day.date, day.stops);
    day.stops.forEach(s => recomputeLastVisitDate(s.id));
    totalApproved += day.stops.length;
  });
  savePatients();
  renderTable();
  setWeekStatus(`Approved the week — ${totalApproved} patient visit(s) across the days that generated successfully. Check the Home tab calendar.`, 'success');
  document.getElementById('approveWeekBtn').style.display = 'none';
}

function cancelWeek() {
  weekResults = [];
  weekUndoStack = [];
  weekGenerationSnapshot = null;
  document.getElementById('weekResults').innerHTML = '';
  document.getElementById('approveWeekBtn').style.display = 'none';
  updateWeekUndoButtons();
  setWeekStatus('Week cleared.', '');
}

/* ============================================
   ADMIN TAB
   ============================================ */
const PRACTITIONER_INFO_KEY = 'patientRouter.practitionerInfo.v1';

function loadPractitionerInfo() {
  try {
    const raw = localStorage.getItem(PRACTITIONER_INFO_KEY);
    return raw ? JSON.parse(raw) : { name: '', phone: '', email: '' };
  } catch (e) { return { name: '', phone: '', email: '' }; }
}

function populateAdminTab() {
  const info = loadPractitionerInfo();
  document.getElementById('adminPractitionerName').value = info.name || '';
  document.getElementById('adminPractitionerPhone').value = info.phone || '';
  document.getElementById('adminPractitionerEmail').value = info.email || '';

  const sel = document.getElementById('themeSelect');
  if (sel) sel.value = document.documentElement.getAttribute('data-theme') || 'light';

  renderAdminAddressList();
}

function renderAdminAddressList() {
  const addrList = document.getElementById('adminAddressList');
  const saved = loadStartAddresses();
  addrList.innerHTML = saved.length === 0
    ? '<p class="status-line">No saved addresses yet — add one below.</p>'
    : saved.map(a => `
        <div class="search-result-row">
          <span>${escapeHtml(a.label)} — ${escapeHtml(a.address)}</span>
          <button type="button" class="btn-tiny btn-tiny-danger" onclick="window.deleteAdminAddress('${a.id}')">✖ Remove</button>
        </div>
      `).join('');
}

window.deleteAdminAddress = function (id) {
  if (!confirm('Remove this starting address?')) return;
  deleteStartAddress(id);
  renderAdminAddressList();
};

function wireAdminTab() {
  document.getElementById('themeSelect').addEventListener('change', (e) => applyTheme(e.target.value));
  document.getElementById('adminSaveInfoBtn').addEventListener('click', () => {
    const info = {
      name: document.getElementById('adminPractitionerName').value.trim(),
      phone: document.getElementById('adminPractitionerPhone').value.trim(),
      email: document.getElementById('adminPractitionerEmail').value.trim()
    };
    localStorage.setItem(PRACTITIONER_INFO_KEY, JSON.stringify(info));
    const status = document.getElementById('adminInfoStatus');
    status.textContent = 'Saved.';
    status.className = 'status-line success';
  });
  document.getElementById('adminAddAddressBtn').addEventListener('click', async () => {
    const label = document.getElementById('adminNewAddressLabel').value.trim();
    const address = document.getElementById('adminNewAddressText').value.trim();
    const statusEl = document.getElementById('adminAddressStatus');
    const entry = await addStartAddress(label, address, statusEl);
    if (entry) {
      document.getElementById('adminNewAddressLabel').value = '';
      document.getElementById('adminNewAddressText').value = '';
      renderAdminAddressList();
    }
  });
  document.getElementById('recalcLastVisitBtn').addEventListener('click', () => {
    const changed = recomputeAllLastVisitDates();
    renderTable();
    if (clientsMap) renderClientsMap();
    const status = document.getElementById('recalcLastVisitStatus');
    status.textContent = changed > 0
      ? `Done — corrected ${changed} patient(s) to match their actual schedule history.`
      : 'Done — everyone already matched their actual schedule history, nothing to fix.';
    status.className = 'status-line success';
  });
}

function switchScheduleMode(mode) {
  document.getElementById('scheduleModeDaily').style.display = mode === 'daily' ? 'block' : 'none';
  document.getElementById('scheduleModeWeekly').style.display = mode === 'weekly' ? 'block' : 'none';
  document.getElementById('scheduleModeMonthly').style.display = mode === 'monthly' ? 'block' : 'none';
  document.getElementById('dailyModeBtn').classList.toggle('active', mode === 'daily');
  document.getElementById('weeklyModeBtn').classList.toggle('active', mode === 'weekly');
  document.getElementById('monthlyModeBtn').classList.toggle('active', mode === 'monthly');
  if (mode === 'weekly') {
    populateWeekStartAddressSelect();
    syncWorkDayCheckboxesUI();
    renderWeekDayCards();
  }
  if (mode === 'monthly') {
    populateMonthStartAddressSelect();
    document.getElementById('monthGroupSelect').innerHTML = groupSelectOptionsHtml();
    const monthInput = document.getElementById('monthPicker');
    if (!monthInput.value) {
      const today = new Date();
      monthInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    }
    renderMonthWeekPatternRows();
  }
}

function wireWeeklyUI() {
  document.getElementById('dailyModeBtn').addEventListener('click', () => switchScheduleMode('daily'));
  document.getElementById('weeklyModeBtn').addEventListener('click', () => switchScheduleMode('weekly'));
  document.getElementById('weekStartDate').addEventListener('change', renderWeekDayCards);
  document.getElementById('generateWeekBtn').addEventListener('click', generateWeek);
  document.getElementById('approveWeekBtn').addEventListener('click', approveWeek);
  document.getElementById('cancelWeekBtn').addEventListener('click', cancelWeek);
  document.getElementById('undoWeekBtn').addEventListener('click', window.undoWeekChange);
  document.getElementById('undoAllWeekBtn').addEventListener('click', window.undoAllWeekChanges);

  document.querySelectorAll('.workDayToggle').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-day'), 10);
      standardWorkDays[idx] = e.target.checked;
      saveStandardWorkDays(standardWorkDays);
      renderWeekDayCards();
    });
  });
}

/* ============================================
   MONTHLY SCHEDULING MODE
   Unlike Weekly's per-day cards (fine for 5 days, unusable for 20+), Monthly
   takes the WHOLE eligible group, orders it geographically from the start
   address (same nearest-neighbor + 2-opt logic used everywhere else), then
   chunks that ordered list into stop-count-sized pieces — one per working
   day. Consecutive chunks of a geographically-ordered list are naturally
   near each other, so this keeps nearby patients on the same or adjacent
   days without needing a more complex clustering pass.
   ============================================ */
let monthResults = []; // [{date, stops, totalHours, usingRealRoads, emptyGroup?, addressOverride?, stopCount}]
let monthAcknowledgedOverCapacity = new Set(); // dayIdx values the user has confirmed are okay to approve as-is
let monthAcknowledgedReturnTimeException = new Set(); // dayIdx values acknowledged for running past the return-time target
let monthStartCoordsGlobal = null;

/* ============================================
   MONTHLY UNDO
   Every edit action (drag, remove, group-change, time-edit, Day Review
   confirm) snapshots the month BEFORE it changes anything. Undo pops the
   most recent snapshot back; Undo All jumps straight to the state captured
   right after Generate Month finished, no matter how many edits happened
   since — both work off plain deep copies, nothing fancy or diff-based.
   ============================================ */
let monthUndoStack = [];
let monthGenerationSnapshot = null;
const MONTH_UNDO_MAX = 100;

function snapshotMonthState() {
  return {
    monthResults: structuredClone(monthResults),
    acknowledged: new Set(monthAcknowledgedOverCapacity),
    acknowledgedReturnTime: new Set(monthAcknowledgedReturnTimeException)
  };
}

function pushMonthUndoSnapshot() {
  monthUndoStack.push(snapshotMonthState());
  if (monthUndoStack.length > MONTH_UNDO_MAX) monthUndoStack.shift();
  updateMonthUndoButtons();
}

function updateMonthUndoButtons() {
  const undoBtn = document.getElementById('undoMonthBtn');
  const undoAllBtn = document.getElementById('undoAllMonthBtn');
  if (undoBtn) undoBtn.disabled = monthUndoStack.length === 0;
  if (undoAllBtn) undoAllBtn.disabled = !monthGenerationSnapshot || monthUndoStack.length === 0;
}

window.undoMonthChange = function () {
  if (monthUndoStack.length === 0) return;
  const snapshot = monthUndoStack.pop();
  monthResults = snapshot.monthResults;
  monthAcknowledgedOverCapacity = snapshot.acknowledged;
  monthAcknowledgedReturnTimeException = snapshot.acknowledgedReturnTime || new Set();
  renderMonthResults();
  updateMonthUndoButtons();
  setMonthStatus('Undid last change.', '');
};

window.undoAllMonthChanges = function () {
  if (!monthGenerationSnapshot) return;
  monthResults = structuredClone(monthGenerationSnapshot.monthResults);
  monthAcknowledgedOverCapacity = new Set(monthGenerationSnapshot.acknowledged);
  monthAcknowledgedReturnTimeException = new Set(monthGenerationSnapshot.acknowledgedReturnTime || []);
  monthUndoStack = [];
  renderMonthResults();
  updateMonthUndoButtons();
  setMonthStatus('Reverted every change back to right after generation.', '');
};

function populateMonthStartAddressSelect() {
  const sel = document.getElementById('monthStartAddressSelect');
  const saved = loadStartAddresses();
  sel.innerHTML = saved.length
    ? saved.map(a => `<option value="${a.id}">${escapeHtml(a.label)} — ${escapeHtml(a.address)}</option>`).join('')
    : '<option value="">No saved address — add one on the Daily tab first</option>';
}

let monthWeekPatterns = {}; // { weekIdx: [monBool, tueBool, wedBool, thuBool, friBool] } — only for the currently-selected month, rebuilt whenever the month changes

// Groups the month's weekdays by which ISO week (Mon-anchored) they fall
// into. A month's first/last week is often partial (e.g. starts on a
// Wednesday) — only the days that actually fall within the target month
// are included for that week.
function getWeeksInMonth(yearMonthStr) {
  const [y, m] = yearMonthStr.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const weeksMap = new Map(); // mondayKey -> { monday, days: [{date, dow}] }
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(y, m - 1, d).getDay(); // 0=Sun..6=Sat
    if (dow === 0 || dow === 6) continue;
    const dateStr = dateKey(y, m - 1, d);
    const monday = mondayOf(dateStr);
    const mondayKey = dateKey(monday.getFullYear(), monday.getMonth(), monday.getDate());
    if (!weeksMap.has(mondayKey)) weeksMap.set(mondayKey, { monday: mondayKey, days: [] });
    weeksMap.get(mondayKey).days.push({ date: dateStr, dow });
  }
  return Array.from(weeksMap.values()).sort((a, b) => a.monday.localeCompare(b.monday));
}

function renderMonthWeekPatternRows() {
  const monthVal = document.getElementById('monthPicker').value;
  const container = document.getElementById('monthWeekPatternRows');
  if (!monthVal || !container) return;

  const weeks = getWeeksInMonth(monthVal);
  monthWeekPatterns = {};
  weeks.forEach((week, idx) => { monthWeekPatterns[idx] = [...standardWorkDays]; }); // pre-fill from the usual pattern, adjustable per week below

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  container.innerHTML = weeks.map((week, idx) => {
    const firstDate = week.days[0].date;
    const lastDate = week.days[week.days.length - 1].date;
    const checks = dayLabels.map((label, dayIdx) => `
      <label class="work-day-check"><input type="checkbox" class="monthWeekDayToggle" data-week="${idx}" data-day="${dayIdx}" ${monthWeekPatterns[idx][dayIdx] ? 'checked' : ''}> ${label}</label>
    `).join('');
    return `
      <div class="work-days-row">
        <span class="work-days-label">Week ${idx + 1} (${firstDate} – ${lastDate}):</span>
        ${checks}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.monthWeekDayToggle').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const weekIdx = parseInt(e.target.getAttribute('data-week'), 10);
      const dayIdx = parseInt(e.target.getAttribute('data-day'), 10);
      monthWeekPatterns[weekIdx][dayIdx] = e.target.checked;
    });
  });
}

function getWorkingDaysInMonth(yearMonthStr) {
  const weeks = getWeeksInMonth(yearMonthStr);
  const days = [];
  weeks.forEach((week, idx) => {
    const pattern = monthWeekPatterns[idx] || standardWorkDays;
    week.days.forEach(({ date, dow }) => {
      const workDayIdx = dow - 1; // Mon=0..Fri=4
      if (pattern[workDayIdx]) days.push(date);
    });
  });
  return days;
}

function setMonthStatus(msg, kind) {
  const el = document.getElementById('monthStatus');
  el.textContent = msg;
  el.className = 'status-line' + (kind ? ' ' + kind : '');
}

async function generateMonth() {
  const monthVal = document.getElementById('monthPicker').value;
  if (!monthVal) { setMonthStatus('Pick a month first.', 'error'); return; }

  const startAddrId = document.getElementById('monthStartAddressSelect').value;
  const saved = loadStartAddresses().find(a => a.id === startAddrId);
  if (!saved) { setMonthStatus('Pick a starting address first.', 'error'); return; }
  const startCoords = { lat: saved.lat, lng: saved.lng };
  monthStartCoordsGlobal = startCoords;

  const group = document.getElementById('monthGroupSelect').value;
  const stopCount = parseInt(document.getElementById('monthStopCount').value, 10) || 8;
  const startTime = document.getElementById('monthStartTime').value || '08:00';
  const returnTimeStr = document.getElementById('monthReturnTime').value;
  const returnTimeMinutes = returnTimeStr ? timeInputValueToMinutes(returnTimeStr) : null;
  const visitDuration = parseFloat(document.getElementById('monthVisitDuration').value) || 15;
  const includeRecent = document.getElementById('monthIncludeRecent').checked;
  const routeDirection = document.getElementById('monthRouteDirection').value;

  const workingDays = getWorkingDaysInMonth(monthVal);
  if (workingDays.length === 0) {
    setMonthStatus('No working days in that month based on your Standard Work Days settings.', 'error');
    return;
  }

  const isMix = group === '__ANY__';
  const allEligible = getFilteredPatients().filter(p => p.lat !== null && p.lng !== null);
  const groupPatients = isMix ? allEligible : allEligible.filter(p => p.group === group);
  // Eligibility checked once against the month's first working day — this
  // is a once-through-the-group-this-month plan, not a repeating daily
  // check, so a single baseline keeps the math simple and explainable.
  const eligible = includeRecent ? groupPatients : groupPatients.filter(p => !isRecentlyVisited(p, workingDays[0]));

  if (eligible.length === 0) {
    setMonthStatus('No eligible patients found for that group this month.', 'error');
    return;
  }

  const genBtn = document.getElementById('generateMonthBtn');
  genBtn.disabled = true;
  genBtn.textContent = '⏳ Generating month (this takes a while — one real-road fetch per working day)...';
  setMonthStatus(`Ordering ${eligible.length} patient(s) geographically...`, '');

  const eligibleUnits = splitManualOutliers(buildLocationUnits(eligible));

  // Same-address clusters get priority placement. If the month runs short
  // on working days, it's far better to push a few scattered individuals
  // to "next month" than to lose an entire household/building that's much
  // harder to coordinate later. Order and chunk multi-patient units FIRST,
  // then fill remaining days with everyone else — continuing geographically
  // from wherever the priority pass left off, not restarting from home.
  const largeUnits = eligibleUnits.filter(u => u.length > 1);
  const smallUnits = eligibleUnits.filter(u => u.length === 1);

  const orderedLarge = nearestNeighborOrderUnits(startCoords.lat, startCoords.lng, largeUnits);
  let continueFrom = startCoords;
  if (orderedLarge.length > 0) {
    const last = orderedLarge[orderedLarge.length - 1];
    const c = last.reduce((acc, m) => ({ lat: acc.lat + m.lat, lng: acc.lng + m.lng }), { lat: 0, lng: 0 });
    continueFrom = { lat: c.lat / last.length, lng: c.lng / last.length };
  }
  const orderedSmall = nearestNeighborOrderUnits(continueFrom.lat, continueFrom.lng, smallUnits);
  const orderedUnits = [...orderedLarge, ...orderedSmall];

  const chunks = chunkUnitsRespectingAddress(orderedUnits, stopCount).map(chunk =>
    routeDirection === 'furthest' ? chunk.slice().reverse() : chunk
  );

  monthResults = [];
  monthAcknowledgedOverCapacity = new Set();
  monthAcknowledgedReturnTimeException = new Set();
  const daysToUse = Math.min(workingDays.length, chunks.length);

  try {
    for (let i = 0; i < daysToUse; i++) {
      setMonthStatus(`Generating day ${i + 1} of ${daysToUse}...`, '');
      try {
        const timing = await trimStopsToReturnTime(startCoords, chunks[i], startTime, visitDuration, returnTimeMinutes);
        monthResults.push({
          date: workingDays[i], stops: timing.stops, totalHours: timing.totalHours, usingRealRoads: timing.usingRealRoads,
          routeDirection, stopCount, addressOverride: timing.stops.length > stopCount,
          dayStartMinutes: timing.dayStartMinutes, returnHomeMinutes: timing.returnHomeMinutes,
          returnTripMinutes: timing.returnTripMinutes, returnTripMiles: timing.returnTripMiles,
          returnTimeTarget: returnTimeMinutes, returnTimeException: timing.returnTimeException, returnTimeTrimmedCount: timing.trimmedCount
        });
      } catch (dayErr) {
        // One bad day (e.g. a routing-service hiccup on an unusual chunk)
        // should never take down every other day that already worked —
        // isolate it as an error entry and keep going.
        console.error(`generateMonth: day ${workingDays[i]} failed`, dayErr);
        monthResults.push({ date: workingDays[i], stops: [], totalHours: 0, usingRealRoads: false, error: dayErr.message || 'Failed to generate this day — try regenerating.' });
      }
    }
    for (let i = daysToUse; i < workingDays.length; i++) {
      monthResults.push({ date: workingDays[i], stops: [], totalHours: 0, usingRealRoads: false, emptyGroup: true });
    }

    renderMonthResults();
    const scheduledCount = monthResults.reduce((sum, d) => sum + ((d.stops && d.stops.length) || 0), 0);
    const leftoverCount = eligible.length - scheduledCount;
    const failedDays = monthResults.filter(d => d.error).length;
    let msg = `Generated ${daysToUse - failedDays} of ${daysToUse} working day(s), covering ${scheduledCount} of ${eligible.length} eligible patient(s).`;
    if (leftoverCount > 0) msg += ` ${leftoverCount} patient(s) didn't fit this month — still due, pick them up next month or on an ad-hoc day.`;
    if (failedDays > 0) msg += ` ⚠️ ${failedDays} day(s) failed to generate — see the red card(s) below, try regenerating.`;
    setMonthStatus(msg, failedDays > 0 ? 'error' : 'success');
    document.getElementById('approveMonthBtn').style.display = 'inline-block';
    monthGenerationSnapshot = snapshotMonthState();
    monthUndoStack = [];
    updateMonthUndoButtons();
  } catch (e) {
    console.error('generateMonth failed', e);
    setMonthStatus(`Something went wrong generating the month: ${e.message || e}. Try again.`, 'error');
  } finally {
    genBtn.disabled = false;
    genBtn.textContent = 'Generate Month';
  }
}

window.selectMonthAvailCell = function (dayIdx, dateStr, btnEl) {
  document.getElementById(`monthDatePickerInput_${dayIdx}`).value = dateStr;
  const grid = btnEl.parentElement;
  if (grid) {
    grid.querySelectorAll('.month-avail-cell').forEach(c => c.classList.remove('month-avail-selected'));
  }
  btnEl.classList.add('month-avail-selected');
};

function buildMonthAvailabilityCalendarHtml(dayIdx) {
  const monthVal = document.getElementById('monthPicker').value;
  if (!monthVal) return '';
  const [y, m] = monthVal.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  // occupied = has real patients right now (picking it triggers a replace).
  // open = a working day in the plan that's currently empty.
  // anything else = not a scheduled working day, still pickable as a one-off.
  const statusByDate = {};
  monthResults.forEach(d => {
    if (!d.date) return;
    if (d.stops && d.stops.length > 0) statusByDate[d.date] = 'occupied';
    else if (statusByDate[d.date] !== 'occupied') statusByDate[d.date] = 'open';
  });

  let cells = '';
  const firstDow = new Date(y, m - 1, 1).getDay();
  for (let i = 0; i < firstDow; i++) cells += `<div></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = dateKey(y, m - 1, day);
    const status = statusByDate[dateStr] || 'unavailable';
    const color = status === 'occupied' ? 'var(--pink-deep)' : status === 'open' ? 'var(--lime-deep)' : 'var(--text-soft)';
    const bg = status === 'occupied' ? 'rgba(238,126,171,0.15)' : status === 'open' ? 'rgba(116,184,122,0.15)' : 'transparent';
    cells += `<button type="button" class="month-avail-cell" style="border:1px solid ${color}; background:${bg}; color:${color}; border-radius:4px; font-size:0.75rem; padding:4px 0; cursor:pointer; font-family: var(--font-mono);" onclick="window.selectMonthAvailCell(${dayIdx}, '${dateStr}', this)" title="${dateStr} — ${status === 'occupied' ? 'has patients, picking this replaces them' : status === 'open' ? 'open and empty' : 'not currently a working day'}">${day}</button>`;
  }

  return `
    <div style="margin-top:8px; max-width:280px;">
      <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:3px; font-size:0.68rem; color:var(--text-soft); margin-bottom:4px; text-align:center;">
        ${dayNames.map(n => `<div>${n}</div>`).join('')}
      </div>
      <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:3px;">
        ${cells}
      </div>
      <div style="display:flex; gap:10px; margin-top:6px; font-size:0.7rem; flex-wrap:wrap;">
        <span style="color:var(--pink-deep);">🔴 Has patients</span>
        <span style="color:var(--lime-deep);">🟢 Open, empty</span>
        <span style="color:var(--text-soft);">⚪ Not scheduled (one-off if picked)</span>
      </div>
    </div>
  `;
}

function renderMonthDayCard(day, dayIdx) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const isUndated = day.date === null;
  const label = isUndated
    ? `⚠️ Needs a date (${day.stops.length} patients)`
    : `${dayNames[new Date(day.date + 'T00:00:00').getDay()]} ${day.date}`;

  if (!isUndated && day.error) {
    return `<div class="week-result-card wrc-error"><h3>${label}</h3><p class="wrc-meta" style="color:var(--pink-deep);">${escapeHtml(day.error)}</p></div>`;
  }
  if (!isUndated && day.emptyGroup) {
    return `<div class="week-result-card wrc-off"><h3>${label}</h3><p class="wrc-meta">Group fully covered earlier this month — nothing left to schedule.</p></div>`;
  }
  if (!isUndated && day.stops.length === 0) {
    return `<div class="week-result-card wrc-off"><h3>${label}</h3><p class="wrc-meta">No stops.</p></div>`;
  }

  const overCapNote = day.addressOverride ? `
    <div style="margin-top:10px; padding:10px; border-radius:var(--radius-sm); border:1px solid var(--pink-deep); background:rgba(238,126,171,0.1);">
      <p style="margin:0 0 8px; font-size:0.85rem; color:var(--pink-deep); font-weight:700;">⚠️ ${day.stops.length} stops — over your ${day.stopCount}/day setting, because everyone at one address had to stay together.</p>
      <label style="display:flex; align-items:center; gap:8px; font-size:0.82rem; cursor:pointer;">
        <input type="checkbox" class="monthOverCapAck" data-day="${dayIdx}" ${monthAcknowledgedOverCapacity.has(dayIdx) ? 'checked' : ''}>
        I've reviewed this and it's okay to approve as-is
      </label>
    </div>
  ` : '';
  const returnTimeNote = day.returnTimeException ? `
    <div style="margin-top:10px; padding:10px; border-radius:var(--radius-sm); border:1px solid var(--pink-deep); background:rgba(238,126,171,0.1);">
      <p style="margin:0 0 8px; font-size:0.85rem; color:var(--pink-deep); font-weight:700;">‼️ Today you'll be home past ${minutesToClock(day.returnTimeTarget)} — everyone at one address had to stay together and alone that visit runs past your target return time.</p>
      <label style="display:flex; align-items:center; gap:8px; font-size:0.82rem; cursor:pointer;">
        <input type="checkbox" class="monthReturnTimeAck" data-day="${dayIdx}" ${monthAcknowledgedReturnTimeException.has(dayIdx) ? 'checked' : ''}>
        I've reviewed this and it's okay to approve as-is
      </label>
    </div>
  ` : (day.returnTimeTrimmedCount > 0 ? `
    <p class="card-subtitle" style="color:var(--peach-deep);">⏱️ ${day.returnTimeTrimmedCount} patient(s) held back to make your ${minutesToClock(day.returnTimeTarget)} return time — still due, pick them up next month or on an ad-hoc day.</p>
  ` : '');
  const totalMiles = day.stops.reduce((sum, s) => sum + (s.travelMiles || 0), 0) + (day.returnTripMiles || 0);
  const dateHeader = isUndated
    ? `<h3 class="month-card-date-label" style="color:var(--pink-deep); cursor:default;">${label}</h3>`
    : `<h3 class="month-card-date-label" onclick="window.toggleMonthDatePicker(${dayIdx})" style="cursor:pointer; text-decoration:underline dotted; text-underline-offset:4px;" title="Click to move this whole day's patients to a different date">${label} ✏️</h3>`;
  const pickerLabel = isUndated ? 'Assign' : 'Move';

  return `
    <div class="week-result-card${isUndated ? ' wrc-error' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
        <div>
          ${dateHeader}
          <div id="monthDatePicker_${dayIdx}" style="display:${isUndated ? 'block' : 'none'}; margin-top:6px;">
            <div style="display:flex; gap:6px; align-items:center;">
              <input type="date" id="monthDatePickerInput_${dayIdx}" value="${isUndated ? '' : day.date}" style="font-family: var(--font-mono); font-size:0.85rem; padding:6px 8px; border:1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-alt); color: var(--text);">
              <button type="button" class="btn-tiny" onclick="window.confirmMoveMonthDay(${dayIdx})">${pickerLabel}</button>
              ${isUndated ? '' : `<button type="button" class="btn-tiny" onclick="window.toggleMonthDatePicker(${dayIdx})">Cancel</button>`}
            </div>
            ${buildMonthAvailabilityCalendarHtml(dayIdx)}
          </div>
        </div>
        <button type="button" class="btn-tiny" onclick="window.openMonthDayInGoogleMaps(${dayIdx})">🗺️ Open in Google Maps</button>
        <button type="button" class="btn-tiny" onclick="window.openDayReviewModal('month', ${dayIdx})">📍 See Map View</button>
      </div>
      <div class="route-summary" style="margin:10px 0;">
        <span class="rs-item"><span class="rs-label">Start:</span> Home ${minutesToClock(day.dayStartMinutes)}</span>
        <span class="rs-item"><span class="rs-label">Return trip:</span> 🚗 ${Math.round(day.returnTripMinutes)} min / ${day.returnTripMiles.toFixed(1)} mi</span>
        <span class="rs-item"><span class="rs-label">Arrive home:</span> ${minutesToClock(day.returnHomeMinutes)}</span>
        <span class="rs-item"><span class="rs-label">Stops:</span> ${day.stops.length}</span>
        <span class="rs-item"><span class="rs-label">Total hrs:</span> ${day.totalHours.toFixed(1)}</span>
        <span class="rs-item"><span class="rs-label">Total miles:</span> ${totalMiles.toFixed(1)} mi</span>
        <span class="rs-item" style="color:${day.usingRealRoads ? 'var(--lime-deep)' : 'var(--pink-deep)'};">${day.usingRealRoads ? '✓ real road times' : '⚠ straight-line estimate'}</span>
      </div>
      ${overCapNote}
      ${returnTimeNote}
      <p class="card-subtitle" style="margin-bottom:8px;">${isUndated ? 'Pick a date above to place this day — route and timing stay exactly as they are.' : "Drag a patient to another day's card to move them — group, remove, and time are all editable right here."}</p>
      <div class="month-card-droplist" data-day-idx="${dayIdx}">
        ${day.stops.map((s, i) => {
          const idleMin = idleGapBeforeStop(day.stops, i, parseFloat(document.getElementById('monthVisitDuration').value) || 15);
          const idleRow = idleMin > 0 ? `<div class="idle-gap-row">⏱️ Idle: ${idleMin} min — room to add someone here</div>` : '';
          return `
          ${idleRow}
          <div class="week-stop-row month-card-stop" draggable="true" data-day-idx="${dayIdx}" data-patient-id="${s.id}" style="flex-direction:column; align-items:stretch; gap:6px; cursor:grab;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <span>⠿⠿ #${i + 1} ${escapeHtml(s.name)}</span>
              <span>${minutesToClock(s.arrivalMinutes)}${s.manualArrivalOverride != null ? ' <span style="color:var(--pink-deep); font-weight:700; font-size:0.75em;">(edited)</span>' : ''}</span>
            </div>
            <div draggable="false" style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <select class="month-card-group-sel" data-day-idx="${dayIdx}" data-patient-id="${s.id}" style="font-size:0.78rem; padding:3px 6px; max-width:110px;">
                ${availableGroupLetters().map(l => `<option value="${l}" ${s.group === l ? 'selected' : ''}>Group ${l}</option>`).join('')}
              </select>
              <div style="display:flex; gap:4px;">
                <button type="button" class="btn-tiny" onclick="window.openEditArrivalMonthCard(${dayIdx}, '${s.id}')">✏️ Time</button>
                <button type="button" class="btn-tiny btn-tiny-danger" onclick="window.removeMonthCardStop(${dayIdx}, '${s.id}')">✖ Remove</button>
              </div>
            </div>
          </div>
        `; }).join('')}
      </div>
    </div>
  `;
}

function renderMonthResults() {
  const container = document.getElementById('monthResults');

  // Undated entries with real content are pinned above everything else —
  // impossible to miss, not buried in date order. An undated entry with NO
  // content is inert (already placed elsewhere) and just skipped entirely.
  const undatedHtml = monthResults
    .map((day, dayIdx) => ({ day, dayIdx }))
    .filter(({ day }) => day.date === null && day.stops && day.stops.length > 0)
    .map(({ day, dayIdx }) => renderMonthDayCard(day, dayIdx))
    .join('');

  const datedHtml = monthResults
    .map((day, dayIdx) => ({ day, dayIdx }))
    .filter(({ day }) => day.date !== null)
    .map(({ day, dayIdx }) => renderMonthDayCard(day, dayIdx))
    .join('');

  container.innerHTML = undatedHtml + datedHtml;

  container.querySelectorAll('.monthOverCapAck').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-day'), 10);
      if (e.target.checked) monthAcknowledgedOverCapacity.add(idx);
      else monthAcknowledgedOverCapacity.delete(idx);
    });
  });

  container.querySelectorAll('.monthReturnTimeAck').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-day'), 10);
      if (e.target.checked) monthAcknowledgedReturnTimeException.add(idx);
      else monthAcknowledgedReturnTimeException.delete(idx);
    });
  });

  container.querySelectorAll('.month-card-group-sel').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const dayIdx = parseInt(e.target.getAttribute('data-day-idx'), 10);
      window.changeMonthCardStopGroup(dayIdx, e.target.getAttribute('data-patient-id'), e.target.value);
    });
  });

  attachMonthCardDragHandlers();
}

let monthCardDraggedId = null;
let monthCardDraggedFromDay = null;
let monthCardDragBusy = false;

function attachMonthCardDragHandlers() {
  document.querySelectorAll('.month-card-stop').forEach(row => {
    row.addEventListener('dragstart', () => {
      monthCardDraggedId = row.getAttribute('data-patient-id');
      monthCardDraggedFromDay = parseInt(row.getAttribute('data-day-idx'), 10);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
  });

  document.querySelectorAll('.month-card-droplist').forEach(zone => {
    zone.addEventListener('dragover', (e) => e.preventDefault());
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetDayIdx = parseInt(zone.getAttribute('data-day-idx'), 10);
      await handleMonthCardDrop(targetDayIdx, zone, e.clientY);
    });
  });
}

async function recomputeMonthDay(dayIdx) {
  const day = monthResults[dayIdx];
  if (!day) return;
  const startCoords = monthStartCoordsGlobal;
  const startTime = document.getElementById('monthStartTime').value || '08:00';
  const visitDuration = parseFloat(document.getElementById('monthVisitDuration').value) || 15;

  if (day.stops.length === 0) {
    day.totalHours = 0;
    return;
  }
  const timing = await computeTimingForDay(startCoords, day.stops, startTime, visitDuration);
  day.stops = timing.stops;
  day.totalHours = timing.totalHours;
  day.usingRealRoads = timing.usingRealRoads;
  day.dayStartMinutes = timing.dayStartMinutes;
  day.returnHomeMinutes = timing.returnHomeMinutes;
  day.returnTripMinutes = timing.returnTripMinutes;
  day.returnTripMiles = timing.returnTripMiles;
  if (day.stopCount) day.addressOverride = day.stops.length > day.stopCount;
}

async function handleMonthCardDrop(targetDayIdx, zoneEl, dropClientY) {
  if (monthCardDragBusy) return;
  if (monthCardDraggedId === null || monthCardDraggedFromDay === null) return;

  pushMonthUndoSnapshot();

  if (monthCardDraggedFromDay === targetDayIdx) {
    // Reordering WITHIN the same day — figure out the drop position from
    // where the mouse released, splice to that index, and recalc times for
    // the new manual order (never re-optimize — the whole point is the
    // person placed them deliberately).
    const day = monthResults[targetDayIdx];
    if (!day || !day.stops) { monthCardDraggedId = null; monthCardDraggedFromDay = null; return; }
    const originalIdx = day.stops.findIndex(s => s.id === monthCardDraggedId);
    if (originalIdx === -1) { monthCardDraggedId = null; monthCardDraggedFromDay = null; return; }

    const [moved] = day.stops.splice(originalIdx, 1);
    const items = zoneEl ? Array.from(zoneEl.querySelectorAll('.month-card-stop')) : [];
    let insertAt = day.stops.length;
    if (zoneEl && dropClientY != null) {
      for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        if (dropClientY < rect.top + rect.height / 2) { insertAt = i; break; }
      }
    }
    day.stops.splice(insertAt, 0, moved);

    monthCardDragBusy = true;
    setMonthStatus('⏳ Recalculating...', '');
    try {
      await recomputeMonthDay(targetDayIdx);
      await checkAndHandleAnchorOverflow(
        day.stops,
        async () => {
          // Put the dragged stop back exactly where it started.
          const idxNow = day.stops.findIndex(s => s.id === moved.id);
          if (idxNow !== -1) day.stops.splice(idxNow, 1);
          day.stops.splice(originalIdx, 0, moved);
          await recomputeMonthDay(targetDayIdx);
        }
      );
      renderMonthResults();
      setMonthStatus('Reordered — times recalculated.', 'success');
    } catch (e) {
      console.error('handleMonthCardDrop (same-day) failed', e);
      setMonthStatus(`Something went wrong reordering: ${e.message || e}`, 'error');
    } finally {
      monthCardDragBusy = false;
      monthCardDraggedId = null;
      monthCardDraggedFromDay = null;
    }
    return;
  }

  const fromDay = monthResults[monthCardDraggedFromDay];
  const toDay = monthResults[targetDayIdx];
  if (!fromDay || !toDay || !fromDay.stops || !toDay.stops) { monthCardDraggedId = null; monthCardDraggedFromDay = null; return; }

  const idx = fromDay.stops.findIndex(s => s.id === monthCardDraggedId);
  if (idx === -1) { monthCardDraggedId = null; monthCardDraggedFromDay = null; return; }

  monthCardDragBusy = true;
  setMonthStatus('⏳ Moving patient and recalculating both days...', '');
  try {
    const [moved] = fromDay.stops.splice(idx, 1);
    await recomputeMonthDay(monthCardDraggedFromDay);

    // Re-optimize the target day's order — same "auto restructure" principle
    // used everywhere else a stop is added mid-route.
    const startCoords = monthStartCoordsGlobal;
    let newOrder = nearestNeighborOrder(startCoords.lat, startCoords.lng, toDay.stops.concat([moved]));
    if (toDay.routeDirection === 'furthest') newOrder = newOrder.slice().reverse();
    toDay.stops = newOrder;
    await recomputeMonthDay(targetDayIdx);

    await checkAndHandleAnchorOverflow(
      toDay.stops,
      async () => {
        // Undo the whole move — patient goes back to their origin day.
        toDay.stops = toDay.stops.filter(s => s.id !== moved.id);
        fromDay.stops.push(moved);
        await recomputeMonthDay(targetDayIdx);
        await recomputeMonthDay(monthCardDraggedFromDay);
      }
    );

    renderMonthResults();
    setMonthStatus('Moved — both days recalculated.', 'success');
  } catch (e) {
    console.error('handleMonthCardDrop (cross-day) failed', e);
    setMonthStatus(`Something went wrong moving that patient: ${e.message || e}`, 'error');
  } finally {
    monthCardDragBusy = false;
    monthCardDraggedId = null;
    monthCardDraggedFromDay = null;
  }
}

window.toggleMonthDatePicker = function (dayIdx) {
  const el = document.getElementById(`monthDatePicker_${dayIdx}`);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

function copyDayContent(source, target) {
  target.stops = source.stops;
  target.totalHours = source.totalHours;
  target.usingRealRoads = source.usingRealRoads;
  target.dayStartMinutes = source.dayStartMinutes;
  target.returnHomeMinutes = source.returnHomeMinutes;
  target.returnTripMinutes = source.returnTripMinutes;
  target.returnTripMiles = source.returnTripMiles;
  target.routeDirection = source.routeDirection;
  target.stopCount = source.stopCount;
  target.addressOverride = source.addressOverride;
  target.emptyGroup = false;
  target.error = undefined;
}

window.confirmMoveMonthDay = function (dayIdx) {
  const day = monthResults[dayIdx];
  if (!day || !day.stops || day.stops.length === 0) return;
  const input = document.getElementById(`monthDatePickerInput_${dayIdx}`);
  const newDate = input ? input.value : '';
  if (!newDate) { setMonthStatus('Pick a date first.', 'error'); return; }
  if (newDate === day.date) { window.toggleMonthDatePicker(dayIdx); return; }

  pushMonthUndoSnapshot();

  const targetIdx = monthResults.findIndex((d, i) => i !== dayIdx && d.date === newDate);
  let msg = `Moved to ${newDate}.`;

  if (targetIdx !== -1 && monthResults[targetIdx].stops && monthResults[targetIdx].stops.length > 0) {
    // Occupied date — replace directly. The current occupant is bumped into
    // date-less limbo (pushed as a NEW entry, never spliced out of the
    // array, so no existing index anywhere else ever shifts) and shows up
    // in the pinned "Needs a date" section until manually reassigned.
    const target = monthResults[targetIdx];
    const bumped = { ...target, date: null };
    monthResults.push(bumped);
    copyDayContent(day, target);
    msg = `${newDate} now has this day's patients — the previous occupant needs a new date (flagged above).`;
  } else if (targetIdx !== -1) {
    // Target date exists in the plan but is empty — merge in cleanly.
    copyDayContent(day, monthResults[targetIdx]);
  } else {
    // Nothing uses that date at all — this entry just claims it, nothing to vacate.
    day.date = newDate;
    renderMonthResults();
    setMonthStatus(msg, 'success');
    return;
  }

  // Vacate the origin slot — mark it empty/inert, never remove it from the
  // array (removal would shift every index after it, silently breaking
  // over-capacity tracking and every button tied to a dayIdx).
  day.stops = [];
  day.totalHours = 0;
  if (day.date) day.emptyGroup = true;

  renderMonthResults();
  setMonthStatus(msg, 'success');
};

window.changeMonthCardStopGroup = function (dayIdx, patientId, newGroup) {
  const day = monthResults[dayIdx];
  if (!day || !day.stops) return;
  const stop = day.stops.find(s => s.id === patientId);
  if (!stop) return;
  pushMonthUndoSnapshot();
  stop.group = newGroup;
  // Make this a real, lasting override — consistent with changing a
  // patient's group anywhere else in the app, not just cosmetic on this card.
  const master = patients.find(p => p.id === patientId);
  if (master) { master.manualGroup = true; master.group = newGroup; savePatients(); }
};

window.removeMonthCardStop = async function (dayIdx, patientId) {
  const day = monthResults[dayIdx];
  if (!day || !day.stops) return;
  const before = day.stops.length;
  if (!day.stops.some(s => s.id === patientId)) return;
  pushMonthUndoSnapshot();
  day.stops = day.stops.filter(s => s.id !== patientId);
  if (day.stops.length === before) return;

  monthCardDragBusy = true;
  setMonthStatus('⏳ Recalculating this day...', '');
  try {
    await recomputeMonthDay(dayIdx);
    renderMonthResults();
    setMonthStatus('Removed — day recalculated.', 'success');
  } finally {
    monthCardDragBusy = false;
  }
};

window.openEditArrivalMonthCard = function (dayIdx, patientId) {
  const day = monthResults[dayIdx];
  if (!day || !day.stops) return;
  const p = day.stops.find(s => s.id === patientId);
  if (!p || p.arrivalMinutes === undefined) return;
  pendingArrivalEdit = { context: 'monthcard', patientId, dayIdx };

  document.getElementById('editArrivalSubtitle').textContent = `${p.name} — adjust arrival time for this day.`;
  document.getElementById('editArrivalInput').value = minutesToTimeInputValue(p.arrivalMinutes);
  document.getElementById('editArrivalNote').textContent = 'Every patient scheduled after this one that day will shift by the same amount.';
  document.getElementById('editArrivalNote').className = 'status-line';
  document.getElementById('editArrivalResetBtn').style.display = 'none';
  document.getElementById('editArrivalModal').style.display = 'flex';
};

window.openMonthDayInGoogleMaps = function (dayIdx) {
  const day = monthResults[dayIdx];
  if (!day || !day.stops || day.stops.length === 0 || !monthStartCoordsGlobal) { alert('No stops to map for this day.'); return; }
  if (day.stops.length > 23) { alert('Google Maps supports up to ~23 stops in one link — this day has more.'); return; }
  const origin = `${monthStartCoordsGlobal.lat},${monthStartCoordsGlobal.lng}`;
  const last = day.stops[day.stops.length - 1];
  const destination = `${last.lat},${last.lng}`;
  const waypointStops = day.stops.slice(0, -1);
  const waypoints = waypointStops.map(s => `${s.lat},${s.lng}`).join('|');
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
  window.open(url, '_blank');
};

function approveMonth() {
  const unacknowledgedCap = monthResults
    .map((d, i) => ({ d, i }))
    .filter(({ d, i }) => d.addressOverride && !monthAcknowledgedOverCapacity.has(i));
  if (unacknowledgedCap.length > 0) {
    const dates = unacknowledgedCap.map(({ d }) => d.date).join(', ');
    alert(`Check the acknowledgment box on the over-capacity day(s) first (${dates}) before approving the month.`);
    return;
  }

  const unacknowledgedReturnTime = monthResults
    .map((d, i) => ({ d, i }))
    .filter(({ d, i }) => d.returnTimeException && !monthAcknowledgedReturnTimeException.has(i));
  if (unacknowledgedReturnTime.length > 0) {
    const dates = unacknowledgedReturnTime.map(({ d }) => d.date).join(', ');
    alert(`Check the acknowledgment box on the day(s) running past your return time first (${dates}) before approving the month.`);
    return;
  }

  const datesToApprove = monthResults.filter(d => !d.emptyGroup && d.stops && d.stops.length > 0).map(d => d.date);
  const conflicts = datesWithExistingSchedule(datesToApprove);

  const proceedPastOverwriteCheck = () => {
    if (conflicts.length > 0) {
      showOverwriteConfirm(
        `${conflicts.length} day(s) this month already have an approved schedule. Continuing will overwrite those days' patient lists — the prior schedule for those specific dates will be replaced, not merged. Continue?`,
        commitApproveMonth
      );
    } else {
      commitApproveMonth();
    }
  };

  const allPatientsThisMonth = monthResults.filter(d => !d.emptyGroup && d.stops).flatMap(d => d.stops);
  const doubleBooked = findDoubleBookedPatients(allPatientsThisMonth, datesToApprove);
  if (doubleBooked.length > 0) {
    const list = doubleBooked.map(c => `${c.name} (already on ${c.date})`).join(', ');
    showOverwriteConfirm(
      `⚠️ ${doubleBooked.length} patient(s) already have an approved visit on a different date: ${list}. Continue?`,
      proceedPastOverwriteCheck
    );
  } else {
    proceedPastOverwriteCheck();
  }
}

function commitApproveMonth() {
  let totalApproved = 0;
  monthResults.forEach(day => {
    if (day.emptyGroup || !day.stops || day.stops.length === 0) return;
    recordApprovedSchedule(day.date, day.stops);
    day.stops.forEach(s => recomputeLastVisitDate(s.id));
    totalApproved += day.stops.length;
  });
  savePatients();
  renderTable();
  setMonthStatus(`Approved the month — ${totalApproved} patient visit(s) scheduled. Check the Home tab calendar.`, 'success');
  document.getElementById('approveMonthBtn').style.display = 'none';
}

function cancelMonth() {
  monthResults = [];
  monthUndoStack = [];
  monthGenerationSnapshot = null;
  document.getElementById('monthResults').innerHTML = '';
  document.getElementById('approveMonthBtn').style.display = 'none';
  updateMonthUndoButtons();
  setMonthStatus('Month cleared.', '');
}

/* ============================================
   DAY REVIEW MODAL (Weekly/Monthly results)
   Deliberately separate state from Daily's live builder (scheduledPatients/
   leftoverPatients/startCoords) so opening this modal never interferes with
   an in-progress Daily route. Shares the stateless engine underneath
   (computeTimingForDay, nearestNeighborOrder) — only the state and rendering
   are separate, to avoid risking regressions in Daily's already-solid code.

   Nothing here touches weekResults/monthResults until Confirm — Cancel is
   always a true no-op revert, matching what was explicitly asked for.
   ============================================ */
let dayReviewContext = null; // { batchType, dayIdx, date, scheduled: [...], pendingPulls: {patientId: originDayIdx}, startCoords, startTime, visitDuration }
let dayReviewMap = null;
let dayReviewLayer = null;
let dayReviewLastGeometry = null;

function getBatchResults(batchType) {
  return batchType === 'week' ? weekResults : monthResults;
}

function getBatchDayLabel(dateStr) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d = new Date(dateStr + 'T00:00:00');
  return `${dayNames[d.getDay()]} ${dateStr}`;
}

// Scans every OTHER day in this batch for a patient — used both to label
// "available" candidates correctly and to know which origin day to pull
// someone out of at Confirm time.
function findPatientElsewhereInBatch(batchType, patientId, excludeDayIdx) {
  const results = getBatchResults(batchType);
  for (let i = 0; i < results.length; i++) {
    if (i === excludeDayIdx) continue;
    const day = results[i];
    if (day.stops && day.stops.some(s => s.id === patientId)) return { dayIdx: i, date: day.date };
  }
  return null;
}

window.openDayReviewModal = function (batchType, dayIdx) {
  const results = getBatchResults(batchType);
  const day = results[dayIdx];
  if (!day || day.offDay || day.emptyGroup || !day.stops || day.stops.length === 0) {
    alert('Nothing to review for this day.');
    return;
  }

  const startCoords = batchType === 'week' ? weekStartCoordsGlobal : monthStartCoordsGlobal;
  const startTime = batchType === 'week'
    ? (document.getElementById('weekStartTime').value || '08:00')
    : (document.getElementById('monthStartTime').value || '08:00');
  const visitDuration = batchType === 'week'
    ? (parseFloat(document.getElementById('weekVisitDuration').value) || 15)
    : (parseFloat(document.getElementById('monthVisitDuration').value) || 15);

  if (!startCoords) { alert('Missing starting address for this batch — regenerate first.'); return; }

  // Working copy, preferring the live patient record (fresher address/etc)
  // but falling back to the stored stop snapshot if the patient was since removed.
  // A fixed-time anchor (manualArrivalOverride) is schedule-specific, not
  // something the live patient record carries — always preserve it from
  // the snapshot regardless of which record we're otherwise using.
  const scheduledCopy = day.stops.map(s => {
    const live = patients.find(p => p.id === s.id);
    const base = live ? { ...live } : { ...s };
    if (s.manualArrivalOverride != null) base.manualArrivalOverride = s.manualArrivalOverride;
    return base;
  });

  dayReviewContext = {
    batchType, dayIdx, date: day.date,
    scheduled: scheduledCopy,
    pendingPulls: {},
    startCoords, startTime, visitDuration,
    routeDirection: day.routeDirection || 'closest'
  };
  dayReviewSearchHouseholds = [];
  dayReviewSearchTerm = '';

  document.getElementById('dayReviewTitle').textContent = `${getBatchDayLabel(day.date)} — Review & Adjust`;
  document.getElementById('dayReviewSearchInput').value = '';
  document.getElementById('dayReviewSearchResults').style.display = 'none';
  document.getElementById('dayReviewModal').style.display = 'flex';
  recalcDayReview();
};

function ensureDayReviewMap() {
  if (dayReviewMap) return;
  dayReviewMap = L.map('dayReviewMap');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(dayReviewMap);
}

async function recalcDayReview() {
  if (!dayReviewContext) return;
  const { startCoords, scheduled, startTime, visitDuration } = dayReviewContext;

  document.getElementById('dayReviewSummary').innerHTML = '<span class="rs-item">⏳ Recalculating...</span>';

  const timing = await computeTimingForDay(startCoords, scheduled, startTime, visitDuration);
  dayReviewContext.computedStops = timing.stops;
  dayReviewContext.totalHours = timing.totalHours;
  dayReviewContext.usingRealRoads = timing.usingRealRoads;
  dayReviewContext.dayStartMinutes = timing.dayStartMinutes;
  dayReviewContext.returnHomeMinutes = timing.returnHomeMinutes;
  dayReviewContext.returnTripMinutes = timing.returnTripMinutes;
  dayReviewContext.returnTripMiles = timing.returnTripMiles;

  // Re-sync scheduled with computed timing data (arrivalMinutes etc. live on computedStops)
  dayReviewContext.scheduled = timing.stops;

  renderDayReviewSummary();
  renderDayReviewList();
  renderDayReviewMap();
}

function renderDayReviewSummary() {
  const el = document.getElementById('dayReviewSummary');
  const { computedStops, totalHours, usingRealRoads, dayStartMinutes, returnHomeMinutes, returnTripMinutes, returnTripMiles } = dayReviewContext;
  if (!computedStops || computedStops.length === 0) {
    el.innerHTML = '<span class="rs-item">No stops on this day.</span>';
    return;
  }
  const totalMiles = computedStops.reduce((sum, s) => sum + (s.travelMiles || 0), 0) + (returnTripMiles || 0);
  el.innerHTML = `
    <span class="rs-item"><span class="rs-label">Start:</span> Home ${minutesToClock(dayStartMinutes)}</span>
    <span class="rs-item"><span class="rs-label">Return trip:</span> 🚗 ${Math.round(returnTripMinutes)} min / ${returnTripMiles.toFixed(1)} mi</span>
    <span class="rs-item"><span class="rs-label">Arrive home:</span> ${minutesToClock(returnHomeMinutes)}</span>
    <span class="rs-item"><span class="rs-label">Stops:</span> ${computedStops.length}</span>
    <span class="rs-item"><span class="rs-label">Total hrs:</span> ${totalHours.toFixed(1)}</span>
    <span class="rs-item"><span class="rs-label">Total miles:</span> ${totalMiles.toFixed(1)} mi</span>
    <span class="rs-item" style="color:${usingRealRoads ? 'var(--lime-deep)' : 'var(--pink-deep)'};">${usingRealRoads ? '✓ real road times' : '⚠ straight-line estimate'}</span>
  `;
}

let dayReviewDraggedId = null;

function renderDayReviewList() {
  const el = document.getElementById('dayReviewList');
  document.getElementById('dayReviewCount').textContent = dayReviewContext.computedStops.length;
  const visitDuration = dayReviewContext.visitDuration || 15;
  el.innerHTML = `<ul class="drag-list" id="dayReviewDragList">` + dayReviewContext.computedStops.map((s, i) => {
    const idleMin = idleGapBeforeStop(dayReviewContext.computedStops, i, visitDuration);
    const idleRow = idleMin > 0 ? `<li class="idle-gap-row">⏱️ Idle: ${idleMin} min — room to add someone here</li>` : '';
    return `
    ${idleRow}
    <li class="drag-item" draggable="true" data-id="${s.id}">
      <div class="di-name">#${i + 1} ${escapeHtml(s.name)}${s.group ? ` <span style="color:var(--text-soft); font-weight:600; font-size:0.8em;">(Grp- ${escapeHtml(s.group)})</span>` : ''}</div>
      <div class="di-meta">${minutesToClock(s.arrivalMinutes)} — ${escapeHtml(s.address || '')}</div>
      <div class="item-actions">
        <button type="button" class="btn-tiny btn-tiny-danger" onclick="window.removeFromDayReview('${s.id}')">✖ Remove</button>
      </div>
    </li>
  `; }).join('') + `</ul>`;
  attachDayReviewDragHandlers();
}

function attachDayReviewDragHandlers() {
  const list = document.getElementById('dayReviewDragList');
  if (!list) return;

  list.querySelectorAll('.drag-item').forEach(item => {
    item.addEventListener('dragstart', () => {
      dayReviewDraggedId = item.getAttribute('data-id');
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
  });

  list.addEventListener('dragover', (e) => e.preventDefault());
  list.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!dayReviewDraggedId) return;
    const originalIdx = dayReviewContext.scheduled.findIndex(p => p.id === dayReviewDraggedId);
    if (originalIdx === -1) return;
    const [moved] = dayReviewContext.scheduled.splice(originalIdx, 1);

    const items = Array.from(list.querySelectorAll('.drag-item'));
    let insertAt = dayReviewContext.scheduled.length;
    const dropY = e.clientY;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (dropY < rect.top + rect.height / 2) { insertAt = i; break; }
    }
    dayReviewContext.scheduled.splice(insertAt, 0, moved);
    dayReviewDraggedId = null;
    // Manual order is intentional — recalcDayReview only recomputes real-road
    // times for whatever order is already in the array, it never re-optimizes.
    await recalcDayReview();

    await checkAndHandleAnchorOverflow(
      dayReviewContext.computedStops,
      async () => {
        // Put the dragged stop back exactly where it started.
        const idxNow = dayReviewContext.scheduled.findIndex(p => p.id === moved.id);
        if (idxNow !== -1) dayReviewContext.scheduled.splice(idxNow, 1);
        dayReviewContext.scheduled.splice(originalIdx, 0, moved);
        await recalcDayReview();
      }
    );
  });
}

function renderDayReviewMap() {
  ensureDayReviewMap();
  if (dayReviewLayer) dayReviewLayer.remove();
  dayReviewLayer = L.layerGroup().addTo(dayReviewMap);

  const { startCoords, computedStops, batchType, dayIdx } = dayReviewContext;

  const homeIcon = L.divIcon({ className: 'home-pin', html: '<div class="home-pin-badge">🏠</div>', iconSize: [34, 34], iconAnchor: [17, 30] });
  L.marker([startCoords.lat, startCoords.lng], { icon: homeIcon }).addTo(dayReviewLayer).bindPopup('Start (home base)');

  const scheduledUnits = buildLocationUnits(computedStops);
  scheduledUnits.forEach(unit => {
    const lat = unit[0].lat, lng = unit[0].lng;

    if (unit.length === 1) {
      const s = unit[0];
      const i = computedStops.indexOf(s);
      L.marker([lat, lng]).addTo(dayReviewLayer).bindPopup(`
        #${i + 1} ${escapeHtml(s.name)}<br>
        ${minutesToClock(s.arrivalMinutes)} — Group ${escapeHtml(s.group || '—')}
        <button type="button" style="margin-top:6px; width:100%; font-size:0.8rem; padding:3px 8px;" onclick="window.removeFromDayReview('${s.id}')">✖ Remove from this day</button>
      `);
      return;
    }

    const badgeIcon = L.divIcon({
      className: 'cluster-pin',
      html: `<div class="cluster-pin-badge" style="background:#3388ff;">${unit.length}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
    const popupHtml = `
      <div style="min-width:220px; max-height:320px; overflow-y:auto;">
        <strong>${unit.length} scheduled patients at this address</strong>
        <button type="button" style="margin-top:8px; width:100%; font-size:0.8rem; padding:4px 8px; font-weight:700;" onclick="window.removeAllAtLocationFromDayReview('${unit[0].id}')">✖ Remove All (${unit.length})</button>
        ${unit.map(s => `
          <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
            #${computedStops.indexOf(s) + 1} <strong>${escapeHtml(s.name)}</strong><br>
            <span style="font-size:0.78rem; color:var(--text-soft);">${minutesToClock(s.arrivalMinutes)} — Group ${escapeHtml(s.group || '—')}</span>
            <button type="button" style="margin-top:4px; width:100%; font-size:0.78rem; padding:3px 8px;" onclick="window.removeFromDayReview('${s.id}')">✖ Remove</button>
          </div>
        `).join('')}
      </div>
    `;
    L.marker([lat, lng], { icon: badgeIcon }).addTo(dayReviewLayer).bindPopup(popupHtml);
  });

  const scheduledIds = new Set(computedStops.map(s => s.id));
  const candidatePatients = getFilteredPatients().filter(p => p.lat !== null && p.lng !== null && !scheduledIds.has(p.id));
  const candidateUnits = buildLocationUnits(candidatePatients);

  candidateUnits.forEach(unit => {
    const lat = unit[0].lat, lng = unit[0].lng;
    const withStatus = unit.map(p => ({ p, elsewhere: findPatientElsewhereInBatch(batchType, p.id, dayIdx) }));
    // If ANY member of this address still needs a day this month, the whole
    // marker reads orange — that's the more urgent signal, don't let it
    // hide behind someone else at the same address who's already placed.
    const anyUnassigned = withStatus.some(w => !w.elsewhere);
    const groupCounts = {};
    unit.forEach(p => { const g = p.group || 'unassigned'; groupCounts[g] = (groupCounts[g] || 0) + 1; });
    const mixed = Object.keys(groupCounts).length > 1;

    if (unit.length === 1) {
      const { p, elsewhere } = withStatus[0];
      const label = elsewhere ? `currently on ${getBatchDayLabel(elsewhere.date)}` : '⚠️ unassigned — still needs a day this month';
      const icon = elsewhere
        ? L.divIcon({ className: 'ghost-pin', html: '<div class="ghost-pin-dot"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })
        : L.divIcon({ className: 'ghost-pin', html: '<div class="ghost-pin-dot ghost-pin-leftover"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
      L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(dayReviewLayer).bindPopup(`
        ${escapeHtml(p.name)} (Group ${escapeHtml(p.group || '—')})<br>
        <span style="color:${elsewhere ? 'var(--text-soft)' : 'var(--peach-deep)'}; font-size:0.8rem; font-weight:${elsewhere ? '400' : '700'};">${label}</span>
        <button type="button" style="margin-top:6px; width:100%; font-size:0.8rem; padding:3px 8px;" onclick="window.addToDayReview('${p.id}')">+ Add to this day</button>
      `);
      return;
    }

    const badgeColor = anyUnassigned ? '#F7931A' : '#74B87A';
    const badgeIcon = L.divIcon({
      className: 'cluster-pin',
      html: `<div class="cluster-pin-badge${mixed ? ' cluster-pin-mixed' : ''}" style="background:${badgeColor};">${unit.length}${mixed ? '<span class="cluster-pin-warn">⚠️</span>' : ''}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    const popupHtml = `
      <div style="min-width:220px; max-height:320px; overflow-y:auto;">
        <strong>${unit.length} patients at this address</strong>
        ${mixed ? '<br><span style="color:var(--pink-deep); font-size:0.78rem; font-weight:700;">⚠️ Mixed groups — not all the same</span>' : ''}
        <button type="button" style="margin-top:8px; width:100%; font-size:0.8rem; padding:4px 8px; font-weight:700;" onclick="window.addAllAtLocationToDayReview('${unit[0].id}')">+ Add All (${unit.length})</button>
        ${withStatus.map(({ p, elsewhere }) => `
          <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
            <strong>${escapeHtml(p.name)}</strong> <span style="color:var(--text-soft); font-size:0.78rem;">(Group ${escapeHtml(p.group || '—')})</span><br>
            <span style="font-size:0.76rem; color:${elsewhere ? 'var(--text-soft)' : 'var(--peach-deep)'}; font-weight:${elsewhere ? '400' : '700'};">${elsewhere ? `currently on ${getBatchDayLabel(elsewhere.date)}` : '⚠️ unassigned this month'}</span>
            <button type="button" style="margin-top:4px; width:100%; font-size:0.78rem; padding:3px 8px;" onclick="window.addToDayReview('${p.id}')">+ Add</button>
          </div>
        `).join('')}
      </div>
    `;

    L.marker([lat, lng], { icon: badgeIcon, zIndexOffset: 1000 }).addTo(dayReviewLayer).bindPopup(popupHtml);
  });

  const points = [[startCoords.lat, startCoords.lng], ...computedStops.map(s => [s.lat, s.lng])];
  L.polyline(points, { color: '#EE7EAB', weight: 3, dashArray: '1,8' }).addTo(dayReviewLayer);

  dayReviewMap.fitBounds(L.latLngBounds(points), { padding: [30, 30] });
  setTimeout(() => dayReviewMap.invalidateSize(), 150);
}

let dayReviewSearchHouseholds = []; // households found for the CURRENT search term — persists across re-renders so the rest of a household stays visible after one member is added
let dayReviewSearchTerm = '';

function renderDayReviewSearchResults(term) {
  const container = document.getElementById('dayReviewSearchResults');
  if (!term) { container.style.display = 'none'; container.innerHTML = ''; dayReviewSearchHouseholds = []; dayReviewSearchTerm = ''; return; }

  const scheduledIds = new Set(dayReviewContext.computedStops.map(s => s.id));

  if (term !== dayReviewSearchTerm) {
    // The term actually changed (the user typed something new) — recompute
    // which households match from scratch. If it's the SAME term (a
    // refresh triggered right after an add), skip this and just re-filter
    // the households already found below — that's what keeps the rest of
    // a household visible after its anchor match gets scheduled.
    const lowerTerm = term.toLowerCase();
    const directMatches = getFilteredPatients()
      .filter(p => p.lat !== null && p.lng !== null &&
        (p.name.toLowerCase().includes(lowerTerm) || (p.address && p.address.toLowerCase().includes(lowerTerm))))
      .slice(0, 8);

    const coveredIds = new Set();
    const households = [];
    directMatches.forEach(p => {
      if (coveredIds.has(p.id)) return;
      const household = getFilteredPatients().filter(q => q.lat !== null && q.lng !== null && isSameLocation(p, q));
      household.forEach(m => coveredIds.add(m.id));
      households.push(household);
    });
    dayReviewSearchHouseholds = households;
    dayReviewSearchTerm = term;
  }

  // Re-filter the REMEMBERED households down to who's still available —
  // this is what lets Michael and Jennifer stay visible after Mark (the
  // one whose name actually matched) gets added and drops off the list.
  const visibleHouseholds = dayReviewSearchHouseholds
    .map(h => h.filter(p => !scheduledIds.has(p.id)))
    .filter(h => h.length > 0);

  if (visibleHouseholds.length === 0) {
    container.innerHTML = '<p class="status-line">Everyone matching is already scheduled today.</p>';
    container.style.display = 'block';
    return;
  }

  container.innerHTML = visibleHouseholds.map(household => {
    const addAllBtn = household.length > 1
      ? `<button type="button" class="btn-tiny" style="width:100%; margin-top:6px; font-weight:700;" onclick="window.addAllAtLocationToDayReview('${household[0].id}')">+ Add All (${household.length})</button>`
      : '';
    const rows = household.map(p => {
      const elsewhere = findPatientElsewhereInBatch(dayReviewContext.batchType, p.id, dayReviewContext.dayIdx);
      const label = elsewhere ? `currently on ${getBatchDayLabel(elsewhere.date)}` : 'unassigned';
      return `
        <div class="search-result-row" style="margin-bottom:4px;">
          <span>${escapeHtml(p.name)} — ${escapeHtml(p.address)} <span style="color:var(--text-soft);">(${label})</span></span>
          <button type="button" class="btn-tiny" onclick="window.addToDayReview('${p.id}')">+ Add</button>
        </div>
      `;
    }).join('');
    return `<div style="border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px; margin-bottom:8px;">${rows}${addAllBtn}</div>`;
  }).join('');
  container.style.display = 'block';
}

// Compares a stop's actual arrival against when it would naturally have
// been reached (previous stop's finish + real travel time). For a normal
// transition these are equal — a gap only appears when something forced
// the cursor to jump ahead, which today only happens for a fixed-time
// anchor running comfortably early. Rounds off sub-minute noise.
function idleGapBeforeStop(stops, i, visitDuration) {
  if (i === 0) return 0;
  const prev = stops[i - 1];
  const cur = stops[i];
  const prevFinish = prev.arrivalMinutes + (prev.visitDuration || visitDuration);
  const naturalArrival = prevFinish + (cur.travelMinutes || 0);
  const idle = cur.arrivalMinutes - naturalArrival;
  return idle > 1 ? Math.round(idle) : 0;
}

// Shared by both single-patient and "add all" flows — applies a list of
// additions, tracks pending cross-day pulls for each, re-optimizes order,
// and re-applies this day's route direction (nearestNeighborOrder is
// always closest-first on its own).
// Detects a fixed-time anchor whose ACTUAL computed arrival (already
// self-corrected by computeTimingForDay's Math.max floor) is running later
// than its own true target — i.e. congestion earlier in the route is
// making the appointment start late today. Shared by any flow that can
// reorder or add stops, since all of them can cause this.
function detectAnchorOverflow(stops) {
  for (const cur of stops) {
    if (cur.manualArrivalOverride == null) continue;
    if (cur.arrivalMinutes > cur.manualArrivalOverride) {
      return { id: cur.id, name: cur.name, anchorTime: cur.manualArrivalOverride, actualTime: cur.arrivalMinutes };
    }
  }
  return null;
}

// Checks for a fixed-time anchor running behind its own target and prompts
// if found. This is purely informational now — the true target time is
// never overwritten (that was the actual bug), so "keep it" needs no
// action at all; the display already reflects reality correctly. Only
// "undo" does anything, reverting whatever change was just made. Returns
// true if the caller should proceed with its normal success messaging,
// false if it reverted instead.
async function checkAndHandleAnchorOverflow(stops, onRevert) {
  const conflict = detectAnchorOverflow(stops);
  if (!conflict) return true;
  const proceed = confirm(
    `This delays ${conflict.name}'s fixed ${minutesToClock(conflict.anchorTime)} appointment to ${minutesToClock(conflict.actualTime)} given the current schedule.\n\nOK = that's fine, keep this change.\nCancel = undo this change instead.`
  );
  if (proceed) {
    return true;
  } else {
    await onRevert();
    return false;
  }
}

async function applyDayReviewAdditions(toAdd) {
  if (toAdd.length === 0) return;
  toAdd.forEach(m => {
    const elsewhere = findPatientElsewhereInBatch(dayReviewContext.batchType, m.id, dayReviewContext.dayIdx);
    if (elsewhere) dayReviewContext.pendingPulls[m.id] = elsewhere.dayIdx;
  });
  dayReviewContext.scheduled = dayReviewContext.scheduled.concat(toAdd);
  dayReviewContext.scheduled = nearestNeighborOrder(dayReviewContext.startCoords.lat, dayReviewContext.startCoords.lng, dayReviewContext.scheduled);
  if (dayReviewContext.routeDirection === 'furthest') {
    dayReviewContext.scheduled = dayReviewContext.scheduled.slice().reverse();
  }
  if (dayReviewMap) dayReviewMap.closePopup();
  await recalcDayReview();

  await checkAndHandleAnchorOverflow(
    dayReviewContext.computedStops,
    async () => {
      toAdd.forEach(m => {
        dayReviewContext.scheduled = dayReviewContext.scheduled.filter(s => s.id !== m.id);
        delete dayReviewContext.pendingPulls[m.id];
      });
      await recalcDayReview();
    }
  );

  // Keep the search panel open instead of clearing it — refresh with the
  // same term so anyone still available (e.g. the rest of a household)
  // stays visible without having to re-type or remember their name.
  const searchInput = document.getElementById('dayReviewSearchInput');
  if (searchInput && searchInput.value.trim()) {
    renderDayReviewSearchResults(searchInput.value.trim());
  }
}

window.addToDayReview = async function (patientId) {
  if (!dayReviewContext) return;
  if (dayReviewContext.scheduled.some(s => s.id === patientId)) return;
  const p = patients.find(pt => pt.id === patientId);
  if (!p) return;
  await applyDayReviewAdditions([p]);
};

// Explicit "add everyone at this address" — a real availability difference
// (one person can meet, another can't) means bundling should be a choice,
// not automatic. Still respects a manual override: an outlier deliberately
// moved to a different group is never included, same as generation.
window.addAllAtLocationToDayReview = async function (patientId) {
  if (!dayReviewContext) return;
  const p = patients.find(pt => pt.id === patientId);
  if (!p) return;
  const allAtLocation = patients.filter(q => q.lat !== null && q.lng !== null && isSameLocation(p, q));
  const units = splitManualOutliers([allAtLocation]);
  const targetUnit = units.find(u => u.some(m => m.id === patientId)) || [p];
  const toAdd = targetUnit.filter(m => !dayReviewContext.scheduled.some(s => s.id === m.id));
  await applyDayReviewAdditions(toAdd);
};

window.removeFromDayReview = async function (patientId) {
  if (!dayReviewContext) return;
  dayReviewContext.scheduled = dayReviewContext.scheduled.filter(s => s.id !== patientId);
  // If they were only in this day's list because of a pull made THIS session,
  // clear the pending pull — removing them again fully undoes that action,
  // leaving their origin day untouched, exactly as if the pull never happened.
  delete dayReviewContext.pendingPulls[patientId];
  if (dayReviewMap) dayReviewMap.closePopup();
  await recalcDayReview();
};

window.removeAllAtLocationFromDayReview = async function (patientId) {
  if (!dayReviewContext) return;
  const anchor = dayReviewContext.scheduled.find(s => s.id === patientId);
  if (!anchor) return;
  const toRemoveIds = new Set(dayReviewContext.scheduled.filter(s => isSameLocation(anchor, s)).map(s => s.id));
  dayReviewContext.scheduled = dayReviewContext.scheduled.filter(s => !toRemoveIds.has(s.id));
  toRemoveIds.forEach(id => delete dayReviewContext.pendingPulls[id]);
  if (dayReviewMap) dayReviewMap.closePopup();
  await recalcDayReview();
};

window.confirmDayReview = async function () {
  if (!dayReviewContext) return;
  const { batchType, dayIdx, pendingPulls } = dayReviewContext;
  const results = getBatchResults(batchType);

  if (batchType === 'month') pushMonthUndoSnapshot();
  if (batchType === 'week') pushWeekUndoSnapshot();

  const btn = document.getElementById('dayReviewConfirmBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Recalculating affected days...';

  try {
    // Commit this day's final state.
    results[dayIdx].stops = dayReviewContext.computedStops;
    results[dayIdx].totalHours = dayReviewContext.totalHours;
    results[dayIdx].usingRealRoads = dayReviewContext.usingRealRoads;
    results[dayIdx].dayStartMinutes = dayReviewContext.dayStartMinutes;
    results[dayIdx].returnHomeMinutes = dayReviewContext.returnHomeMinutes;
    results[dayIdx].returnTripMinutes = dayReviewContext.returnTripMinutes;
    results[dayIdx].returnTripMiles = dayReviewContext.returnTripMiles;

    // Any patient pulled from another day: remove them there and recompute
    // that day's times too (order is left as-is — removing one stop doesn't
    // need a full re-optimize, same reasoning as Daily's "Remove from route").
    const affectedOriginDays = new Set(Object.values(pendingPulls));
    for (const originDayIdx of affectedOriginDays) {
      const originDay = results[originDayIdx];
      if (!originDay || !originDay.stops) continue;
      const remaining = originDay.stops.filter(s => pendingPulls[s.id] !== originDayIdx);
      const originStartCoords = batchType === 'week' ? weekStartCoordsGlobal : monthStartCoordsGlobal;
      const originStartTime = batchType === 'week'
        ? (document.getElementById('weekStartTime').value || '08:00')
        : (document.getElementById('monthStartTime').value || '08:00');
      const originVisitDuration = batchType === 'week'
        ? (parseFloat(document.getElementById('weekVisitDuration').value) || 15)
        : (parseFloat(document.getElementById('monthVisitDuration').value) || 15);
      if (remaining.length > 0) {
        const timing = await computeTimingForDay(originStartCoords, remaining, originStartTime, originVisitDuration);
        originDay.stops = timing.stops;
        originDay.totalHours = timing.totalHours;
        originDay.usingRealRoads = timing.usingRealRoads;
        originDay.dayStartMinutes = timing.dayStartMinutes;
        originDay.returnHomeMinutes = timing.returnHomeMinutes;
        originDay.returnTripMinutes = timing.returnTripMinutes;
        originDay.returnTripMiles = timing.returnTripMiles;
      } else {
        originDay.stops = [];
        originDay.totalHours = 0;
      }
    }

    if (batchType === 'week') renderWeekResults(); else renderMonthResults();
    document.getElementById('dayReviewModal').style.display = 'none';
    dayReviewContext = null;
  } catch (e) {
    console.error('confirmDayReview failed', e);
    alert('Something went wrong recalculating — try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = '✔ Confirm';
  }
};

window.cancelDayReview = function () {
  // True no-op revert — nothing in weekResults/monthResults was ever touched.
  dayReviewContext = null;
  document.getElementById('dayReviewModal').style.display = 'none';
};

function wireDayReviewUI() {
  document.getElementById('dayReviewCloseX').addEventListener('click', window.cancelDayReview);
  document.getElementById('dayReviewCancelBtn').addEventListener('click', window.cancelDayReview);
  document.getElementById('dayReviewConfirmBtn').addEventListener('click', window.confirmDayReview);
  document.getElementById('dayReviewSearchInput').addEventListener('input', (e) => renderDayReviewSearchResults(e.target.value.trim()));
}

function wireMonthlyUI() {
  document.getElementById('monthlyModeBtn').addEventListener('click', () => switchScheduleMode('monthly'));
  document.getElementById('generateMonthBtn').addEventListener('click', generateMonth);
  document.getElementById('approveMonthBtn').addEventListener('click', approveMonth);
  document.getElementById('cancelMonthBtn').addEventListener('click', cancelMonth);
  document.getElementById('monthPicker').addEventListener('change', renderMonthWeekPatternRows);
  document.getElementById('exportApprovedMonthBtn').addEventListener('click', () => {
    const monthVal = document.getElementById('monthPicker').value;
    if (!monthVal) { setMonthStatus('Pick a month first.', 'error'); return; }
    const [y, m] = monthVal.split('-').map(Number);
    const schedules = loadSchedules();
    const entries = [];
    Object.keys(schedules).forEach(dateStr => {
      const d = new Date(dateStr + 'T00:00:00');
      if (d.getFullYear() === y && d.getMonth() === m - 1) {
        schedules[dateStr].forEach(p => entries.push({ ...p, date: dateStr }));
      }
    });
    if (entries.length === 0) { setMonthStatus(`No approved schedule found for ${monthVal} — generate and approve first.`, 'error'); return; }
    downloadScheduleCsv(entries, `schedule-${monthVal}.csv`);
  });
  document.getElementById('undoMonthBtn').addEventListener('click', window.undoMonthChange);
  document.getElementById('undoAllMonthBtn').addEventListener('click', window.undoAllMonthChanges);
}

async function generateRoute() {
  const groupSel = document.getElementById('groupSelect');
  const group = groupSel.value;
  const group2Raw = document.getElementById('groupSelect2').value;
  const group2 = (group !== '__ANY__' && group2Raw && group2Raw !== group) ? group2Raw : null;
  const stopCount = parseInt(document.getElementById('stopCount').value, 10) || 0;
  const startAddrId = document.getElementById('startAddressSelect').value;
  const scheduleDate = document.getElementById('scheduleDate').value || new Date().toISOString().slice(0, 10);
  const includeRecent = document.getElementById('includeRecent').checked;
  const routeDirection = document.getElementById('routeDirection').value;
  const startTimeStr = document.getElementById('startTime').value || '08:00';
  const visitDuration = parseFloat(document.getElementById('visitDuration').value) || 15;
  const returnTimeStr = document.getElementById('returnTime').value;
  const returnTimeMinutes = returnTimeStr ? timeInputValueToMinutes(returnTimeStr) : null;
  const isMixMode = group === '__ANY__';
  const strictGroup = !isMixMode; // picking a specific group = stay in it by default; "Closest Mix" = ignore group boundaries

  if (!group) { setScheduleStatus('Pick a group first — none found. Upload patients and set a radius on the Clients tab.', 'error'); return; }
  if (!startAddrId) { setScheduleStatus('Pick or add a starting address.', 'error'); return; }

  const genBtn = document.getElementById('generateRouteBtn');
  genBtn.disabled = true;
  genBtn.textContent = '⏳ Calculating real drive times...';
  setScheduleStatus('Looking up real road routes (up to 8 seconds, then falls back automatically if unavailable)...', '');

  try {
    const saved = loadStartAddresses().find(a => a.id === startAddrId);
    if (!saved) { setScheduleStatus('That saved address could not be found — try re-adding it.', 'error'); return; }
    startCoords = { lat: saved.lat, lng: saved.lng };

    const result = selectRoutePatients({ group, group2, stopCount, startCoords, scheduleDate, includeRecent, routeDirection });
    if (result.error) { setScheduleStatus(result.error, 'error'); return; }

    let finalScheduled = result.scheduled;
    let returnTimeException = false;
    let returnTimeTrimmedCount = 0;
    if (returnTimeMinutes) {
      const trimResult = await trimStopsToReturnTime(startCoords, result.scheduled, startTimeStr, visitDuration, returnTimeMinutes);
      const keptIds = new Set(trimResult.stops.map(s => s.id));
      finalScheduled = result.scheduled.filter(p => keptIds.has(p.id));
      returnTimeException = trimResult.returnTimeException;
      returnTimeTrimmedCount = result.scheduled.length - finalScheduled.length;
    }

    scheduledPatients = finalScheduled;
    // Anyone trimmed for return-time goes back into the available pool —
    // still due, just not automatically included today.
    const trimmedOut = result.scheduled.filter(p => !finalScheduled.some(f => f.id === p.id));
    leftoverPatients = result.leftover.concat(trimmedOut);

    document.getElementById('routeBuilderCard').style.display = 'block';
    await recalcAndRender();
    const addedNote = result.addressMateCount > 0 ? ` (+${result.addressMateCount} same-address patient(s) added automatically.)` : '';
    const excludedNote = result.excludedCount > 0 ? ` (${result.excludedCount} recently-visited patient(s) excluded.)` : '';
    const returnTimeNote = returnTimeException
      ? ` ‼️ You'll be home past ${minutesToClock(returnTimeMinutes)} — everyone at one address had to stay together and alone that visit runs past your target return time.`
      : (returnTimeTrimmedCount > 0 ? ` ⏱️ ${returnTimeTrimmedCount} patient(s) held back to make your ${minutesToClock(returnTimeMinutes)} return time — still due, available to add another day.` : '');
    let statusMsg;
    if (result.strictGroup) {
      const fillNote = result.fillCount > 0 ? ` Group ${group} only had ${result.groupOnlyCount} available, so ${result.fillCount} nearby patient(s) from other groups were added to reach ${stopCount}.` : '';
      statusMsg = `Route generated for Group ${group}${group2 ? ' + ' + group2 : ''}.` + excludedNote + addedNote + fillNote + returnTimeNote;
    } else {
      const groupsUsed = Array.from(new Set(scheduledPatients.map(p => p.group || 'unassigned'))).sort();
      statusMsg = `Route generated: closest ${scheduledPatients.length} patient(s) to your starting address, drawn from group(s) ${groupsUsed.join(', ')}.` + excludedNote + addedNote + returnTimeNote;
    }
    setScheduleStatus(statusMsg, returnTimeException ? 'error' : 'success');
  } catch (e) {
    console.error('generateRoute failed', e);
    setScheduleStatus('Something went wrong generating the route. Try again.', 'error');
  } finally {
    genBtn.disabled = false;
    genBtn.textContent = 'Generate Route';
  }
}

/* ============================================
   REAL ROAD ROUTING (free OSRM public API — with
   straight-line fallback if it's unreachable)
   ============================================ */
async function fetchRouteLegs(startLat, startLng, stops) {
  if (stops.length === 0) return { legs: [], geometry: null };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // never hang more than 8s
  try {
    // Round trip: start -> each stop in order -> back to start, so the
    // last leg gives us a real "arrive home" estimate too.
    const coordList = [[startLng, startLat], ...stops.map(s => [s.lng, s.lat]), [startLng, startLat]];
    const coordStr = coordList.map(c => c.join(',')).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes[0]) return null;
    const legs = data.routes[0].legs.map(leg => ({
      minutes: leg.duration / 60,
      miles: leg.distance / 1609.34
    }));
    // GeoJSON gives [lng, lat] pairs; Leaflet wants [lat, lng].
    const geometry = data.routes[0].geometry && data.routes[0].geometry.coordinates
      ? data.routes[0].geometry.coordinates.map(c => [c[1], c[0]])
      : null;
    return { legs, geometry };
  } catch (e) {
    clearTimeout(timeoutId);
    console.error('Real-road routing unavailable (timed out or failed), falling back to straight-line estimate', e);
    return null;
  }
}

async function recalcAndRender() {
  const startTimeStr = document.getElementById('startTime').value || '08:00';
  const visitDuration = parseFloat(document.getElementById('visitDuration').value) || 15;
  const maxHours = parseFloat(document.getElementById('maxHours').value) || 7;

  const [h, m] = startTimeStr.split(':').map(Number);
  let cursorMinutes = h * 60 + m;
  const dayStartMinutes = cursorMinutes;

  let legs = null;
  lastRouteGeometry = null;
  if (startCoords && scheduledPatients.length > 0) {
    const result = await fetchRouteLegs(startCoords.lat, startCoords.lng, scheduledPatients);
    if (result) {
      legs = result.legs;
      lastRouteGeometry = result.geometry;
    }
  }
  const usingRealRoads = !!legs;

  let prevLat = startCoords ? startCoords.lat : null;
  let prevLng = startCoords ? startCoords.lng : null;
  let prevPatient = null;
  let totalDriveMiles = 0;
  let totalDriveMinutes = 0;

  scheduledPatients.forEach((p, i) => {
    const sameAsPrev = prevPatient && isSameLocation(prevPatient, p);
    if (prevLat !== null && !sameAsPrev) {
      if (legs && legs[i]) {
        p.travelMiles = legs[i].miles;
        p.travelMinutes = legs[i].minutes;
      } else {
        const miles = haversineMiles(prevLat, prevLng, p.lat, p.lng);
        p.travelMiles = miles;
        p.travelMinutes = milesToMinutes(miles);
      }
      cursorMinutes += p.travelMinutes;
      totalDriveMiles += p.travelMiles;
      totalDriveMinutes += p.travelMinutes;
    } else {
      // Same address as the previous stop (couple / same building) — no drive needed.
      p.travelMiles = 0;
      p.travelMinutes = 0;
    }
    // A manually-edited arrival time (known delay, traffic, a chatty prior
    // visit) becomes the new anchor — every stop after it cascades forward
    // from here instead of the originally-computed time.
    if (p.manualArrivalOverride != null) {
      cursorMinutes = p.manualArrivalOverride;
    }
    p.arrivalMinutes = cursorMinutes;
    p.visitDuration = p.visitDuration || visitDuration;
    cursorMinutes += p.visitDuration;
    prevLat = p.lat; prevLng = p.lng; prevPatient = p;
  });

  // Return-to-home leg, for the "arrive home" summary.
  let returnTripMinutes = 0;
  let returnTripMiles = 0;
  if (startCoords && scheduledPatients.length > 0) {
    if (legs && legs[legs.length - 1]) {
      returnTripMinutes = legs[legs.length - 1].minutes;
      returnTripMiles = legs[legs.length - 1].miles;
    } else {
      const last = scheduledPatients[scheduledPatients.length - 1];
      returnTripMiles = haversineMiles(last.lat, last.lng, startCoords.lat, startCoords.lng);
      returnTripMinutes = milesToMinutes(returnTripMiles);
    }
  }
  const returnHomeMinutes = cursorMinutes + returnTripMinutes;
  totalDriveMiles += returnTripMiles;
  totalDriveMinutes += returnTripMinutes;
  renderRouteSummary(dayStartMinutes, returnHomeMinutes, usingRealRoads, returnTripMinutes, returnTripMiles, totalDriveMiles, totalDriveMinutes);

  const totalHours = (cursorMinutes - dayStartMinutes) / 60;
  renderScheduleLists();
  renderMap();
  return totalHours;
}

function minutesToClock(totalMinutes) {
  let h = Math.floor(totalMinutes / 60) % 24;
  const m = Math.round(totalMinutes % 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function minutesToTimeInputValue(totalMinutes) {
  const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function renderScheduleLists() {
  const schedEl = document.getElementById('scheduledList');
  const leftEl = document.getElementById('leftoverList');
  document.getElementById('scheduledCount').textContent = scheduledPatients.length;
  document.getElementById('leftoverCount').textContent = leftoverPatients.length;

  schedEl.innerHTML = scheduledPatients.map((p, i) => dragItemHtml(p, 'scheduled', i, true)).join('');
  leftEl.innerHTML = leftoverPatients.map((p, i) => dragItemHtml(p, 'leftover', i, false)).join('');

  attachDragHandlers();
}

function renderRouteSummary(startMinutes, returnHomeMinutes, usingRealRoads, returnTripMinutes, returnTripMiles, totalDriveMiles, totalDriveMinutes) {
  const el = document.getElementById('routeSummary');
  if (!el) return;
  if (scheduledPatients.length === 0) { el.innerHTML = ''; return; }
  const driveHrs = Math.floor(totalDriveMinutes / 60);
  const driveMins = Math.round(totalDriveMinutes % 60);
  el.innerHTML = `
    <span class="rs-item"><span class="rs-label">Start:</span> Home ${minutesToClock(startMinutes)}</span>
    <span class="rs-item"><span class="rs-label">Return trip:</span> 🚗 ${Math.round(returnTripMinutes)} min / ${returnTripMiles.toFixed(1)} mi</span>
    <span class="rs-item"><span class="rs-label">Arrive home:</span> ${minutesToClock(returnHomeMinutes)}</span>
    <span class="rs-item"><span class="rs-label">Total drive time:</span> ${driveHrs}h ${driveMins}m</span>
    <span class="rs-item"><span class="rs-label">Total miles:</span> ${totalDriveMiles.toFixed(1)} mi</span>
    <span class="rs-item"><span class="rs-label">Total day (drive + visits):</span> ${((returnHomeMinutes - startMinutes) / 60).toFixed(1)} hrs</span>
    <span class="rs-item" style="color:${usingRealRoads ? 'var(--lime-deep)' : 'var(--pink-deep)'};">${usingRealRoads ? '✓ real road times' : '⚠ straight-line estimate (routing service unreachable)'}</span>
  `;
}

function dragItemHtml(p, listName, index, showTime) {
  const highlightClass = p.justAdded ? ' highlight-new' : '';
  return `
    <li class="drag-item${highlightClass}" draggable="true" data-id="${p.id}" data-list="${listName}" data-index="${index}">
      <div class="di-name">#${index + 1} ${escapeHtml(p.name)}${p.group ? ` <span style="color:var(--text-soft); font-weight:600; font-size:0.8em;">(Grp- ${escapeHtml(p.group)})</span>` : ''}</div>
      <div class="di-meta">${escapeHtml(p.dob)} — ${escapeHtml(p.address)}</div>
      ${showTime && p.arrivalMinutes !== undefined ? `<div class="di-time">${minutesToClock(p.arrivalMinutes)}${p.manualArrivalOverride != null ? ' <span style="color:var(--pink-deep); font-weight:700; font-size:0.75em;">(edited)</span>' : ''}${p.travelMinutes ? ` <span style="color:var(--text-soft); font-weight:600;">(🚗 ${Math.round(p.travelMinutes)} min / ${p.travelMiles.toFixed(1)} mi)</span>` : ' <span style="color:var(--text-soft); font-weight:600;">(same address)</span>'} <button type="button" class="btn-tiny" style="margin-left:4px;" onclick="window.openEditArrivalLive('${p.id}')">✏️</button></div>` : ''}
    </li>
  `;
}

function attachDragHandlers() {
  document.querySelectorAll('.drag-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedId = item.getAttribute('data-id');
      draggedFrom = item.getAttribute('data-list');
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
  });

  document.querySelectorAll('.drag-list').forEach(list => {
    list.addEventListener('dragover', (e) => e.preventDefault());
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const toList = list.getAttribute('data-list');
      handleDrop(draggedId, draggedFrom, toList, e, list);
    });
  });
}

function handleDrop(id, fromList, toList, event, listEl) {
  const fromArr = fromList === 'scheduled' ? scheduledPatients : leftoverPatients;
  const toArr = toList === 'scheduled' ? scheduledPatients : leftoverPatients;

  const idx = fromArr.findIndex(p => p.id === id);
  if (idx === -1) return;
  const [moved] = fromArr.splice(idx, 1);
  delete moved.justAdded;

  // Determine insertion index based on drop position among existing items
  const items = Array.from(listEl.querySelectorAll('.drag-item'));
  let insertAt = toArr.length;
  const dropY = event.clientY;
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect();
    if (dropY < rect.top + rect.height / 2) { insertAt = i; break; }
  }
  toArr.splice(insertAt, 0, moved);

  recalcAndRender();
}

function setScheduleStatus(msg, kind) {
  const el = document.getElementById('scheduleStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-line' + (kind ? ' ' + kind : '');
}

function showOverageModal(hours, maxHours, onApprove, onGoBack) {
  const modal = document.getElementById('overageModal');
  const text = document.getElementById('overageText');
  text.textContent = `With travel and visit time, today's route is estimated at ${hours.toFixed(1)} hours — over your ${maxHours} hour limit.`;
  modal.style.display = 'flex';

  const approveBtn = document.getElementById('modalApprove');
  const goBackBtn = document.getElementById('modalGoBack');
  const cleanup = () => {
    modal.style.display = 'none';
    approveBtn.onclick = null;
    goBackBtn.onclick = null;
  };
  approveBtn.onclick = () => { cleanup(); onApprove(); };
  goBackBtn.onclick = () => { cleanup(); if (onGoBack) onGoBack(); };
}

function downloadMyMapsCsv() {
  if (scheduledPatients.length === 0) {
    setScheduleStatus('Generate a route first.', 'error');
    return;
  }
  const scheduleDate = document.getElementById('scheduleDate').value || new Date().toISOString().slice(0, 10);
  // Column order matters for My Maps' import step: it asks which column is
  // the location, so Address needs to read clearly as a full address on its own.
  const header = ['Stop', 'Name', 'Address', 'Arrival Time', 'Group'];
  const escape = (v) => {
    const s = (v ?? '').toString();
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [header.join(',')];
  scheduledPatients.forEach((p, i) => {
    lines.push([`#${i + 1}`, p.name, p.address, minutesToClock(p.arrivalMinutes), p.group || '']
      .map(escape).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mymaps-route-${scheduleDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  const help = document.getElementById('myMapsHelp');
  help.style.display = 'block';
  help.className = 'status-line success';
  help.innerHTML = `CSV downloaded. To bring it into Google My Maps: go to <strong>mymaps.google.com</strong> → Create a new map (or open today's) → <strong>Import</strong> → upload this file → when asked which column has the location, choose <strong>Address</strong> → when asked which column to use as the pin title, choose <strong>Name</strong>. Pins will appear in visit order.`;
}

function openInGoogleMaps() {
  if (!startCoords || scheduledPatients.length === 0) {
    setScheduleStatus('Generate a route first.', 'error');
    return;
  }
  if (scheduledPatients.length > 23) {
    setScheduleStatus('Google Maps supports up to ~23 stops in one link — trim the route or split it into two trips.', 'error');
    return;
  }
  const origin = `${startCoords.lat},${startCoords.lng}`;
  const last = scheduledPatients[scheduledPatients.length - 1];
  const destination = `${last.lat},${last.lng}`;
  const waypointStops = scheduledPatients.slice(0, -1);
  const waypoints = waypointStops.map(p => `${p.lat},${p.lng}`).join('|');

  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
  window.open(url, '_blank');
}

function resetRouteBuilderUI() {
  scheduledPatients = [];
  leftoverPatients = [];
  startCoords = null;
  document.getElementById('routeBuilderCard').style.display = 'none';
  document.getElementById('routeSummary').innerHTML = '';
  document.getElementById('myMapsHelp').style.display = 'none';
  if (leafletLayer) { leafletLayer.remove(); leafletLayer = null; }
}

function cancelRoute() {
  resetRouteBuilderUI();
  setScheduleStatus('Route cleared. Adjust your settings and generate again.', '');
}

function wireScheduleUI() {
  document.getElementById('generateRouteBtn').addEventListener('click', generateRoute);
  document.getElementById('cancelRouteBtn').addEventListener('click', cancelRoute);
  document.getElementById('openGoogleMapsBtn').addEventListener('click', openInGoogleMaps);
  document.getElementById('myMapsCsvBtn').addEventListener('click', downloadMyMapsCsv);

  document.getElementById('startAddressSelect').addEventListener('change', updateAddressFormVisibility);
  document.getElementById('groupSelect').addEventListener('change', updateGroup2Availability);
  document.getElementById('saveNewAddressBtn').addEventListener('click', handleSaveNewAddress);
  document.getElementById('showAddAddressBtn').addEventListener('click', () => {
    document.getElementById('startAddressSelect').value = '';
    document.getElementById('newAddressForm').style.display = 'flex';
    document.getElementById('newAddressText').focus();
  });
  document.getElementById('cancelNewAddressBtn').addEventListener('click', () => {
    document.getElementById('newAddressLabel').value = '';
    document.getElementById('newAddressText').value = '';
    const saved = loadStartAddresses();
    const sel = document.getElementById('startAddressSelect');
    if (saved.length) sel.value = saved[0].id;
    updateAddressFormVisibility();
  });

  ['startTime', 'visitDuration', 'maxHours'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (scheduledPatients.length) recalcAndRender();
    });
  });

  document.getElementById('exportScheduleCsvBtn').addEventListener('click', () => {
    if (scheduledPatients.length === 0) { setScheduleStatus('Generate a route first.', 'error'); return; }
    const scheduleDate = document.getElementById('scheduleDate').value || new Date().toISOString().slice(0, 10);
    const header = ['Name', 'DOB', 'Date', 'Time', 'Provider'];
    const escape = (v) => {
      const s = (v ?? '').toString();
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [header.join(',')];
    scheduledPatients.forEach(p => {
      lines.push([p.name, p.dob, scheduleDate, minutesToClock(p.arrivalMinutes), p.provider || '']
        .map(escape).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-${scheduleDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  async function handleApproveClick() {
    const maxHours = parseFloat(document.getElementById('maxHours').value) || 7;
    const totalHours = await recalcAndRender();
    const scheduleDate = document.getElementById('scheduleDate').value || new Date().toISOString().slice(0, 10);

    const commit = () => {
      recordApprovedSchedule(scheduleDate, scheduledPatients);
      scheduledPatients.forEach(sp => recomputeLastVisitDate(sp.id));
      savePatients();
      renderTable();
      setScheduleStatus(`✅ Schedule approved for ${scheduleDate} (${totalHours.toFixed(1)} hrs). Check the Home tab calendar to see it. Ready for the next route.`, 'success');
      resetRouteBuilderUI();
    };

    const proceedPastOverageCheck = () => {
      if (totalHours > maxHours) {
        showOverageModal(totalHours, maxHours, commit);
      } else {
        commit();
      }
    };

    const proceedPastOverwriteCheck = () => {
      if (datesWithExistingSchedule([scheduleDate]).length > 0) {
        showOverwriteConfirm(
          `${scheduleDate} already has an approved schedule. Continuing will overwrite it with today's list — the prior schedule for this date will be replaced, not merged. Continue?`,
          proceedPastOverageCheck
        );
      } else {
        proceedPastOverageCheck();
      }
    };

    const doubleBooked = findDoubleBookedPatients(scheduledPatients, [scheduleDate]);
    if (doubleBooked.length > 0) {
      const list = doubleBooked.map(c => `${c.name} (already on ${c.date})`).join(', ');
      showOverwriteConfirm(
        `⚠️ ${doubleBooked.length} patient(s) already have an approved visit on a different date: ${list}. Approving today will schedule them again — their "last visit" will reflect whichever date is most recent. Continue?`,
        proceedPastOverwriteCheck
      );
    } else {
      proceedPastOverwriteCheck();
    }
  }

  document.getElementById('approveScheduleBtn').addEventListener('click', handleApproveClick);
  document.getElementById('approveScheduleBtnTop').addEventListener('click', handleApproveClick);
}

/* ============================================
   EDIT PATIENT
   ============================================ */
let editingPatientId = null;
let editManualLat = null;
let editManualLng = null;
let editManualMap = null;
let editManualMarker = null;

window.openEditPatient = function (patientId) {
  const p = patients.find(pt => pt.id === patientId);
  if (!p) return;
  editingPatientId = patientId;
  editManualLat = null;
  editManualLng = null;
  document.getElementById('editName').value = p.name || '';
  document.getElementById('editAddress').value = p.address || '';
  document.getElementById('editDob').value = p.dob || '';
  document.getElementById('editCoordinator').value = p.coordinator || '';
  document.getElementById('editProvider').value = p.provider || '';
  document.getElementById('editLastVisit').value = p.lastVisitDate || '';
  document.getElementById('editStatus').textContent = '';

  const wrap = document.getElementById('editManualPlaceWrap');
  const needsManualPlacement = p.lat === null || p.lng === null || p.geocodeFailed;
  wrap.style.display = needsManualPlacement ? 'block' : 'none';
  document.getElementById('editManualCoordsLabel').textContent = '';

  document.getElementById('editPatientModal').style.display = 'flex';

  if (needsManualPlacement) {
    // Defer to the next tick so the modal is actually visible before Leaflet measures the container.
    setTimeout(() => initEditManualMap(p), 50);
  }
};

function initEditManualMap(p) {
  if (editManualMap) { editManualMap.remove(); editManualMap = null; }
  editManualMarker = null;

  // Center on the practice's saved starting address as a reasonable default
  // service-area view — the person zooms/pans from there to find the house.
  const saved = loadStartAddresses();
  const center = (p.lat !== null && p.lng !== null)
    ? [p.lat, p.lng]
    : (saved.length > 0 ? [saved[0].lat, saved[0].lng] : [32.7767, -96.7970]); // DFW area fallback if nothing else is set

  editManualMap = L.map('editManualMap').setView(center, 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(editManualMap);

  if (p.lat !== null && p.lng !== null) {
    editManualMarker = L.marker([p.lat, p.lng]).addTo(editManualMap);
    editManualLat = p.lat; editManualLng = p.lng;
  }

  editManualMap.on('click', (e) => {
    editManualLat = e.latlng.lat;
    editManualLng = e.latlng.lng;
    if (editManualMarker) editManualMarker.setLatLng(e.latlng);
    else editManualMarker = L.marker(e.latlng).addTo(editManualMap);
    document.getElementById('editManualCoordsLabel').textContent = `Location set: ${editManualLat.toFixed(5)}, ${editManualLng.toFixed(5)}`;
  });

  setTimeout(() => editManualMap.invalidateSize(), 100);
}

async function saveEditedPatient() {
  const p = patients.find(pt => pt.id === editingPatientId);
  if (!p) return;

  const newAddress = document.getElementById('editAddress').value.trim();
  const addressChanged = newAddress !== p.address;

  p.name = document.getElementById('editName').value.trim();
  p.address = newAddress;
  p.dob = document.getElementById('editDob').value.trim();
  p.coordinator = document.getElementById('editCoordinator').value.trim();
  p.provider = document.getElementById('editProvider').value.trim();
  p.lastVisitDate = document.getElementById('editLastVisit').value || null;

  if (editManualLat !== null && editManualLng !== null) {
    // Manual placement was made this session — this always wins over
    // auto-geocoding, since it's a deliberate correction for an address
    // the geocoder couldn't find on its own.
    p.lat = editManualLat; p.lng = editManualLng; p.geocodeFailed = false;
  } else if (addressChanged) {
    const statusEl = document.getElementById('editStatus');
    statusEl.textContent = 'Re-checking that address...';
    try {
      const coords = await geocodeAddress(newAddress);
      if (coords) {
        p.lat = coords.lat; p.lng = coords.lng; p.geocodeFailed = false;
      } else {
        p.lat = null; p.lng = null; p.geocodeFailed = true;
        statusEl.textContent = 'Address still not found — saved anyway, but it won\'t be groupable until fixed.';
      }
    } catch (e) {
      p.geocodeFailed = true;
    }
  }

  savePatients();
  renderTable();
  populateProviderFilter();
  const gotNewCoords = editManualLat !== null && editManualLng !== null;
  if (addressChanged || gotNewCoords) regroup(); else renderGroupSummary();

  if (editManualMap) { editManualMap.remove(); editManualMap = null; }
  editManualLat = null;
  editManualLng = null;

  document.getElementById('editPatientModal').style.display = 'none';
  editingPatientId = null;
}

function wireEditModal() {
  document.getElementById('editSaveBtn').addEventListener('click', saveEditedPatient);
  document.getElementById('editCancelBtn').addEventListener('click', () => {
    document.getElementById('editPatientModal').style.display = 'none';
    editingPatientId = null;
    if (editManualMap) { editManualMap.remove(); editManualMap = null; }
    editManualLat = null;
    editManualLng = null;
  });
}

/* ============================================
   CALENDAR (Home tab)
   ============================================ */
let calendarViewDate = new Date();

function loadSchedules() {
  try {
    const raw = localStorage.getItem(SCHEDULES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function saveSchedules(obj) {
  localStorage.setItem(SCHEDULES_KEY, JSON.stringify(obj));
}

/**
 * The correct fix for a real bug: lastVisitDate used to be a manually-kept
 * field, set on approve and (supposedly) cleared on removal — but a patient
 * scheduled on two different dates would have the field silently overwritten
 * by whichever was approved most recently, and removing one date had no way
 * to "fall back" to the other. Rather than patch each removal site to try
 * to keep a separate field in sync, this derives it fresh from the actual
 * schedule data every time: scan every approved day, find the most recent
 * one that still contains this patient, done. No separate value to drift.
 * Call this after ANY mutation to the schedules object for a patient
 * (approve, remove, cancel, move) instead of hand-editing lastVisitDate.
 */
function recomputeLastVisitDate(patientId) {
  const schedules = loadSchedules();
  let mostRecent = null;
  Object.keys(schedules).forEach(dateStr => {
    if (schedules[dateStr].some(entry => entry.id === patientId)) {
      if (!mostRecent || dateStr > mostRecent) mostRecent = dateStr;
    }
  });
  const master = patients.find(p => p.id === patientId);
  if (master) master.lastVisitDate = mostRecent;
}

/**
 * Hard reset for every patient at once, straight from the calendar's own
 * schedule data — no fallback to whatever was already sitting on the
 * patient record. This is the direct fix for values that got stuck for a
 * reason recomputeLastVisitDate alone can't catch: a CSV "replace" upload
 * assigns every patient a brand-new internal ID with no link to the old
 * one, so any older schedule entry silently stops matching by ID. This
 * matches by NAME instead to bypass that — it answers "does any schedule
 * entry for someone with this name exist" and sets the date from that.
 */
function recomputeAllLastVisitDates() {
  const schedules = loadSchedules();
  const mostRecentByName = {};
  Object.keys(schedules).forEach(dateStr => {
    schedules[dateStr].forEach(entry => {
      const key = (entry.name || '').trim().toLowerCase();
      if (!key) return;
      if (!mostRecentByName[key] || dateStr > mostRecentByName[key]) mostRecentByName[key] = dateStr;
    });
  });
  let changed = 0;
  patients.forEach(p => {
    const key = (p.name || '').trim().toLowerCase();
    const newVal = mostRecentByName[key] || null;
    if (p.lastVisitDate !== newVal) changed++;
    p.lastVisitDate = newVal;
  });
  savePatients();
  return changed;
}
function datesWithExistingSchedule(dates) {
  const schedules = loadSchedules();
  return dates.filter(d => schedules[d] && schedules[d].length > 0);
}

function showOverwriteConfirm(message, onConfirm) {
  const modal = document.getElementById('overwriteModal');
  document.getElementById('overwriteText').textContent = message;
  document.getElementById('overwriteActions').innerHTML = `
    <button id="overwriteCancelBtn" class="btn btn-secondary" type="button">Cancel</button>
    <button id="overwriteConfirmBtn" class="btn btn-primary" type="button">Yes, Overwrite</button>
  `;
  modal.style.display = 'flex';
  document.getElementById('overwriteCancelBtn').addEventListener('click', () => { modal.style.display = 'none'; });
  document.getElementById('overwriteConfirmBtn').addEventListener('click', () => {
    modal.style.display = 'none';
    onConfirm();
  });
}

function recordApprovedSchedule(dateStr, list) {
  const schedules = loadSchedules();
  schedules[dateStr] = list.map(p => ({
    id: p.id, name: p.name, dob: p.dob, address: p.address,
    group: p.group, provider: p.provider, arrivalMinutes: p.arrivalMinutes,
    lat: p.lat, lng: p.lng
  }));
  saveSchedules(schedules);
}

function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function hexToRgbaTint(color, alpha) {
  if (!color || color.startsWith('hsl')) return color; // overflow-palette colors used as-is, no tint needed
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  const label = document.getElementById('calendarMonthLabel');
  if (!grid || !label) return;

  const y = calendarViewDate.getFullYear();
  const m = calendarViewDate.getMonth();
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  label.textContent = `${monthNames[m]} ${y}`;

  const schedules = loadSchedules();
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayKey = dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = dows.map(d => `<div class="cal-dow">${d}</div>`).join('');

  for (let i = 0; i < firstDow; i++) html += `<div class="cal-day cal-empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(y, m, d);
    const dayList = schedules[key];
    const count = dayList ? dayList.length : 0;
    const classes = ['cal-day'];
    if (count > 0) classes.push('cal-has-schedule');
    if (key === todayKey) classes.push('cal-today');

    let styleAttr = '';
    let dotsHtml = '';
    if (count > 0) {
      const groupsUsed = Array.from(new Set(dayList.map(p => p.group || 'unassigned')));
      const primaryColor = groupColor(groupsUsed[0]);
      styleAttr = `style="border-top: 4px solid ${primaryColor}; background: ${hexToRgbaTint(primaryColor, 0.22)};"`;
      if (groupsUsed.length > 1) {
        dotsHtml = `<div class="cal-day-dots">${groupsUsed.slice(0, 5).map(g => `<span class="cal-dot" style="background:${groupColor(g)}"></span>`).join('')}</div>`;
      }
    }

    html += `
      <div class="${classes.join(' ')}" data-date="${key}" draggable="${count > 0}" ${styleAttr}>
        <span class="cal-day-num">${d}</span>
        ${count > 0 ? `<span class="cal-day-count">${count}</span>` : ''}
        ${dotsHtml}
      </div>
    `;
  }
  grid.innerHTML = html;

  const dayCells = grid.querySelectorAll('.cal-day:not(.cal-empty)');
  dayCells.forEach(cell => {
    cell.addEventListener('click', () => showCalendarDay(cell.getAttribute('data-date')));

    cell.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', cell.getAttribute('data-date'));
    });
    cell.addEventListener('dragover', (e) => e.preventDefault());
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromDate = e.dataTransfer.getData('text/plain');
      const toDate = cell.getAttribute('data-date');
      if (fromDate && toDate && fromDate !== toDate) moveWholeDay(fromDate, toDate);
    });
  });
}

function moveWholeDay(fromDate, toDate) {
  const schedules = loadSchedules();
  const fromList = schedules[fromDate];
  if (!fromList || fromList.length === 0) return;

  if (schedules[toDate] && schedules[toDate].length > 0) {
    if (!confirm(`${toDate} already has a schedule. Overwrite it with ${fromDate}'s ${fromList.length} patient(s)?`)) return;
  }

  schedules[toDate] = fromList;
  delete schedules[fromDate];
  saveSchedules(schedules);

  fromList.forEach(entry => recomputeLastVisitDate(entry.id));
  savePatients();
  renderTable();
  renderCalendar();
}

window.cancelDaySchedule = function (dateStr) {
  const schedules = loadSchedules();
  const list = schedules[dateStr] || [];
  if (list.length === 0) { alert('Nothing scheduled on this day.'); return; }
  if (!confirm(`Cancel the entire schedule for ${dateStr}? This removes all ${list.length} patient(s) from the calendar for this day and cannot be undone.`)) return;

  delete schedules[dateStr];
  saveSchedules(schedules);
  list.forEach(entry => recomputeLastVisitDate(entry.id));
  savePatients();
  renderTable();
  renderCalendar();
  document.getElementById('dayDetailModal').style.display = 'none';
};

window.cancelWeekSchedule = function (dateStr) {
  const monday = mondayOf(dateStr);
  const weekDates = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    weekDates.push(dateKey(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  const schedules = loadSchedules();
  const totalPatients = weekDates.reduce((sum, d) => sum + (schedules[d] ? schedules[d].length : 0), 0);
  if (totalPatients === 0) { alert('Nothing scheduled that week.'); return; }
  if (!confirm(`Cancel the entire week's schedule (${weekDates[0]} through ${weekDates[4]})? This removes all ${totalPatients} patient visit(s) across those 5 days and cannot be undone.`)) return;

  const affectedIds = new Set();
  weekDates.forEach(d => {
    const list = schedules[d] || [];
    list.forEach(entry => affectedIds.add(entry.id));
    delete schedules[d];
  });
  saveSchedules(schedules);
  affectedIds.forEach(id => recomputeLastVisitDate(id));
  savePatients();
  renderTable();
  renderCalendar();
  document.getElementById('dayDetailModal').style.display = 'none';
};

window.cancelMonthSchedule = function (dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const y = d.getFullYear();
  const m = d.getMonth();

  const schedules = loadSchedules();
  const datesInMonth = Object.keys(schedules).filter(ds => {
    const dd = new Date(ds + 'T00:00:00');
    return dd.getFullYear() === y && dd.getMonth() === m;
  });
  const totalPatients = datesInMonth.reduce((sum, ds) => sum + schedules[ds].length, 0);
  if (totalPatients === 0) { alert('Nothing scheduled that month.'); return; }
  if (!confirm(`Cancel the ENTIRE month's schedule (${datesInMonth.length} day(s), ${totalPatients} patient visit(s) total)? This cannot be undone.`)) return;

  const affectedIds = new Set();
  datesInMonth.forEach(ds => {
    schedules[ds].forEach(entry => affectedIds.add(entry.id));
    delete schedules[ds];
  });
  saveSchedules(schedules);
  affectedIds.forEach(id => recomputeLastVisitDate(id));
  savePatients();
  renderTable();
  renderCalendar();
  document.getElementById('dayDetailModal').style.display = 'none';
};

window.openCalendarDayInGoogleMaps = function (dateStr) {
  const schedules = loadSchedules();
  const list = schedules[dateStr] || [];
  if (list.length === 0) { alert('No stops to map for this day.'); return; }

  // Older approved days may not have lat/lng stored on the entry itself —
  // fall back to a live lookup by id against the current patient list.
  const resolved = list
    .map(entry => (entry.lat != null && entry.lng != null) ? entry : { ...entry, ...(patients.find(p => p.id === entry.id) || {}) })
    .filter(e => e.lat != null && e.lng != null);

  if (resolved.length === 0) { alert('Could not find coordinates for these patients — they may have been edited or removed since.'); return; }
  if (resolved.length > 23) { alert('Google Maps supports up to ~23 stops in one link — this day has more.'); return; }

  const savedAddrs = loadStartAddresses();
  const destination = `${resolved[resolved.length - 1].lat},${resolved[resolved.length - 1].lng}`;
  let origin, waypointStops;

  if (savedAddrs.length > 0) {
    origin = `${savedAddrs[0].lat},${savedAddrs[0].lng}`;
    waypointStops = resolved.slice(0, -1);
  } else {
    origin = `${resolved[0].lat},${resolved[0].lng}`;
    waypointStops = resolved.slice(1, -1);
  }

  const waypoints = waypointStops.map(s => `${s.lat},${s.lng}`).join('|');
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
  window.open(url, '_blank');
};

function showCalendarDay(dateStr) {
  const schedules = loadSchedules();
  const list = schedules[dateStr] || [];
  const modal = document.getElementById('dayDetailModal');
  const title = document.getElementById('dayDetailTitle');
  const subtitle = document.getElementById('dayDetailSubtitle');
  const listEl = document.getElementById('dayDetailList');

  title.textContent = dateStr;
  modal.style.display = 'flex';
  modal.setAttribute('data-current-date', dateStr);

  if (list.length === 0) {
    subtitle.textContent = 'No approved schedule for this day.';
    listEl.innerHTML = '';
    return;
  }
  subtitle.textContent = `${list.length} patient(s) scheduled — drag this day\'s tile on the calendar to move the whole schedule, or use the buttons below to adjust one patient.`;
  listEl.innerHTML = list.map((p, i) => `
    <div class="cal-detail-item">
      <div class="di-name">#${i + 1} ${escapeHtml(p.name)}</div>
      <div class="di-meta">
        ${p.arrivalMinutes !== undefined ? minutesToClock(p.arrivalMinutes) + ' — ' : ''}
        Group ${escapeHtml(p.group || '—')}${p.provider ? ' — ' + escapeHtml(p.provider) : ''}
      </div>
      <div class="di-meta">${escapeHtml(p.dob || '')} ${p.address ? '— ' + escapeHtml(p.address) : ''}</div>
      <div class="item-actions">
        <button type="button" class="btn-tiny btn-tiny-danger" onclick="window.removeFromDaySchedule('${dateStr}','${p.id}')">↩️ Remove to Leftover</button>
        <button type="button" class="btn-tiny" onclick="window.changePatientDate('${dateStr}','${p.id}')">🗓️ Change Date</button>
        <button type="button" class="btn-tiny" onclick="window.openEditArrivalCalendar('${dateStr}','${p.id}')">✏️ Edit Time</button>
      </div>
    </div>
  `).join('');
}

let pendingArrivalEdit = null; // { context: 'live' | 'calendar', patientId, dateStr }

function timeInputValueToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

window.openEditArrivalLive = function (patientId) {
  const p = scheduledPatients.find(sp => sp.id === patientId);
  if (!p || p.arrivalMinutes === undefined) return;
  pendingArrivalEdit = { context: 'live', patientId };

  document.getElementById('editArrivalSubtitle').textContent = `${p.name} — scheduled arrival, adjust for known delays (traffic, a longer prior visit, etc.)`;
  document.getElementById('editArrivalInput').value = minutesToTimeInputValue(p.arrivalMinutes);
  document.getElementById('editArrivalNote').textContent = 'Everyone after this stop will shift to start from the new time.';
  document.getElementById('editArrivalNote').className = 'status-line';
  document.getElementById('editArrivalResetBtn').style.display = p.manualArrivalOverride != null ? 'inline-block' : 'none';
  document.getElementById('editArrivalModal').style.display = 'flex';
};

window.openEditArrivalCalendar = function (dateStr, patientId) {
  const schedules = loadSchedules();
  const list = schedules[dateStr] || [];
  const entry = list.find(p => p.id === patientId);
  if (!entry || entry.arrivalMinutes === undefined) return;
  pendingArrivalEdit = { context: 'calendar', patientId, dateStr };

  document.getElementById('editArrivalSubtitle').textContent = `${entry.name} — record the actual arrival time for this visit.`;
  document.getElementById('editArrivalInput').value = minutesToTimeInputValue(entry.arrivalMinutes);
  document.getElementById('editArrivalNote').textContent = 'Every patient scheduled after this one that day will shift by the same amount (e.g. this visit ran long, so the rest of the day moves too).';
  document.getElementById('editArrivalNote').className = 'status-line';
  document.getElementById('editArrivalResetBtn').style.display = 'none';
  document.getElementById('editArrivalModal').style.display = 'flex';
};

async function commitArrivalEdit() {
  if (!pendingArrivalEdit) return;
  const newMinutes = timeInputValueToMinutes(document.getElementById('editArrivalInput').value);

  if (pendingArrivalEdit.context === 'live') {
    const p = scheduledPatients.find(sp => sp.id === pendingArrivalEdit.patientId);
    if (p) {
      p.manualArrivalOverride = newMinutes;
      document.getElementById('editArrivalModal').style.display = 'none';
      pendingArrivalEdit = null;
      await recalcAndRender();
    }
  } else if (pendingArrivalEdit.context === 'monthcard') {
    const dayIdx = pendingArrivalEdit.dayIdx;
    const patientId = pendingArrivalEdit.patientId;
    const day = monthResults[dayIdx];
    document.getElementById('editArrivalModal').style.display = 'none';
    pendingArrivalEdit = null;

    if (day && day.stops) {
      const idx = day.stops.findIndex(p => p.id === patientId);
      if (idx !== -1) {
        pushMonthUndoSnapshot();
        setMonthStatus('⏳ Recalculating around the new time...', '');
        try {
          const anchor = day.stops[idx];
          const remaining = day.stops.filter(s => s.id !== anchor.id);
          const startCoords = monthStartCoordsGlobal;
          const startTime = document.getElementById('monthStartTime').value || '08:00';
          const visitDuration = parseFloat(document.getElementById('monthVisitDuration').value) || 15;

          if (remaining.length === 0) {
            anchor.manualArrivalOverride = newMinutes;
            const timing = await computeTimingForDay(startCoords, [anchor], startTime, visitDuration);
            day.stops = timing.stops;
            day.totalHours = timing.totalHours;
            day.usingRealRoads = timing.usingRealRoads;
            day.dayStartMinutes = timing.dayStartMinutes;
            day.returnHomeMinutes = timing.returnHomeMinutes;
            day.returnTripMinutes = timing.returnTripMinutes;
            day.returnTripMiles = timing.returnTripMiles;
          } else {
            // Route-optimize whoever's left (this is what lets someone like
            // Carol end up next to Alice instead of in her original slot),
            // then time them normally as if the edited patient didn't exist.
            const reordered = nearestNeighborOrder(startCoords.lat, startCoords.lng, remaining);
            const remainingTiming = await computeTimingForDay(startCoords, reordered, startTime, visitDuration);

            // Find where the new fixed time actually falls: right after the
            // last remaining patient who finishes before it. If the new time
            // is earlier than everyone, the anchor goes first instead.
            let insertAt = remainingTiming.stops.length;
            for (let i = 0; i < remainingTiming.stops.length; i++) {
              const finishTime = remainingTiming.stops[i].arrivalMinutes + (remainingTiming.stops[i].visitDuration || visitDuration);
              if (finishTime > newMinutes) { insertAt = i; break; }
            }

            const finalOrder = remainingTiming.stops.slice();
            finalOrder.splice(insertAt, 0, { ...anchor, manualArrivalOverride: newMinutes });

            const finalTiming = await computeTimingForDay(startCoords, finalOrder, startTime, visitDuration);
            day.stops = finalTiming.stops;
            day.totalHours = finalTiming.totalHours;
            day.usingRealRoads = finalTiming.usingRealRoads;
            day.dayStartMinutes = finalTiming.dayStartMinutes;
            day.returnHomeMinutes = finalTiming.returnHomeMinutes;
            day.returnTripMinutes = finalTiming.returnTripMinutes;
            day.returnTripMiles = finalTiming.returnTripMiles;
          }
          if (day.stopCount) day.addressOverride = day.stops.length > day.stopCount;
          renderMonthResults();
          setMonthStatus('Time updated — day recalculated around the new anchor.', 'success');
        } catch (e) {
          console.error('commitArrivalEdit (monthcard) failed', e);
          setMonthStatus(`Something went wrong updating the time: ${e.message || e}`, 'error');
        }
      }
    }
  } else if (pendingArrivalEdit.context === 'weekcard') {
    const dayIdx = pendingArrivalEdit.dayIdx;
    const patientId = pendingArrivalEdit.patientId;
    const day = weekResults[dayIdx];
    document.getElementById('editArrivalModal').style.display = 'none';
    pendingArrivalEdit = null;

    if (day && day.stops) {
      const idx = day.stops.findIndex(p => p.id === patientId);
      if (idx !== -1) {
        pushWeekUndoSnapshot();
        setWeekStatus('⏳ Recalculating around the new time...', '');
        try {
          const anchor = day.stops[idx];
          const remaining = day.stops.filter(s => s.id !== anchor.id);
          const startCoords = weekStartCoordsGlobal;
          const startTime = document.getElementById('weekStartTime').value || '08:00';
          const visitDuration = parseFloat(document.getElementById('weekVisitDuration').value) || 15;

          if (remaining.length === 0) {
            anchor.manualArrivalOverride = newMinutes;
            const timing = await computeTimingForDay(startCoords, [anchor], startTime, visitDuration);
            day.stops = timing.stops;
            day.totalHours = timing.totalHours;
            day.usingRealRoads = timing.usingRealRoads;
            day.dayStartMinutes = timing.dayStartMinutes;
            day.returnHomeMinutes = timing.returnHomeMinutes;
            day.returnTripMinutes = timing.returnTripMinutes;
            day.returnTripMiles = timing.returnTripMiles;
          } else {
            const reordered = nearestNeighborOrder(startCoords.lat, startCoords.lng, remaining);
            const remainingTiming = await computeTimingForDay(startCoords, reordered, startTime, visitDuration);

            let insertAt = remainingTiming.stops.length;
            for (let i = 0; i < remainingTiming.stops.length; i++) {
              const finishTime = remainingTiming.stops[i].arrivalMinutes + (remainingTiming.stops[i].visitDuration || visitDuration);
              if (finishTime > newMinutes) { insertAt = i; break; }
            }

            const finalOrder = remainingTiming.stops.slice();
            finalOrder.splice(insertAt, 0, { ...anchor, manualArrivalOverride: newMinutes });

            const finalTiming = await computeTimingForDay(startCoords, finalOrder, startTime, visitDuration);
            day.stops = finalTiming.stops;
            day.totalHours = finalTiming.totalHours;
            day.usingRealRoads = finalTiming.usingRealRoads;
            day.dayStartMinutes = finalTiming.dayStartMinutes;
            day.returnHomeMinutes = finalTiming.returnHomeMinutes;
            day.returnTripMinutes = finalTiming.returnTripMinutes;
            day.returnTripMiles = finalTiming.returnTripMiles;
          }
          renderWeekResults();
          setWeekStatus('Time updated — day recalculated around the new anchor.', 'success');
        } catch (e) {
          console.error('commitArrivalEdit (weekcard) failed', e);
          setWeekStatus(`Something went wrong updating the time: ${e.message || e}`, 'error');
        }
      }
    }
  } else {
    const schedules = loadSchedules();
    const list = schedules[pendingArrivalEdit.dateStr] || [];
    const idx = list.findIndex(p => p.id === pendingArrivalEdit.patientId);
    if (idx !== -1) {
      const oldMinutes = list[idx].arrivalMinutes;
      const delta = newMinutes - oldMinutes;
      for (let i = idx; i < list.length; i++) {
        if (list[i].arrivalMinutes !== undefined) list[i].arrivalMinutes += delta;
      }
      saveSchedules(schedules);
    }
    document.getElementById('editArrivalModal').style.display = 'none';
    const dateStr = pendingArrivalEdit.dateStr;
    pendingArrivalEdit = null;
    showCalendarDay(dateStr);
  }
}

async function resetArrivalOverride() {
  if (!pendingArrivalEdit || pendingArrivalEdit.context !== 'live') return;
  const p = scheduledPatients.find(sp => sp.id === pendingArrivalEdit.patientId);
  if (p) delete p.manualArrivalOverride;
  document.getElementById('editArrivalModal').style.display = 'none';
  pendingArrivalEdit = null;
  await recalcAndRender();
}

window.removeFromDaySchedule = function (dateStr, patientId) {
  const schedules = loadSchedules();
  const list = schedules[dateStr];
  if (!list) return;
  const idx = list.findIndex(p => p.id === patientId);
  if (idx === -1) return;
  list.splice(idx, 1);
  if (list.length === 0) delete schedules[dateStr];
  saveSchedules(schedules);

  recomputeLastVisitDate(patientId);
  savePatients();
  renderTable();
  renderCalendar();
  showCalendarDay(dateStr);
};

let pendingDateChange = null;

window.changePatientDate = function (dateStr, patientId) {
  const master = patients.find(p => p.id === patientId);
  pendingDateChange = { fromDate: dateStr, patientId, name: master ? master.name : 'this patient' };

  document.getElementById('changeDateSubtitle').textContent = `Moving ${pendingDateChange.name} — currently on ${dateStr}`;
  document.getElementById('changeDateInput').value = dateStr;
  document.getElementById('changeDateModal').style.display = 'flex';
};

function commitPatientDateChange() {
  if (!pendingDateChange) return;
  const { fromDate, patientId } = pendingDateChange;
  const newDate = document.getElementById('changeDateInput').value;
  document.getElementById('changeDateModal').style.display = 'none';
  if (!newDate || newDate === fromDate) { pendingDateChange = null; return; }

  const schedules = loadSchedules();
  const list = schedules[fromDate];
  if (!list) { pendingDateChange = null; return; }
  const idx = list.findIndex(p => p.id === patientId);
  if (idx === -1) { pendingDateChange = null; return; }
  const [entry] = list.splice(idx, 1);
  if (list.length === 0) delete schedules[fromDate];

  if (!schedules[newDate]) schedules[newDate] = [];
  schedules[newDate].push(entry);
  saveSchedules(schedules);

  recomputeLastVisitDate(patientId);
  savePatients();
  renderTable();
  renderCalendar();
  showCalendarDay(fromDate);
  pendingDateChange = null;
}

function downloadScheduleCsv(entries, filename) {
  if (entries.length === 0) { alert('Nothing to export for that range.'); return; }
  const header = ['Name', 'DOB', 'Date', 'Time', 'Provider'];
  const escape = (v) => {
    const s = (v ?? '').toString();
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  // Group by date (each date's stops stay in their existing visit order),
  // sorted chronologically, with a blank line between days for readability.
  const byDate = {};
  entries.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const dates = Object.keys(byDate).sort();

  const lines = [header.join(',')];
  dates.forEach((date, dIdx) => {
    if (dIdx > 0) lines.push('');
    const dayEntries = byDate[date];
    // Simplified hourly slots for the coordinator: first stop's real time
    // rounded down to the hour, then +1 hour per stop after that — the
    // precise real-road times still show inside PULSE itself, this export
    // is just easier to scan at a glance.
    const baseMinutes = dayEntries[0].arrivalMinutes !== undefined
      ? Math.floor(dayEntries[0].arrivalMinutes / 60) * 60
      : 8 * 60; // fallback: 8:00 AM if no time data
    dayEntries.forEach((e, i) => {
      const slotMinutes = baseMinutes + i * 60;
      lines.push([e.name, e.dob, e.date, minutesToClock(slotMinutes), e.provider || ''].map(escape).join(','));
    });
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportMonthSchedule() {
  const y = calendarViewDate.getFullYear();
  const m = calendarViewDate.getMonth();
  const schedules = loadSchedules();
  const entries = [];
  Object.keys(schedules).forEach(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    if (d.getFullYear() === y && d.getMonth() === m) {
      schedules[dateStr].forEach(p => entries.push({ ...p, date: dateStr }));
    }
  });
  downloadScheduleCsv(entries, `schedule-${y}-${String(m + 1).padStart(2, '0')}.csv`);
}

function exportWeekSchedule(anchorDateStr) {
  const anchor = new Date(anchorDateStr + 'T00:00:00');
  const dow = anchor.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - daysSinceMonday);
  const schedules = loadSchedules();
  const entries = [];
  for (let i = 0; i < 5; i++) { // Mon-Fri only
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    if (schedules[key]) schedules[key].forEach(p => entries.push({ ...p, date: key }));
  }
  const weekLabel = dateKey(monday.getFullYear(), monday.getMonth(), monday.getDate());
  downloadScheduleCsv(entries, `schedule-week-of-${weekLabel}.csv`);
}

function exportDaySchedule(dateStr) {
  const schedules = loadSchedules();
  const entries = (schedules[dateStr] || []).map(p => ({ ...p, date: dateStr }));
  downloadScheduleCsv(entries, `schedule-${dateStr}.csv`);
}

function wireCalendarUI() {
  document.getElementById('calPrevBtn').addEventListener('click', () => {
    calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('calNextBtn').addEventListener('click', () => {
    calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
    renderCalendar();
  });
  document.getElementById('calTodayBtn').addEventListener('click', () => {
    calendarViewDate = new Date();
    renderCalendar();
  });
  document.getElementById('dayDetailBack').addEventListener('click', () => {
    document.getElementById('dayDetailModal').style.display = 'none';
  });
  document.getElementById('dayDetailCloseX').addEventListener('click', () => {
    document.getElementById('dayDetailModal').style.display = 'none';
  });
  document.getElementById('exportMonthBtn').addEventListener('click', exportMonthSchedule);
  document.getElementById('exportDayBtn').addEventListener('click', () => {
    const modal = document.getElementById('dayDetailModal');
    const dateStr = modal.getAttribute('data-current-date');
    if (dateStr) exportDaySchedule(dateStr);
  });
  document.getElementById('exportWeekBtn').addEventListener('click', () => {
    const modal = document.getElementById('dayDetailModal');
    const dateStr = modal.getAttribute('data-current-date');
    if (dateStr) exportWeekSchedule(dateStr);
  });
  document.getElementById('dayDetailGoogleMapsBtn').addEventListener('click', () => {
    const modal = document.getElementById('dayDetailModal');
    const dateStr = modal.getAttribute('data-current-date');
    if (dateStr) openCalendarDayInGoogleMaps(dateStr);
  });
  document.getElementById('changeDateConfirmBtn').addEventListener('click', commitPatientDateChange);
  document.getElementById('changeDateCancelBtn').addEventListener('click', () => {
    document.getElementById('changeDateModal').style.display = 'none';
    pendingDateChange = null;
  });
  document.getElementById('editArrivalSaveBtn').addEventListener('click', commitArrivalEdit);
  document.getElementById('editArrivalResetBtn').addEventListener('click', resetArrivalOverride);
  document.getElementById('editArrivalCancelBtn').addEventListener('click', () => {
    document.getElementById('editArrivalModal').style.display = 'none';
    pendingArrivalEdit = null;
  });
  document.getElementById('cancelDayScheduleBtn').addEventListener('click', () => {
    const modal = document.getElementById('dayDetailModal');
    const dateStr = modal.getAttribute('data-current-date');
    if (dateStr) cancelDaySchedule(dateStr);
  });
  document.getElementById('cancelWeekScheduleBtn').addEventListener('click', () => {
    const modal = document.getElementById('dayDetailModal');
    const dateStr = modal.getAttribute('data-current-date');
    if (dateStr) cancelWeekSchedule(dateStr);
  });
  document.getElementById('cancelMonthScheduleBtn').addEventListener('click', () => {
    const modal = document.getElementById('dayDetailModal');
    const dateStr = modal.getAttribute('data-current-date');
    if (dateStr) cancelMonthSchedule(dateStr);
  });
}

/* ============================================
   TAB NAVIGATION
   ============================================ */
function switchTab(tabName) {
  document.querySelectorAll('.tab-panel').forEach(el => { el.style.display = 'none'; });
  const target = document.getElementById('tab-' + tabName);
  if (target) target.style.display = 'block';

  document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  if (tabName === 'home') renderCalendar();

  if (tabName === 'clients') renderClientsMap();
  if (tabName === 'admin') populateAdminTab();

  if (tabName === 'schedule') {
    populateGroupSelect();
    populateStartAddressSelect();
    const dateInput = document.getElementById('scheduleDate');
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  }
}

/* ============================================
   INIT
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
  const safeInit = (label, fn) => {
    try { fn(); } catch (e) { console.error(`PULSE init step failed: ${label}`, e); }
  };
   

   safeInit('theme', () => {
    applyTheme(loadTheme());
    const headerThemeSel = document.getElementById('themeToggle');
    if (headerThemeSel) {
      headerThemeSel.addEventListener('change', (e) => applyTheme(e.target.value));
    }
  });

  safeInit('nav tabs', () => {
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
    });
  });

  safeInit('wireScheduleUI', wireScheduleUI);
  safeInit('wireWeeklyUI', wireWeeklyUI);
  safeInit('wireMonthlyUI', wireMonthlyUI);
  safeInit('wireDayReviewUI', wireDayReviewUI);
  safeInit('wireAdminTab', wireAdminTab);
  safeInit('wireCalendarUI', wireCalendarUI);
  safeInit('wireEditModal', wireEditModal);
  safeInit('renderCalendar', renderCalendar);

  safeInit('group size slider', () => {
    const groupSizeSlider = document.getElementById('groupSizeSlider');
    const groupSizeValue = document.getElementById('groupSizeValue');
    groupSizeSlider.value = groupSizeMax;
    groupSizeValue.textContent = groupSizeMax;
    groupSizeSlider.addEventListener('input', () => {
      groupSizeMax = parseInt(groupSizeSlider.value, 10);
      groupSizeValue.textContent = groupSizeMax;
    });
    groupSizeSlider.addEventListener('change', () => {
      saveGroupSizeMax();
      regroup();
    });
  });

  safeInit('reset auto group button', () => {
    document.getElementById('resetAutoGroupBtn').addEventListener('click', () => {
      if (!confirm('This clears every manual group assignment (including anything drawn on the map) and re-clusters everyone automatically. Continue?')) return;
      patients.forEach(p => { p.manualGroup = false; });
      savePatients();
      regroup();
    });
  });

  safeInit('wireClientsMap', wireClientsMap);

  safeInit('CSV dropzone', () => {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const addFileInput = document.getElementById('addFileInput');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file, 'replace');
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0], 'replace');
    });
    addFileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0], 'append');
    });
  });

  safeInit('CSV download/template buttons', () => {
    document.getElementById('downloadCsvBtn').addEventListener('click', downloadAllPatientsCsv);
    document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
      const blob = new Blob(['Name,Address,DOB,Coordinator,Provider,Last Visit\n'], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pulse-patient-template.csv';
      a.click();
      URL.revokeObjectURL(url);
    });
    document.getElementById('addCsvBtn').addEventListener('click', () => document.getElementById('addFileInput').click());
  });

  safeInit('clear all button', () => {
    document.getElementById('clearAllBtn').addEventListener('click', showClearAllStep1);
  });

  safeInit('manual add row button', () => {
    document.getElementById('addManualRowBtn').addEventListener('click', addManualRow);
  });

  safeInit('clients search box', () => {
    const clientsSearchEl = document.getElementById('clientsSearchInput');
    clientsSearchEl.value = ''; // force-clear on load — browsers sometimes restore typed values on refresh
    const searchClearX = document.getElementById('clientsSearchClearX');
    const updateSearchClearX = () => { searchClearX.style.display = clientsSearchEl.value ? 'block' : 'none'; };
    clientsSearchEl.addEventListener('input', () => { renderTable(); updateSearchClearX(); });
    searchClearX.addEventListener('click', () => {
      clientsSearchEl.value = '';
      updateSearchClearX();
      renderTable();
    });
    updateSearchClearX();

    document.getElementById('clientsFilterCount').addEventListener('click', (e) => {
      if (e.target && e.target.id === 'clearClientsFiltersBtn') {
        document.getElementById('clientsSearchInput').value = '';
        updateSearchClearX();
        const providerSel = document.getElementById('providerFilter');
        if (providerSel) providerSel.value = '';
        activeProviderFilter = '';
        localStorage.setItem(PROVIDER_FILTER_KEY, '');
        activeGroupFilter = '';
        renderTable();
        renderGroupSummary();
      }
    });
  });

  safeInit('schedule search box', () => {
    document.getElementById('scheduleSearchInput').addEventListener('input', (e) => renderScheduleSearchResults(e.target.value.trim()));
  });

  safeInit('manual add form', () => {
    document.getElementById('submitManualAddBtn').addEventListener('click', submitManualAdd);
    addManualRow(); // start with one blank row
  });

  safeInit('provider filter', () => {
    document.getElementById('providerFilter').addEventListener('change', (e) => {
      activeProviderFilter = e.target.value;
      localStorage.setItem(PROVIDER_FILTER_KEY, activeProviderFilter);
      renderTable();
      renderGroupSummary();
    });
  });

  safeInit('initial table render', () => {
    renderTable();
    renderGroupSummary();
    populateProviderFilter();
  });

  safeInit('initial geocoding check', () => {
    if (patients.some(p => p.lat === null || p.lng === null)) {
      geocodeAllPending();
    }
  });
});
