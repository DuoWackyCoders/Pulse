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

/* ============================================
   THEME
   ============================================ */
function loadTheme() {
  return localStorage.getItem(THEME_KEY) || 'light';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode';
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
  } catch (e) {
    console.error('Failed to save patients to storage', e);
    setStatus('Could not save — your browser storage may be full.', 'error');
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
      lastVisitDate: idx.lastVisit >= 0 ? (cols[idx.lastVisit] || '').trim() : '',
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

  // No radius, no home anchor — keep grabbing the nearest remaining patient
  // to the cluster's CENTER (not the last one added), until the group hits
  // the size cap, runs out of patients, OR the nearest remaining patient is
  // farther than a sane spread — better to leave a group smaller than to
  // stretch it across the map just to hit the count.
  //
  // When a cluster fills up (or stops early), the NEXT cluster's seed is
  // whichever unclustered patient is nearest to where we just left off —
  // turning this into a spatial sweep instead of a random jump.
  const unclustered = [...auto];
  let lastCentroid = null;
  while (unclustered.length) {
    let seed;
    if (lastCentroid) {
      let bestIdx = 0, bestDist = Infinity;
      unclustered.forEach((cand, i) => {
        const d = haversineMiles(lastCentroid.lat, lastCentroid.lng, cand.lat, cand.lng);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });
      seed = unclustered.splice(bestIdx, 1)[0];
    } else {
      seed = unclustered.shift();
    }

    const letter = nextFreeLetter();
    const members = [seed];
    seed.group = letter;

    while (members.length < groupSizeMax && unclustered.length) {
      const centroidLat = members.reduce((s, m) => s + m.lat, 0) / members.length;
      const centroidLng = members.reduce((s, m) => s + m.lng, 0) / members.length;
      let bestIdx = 0, bestDist = Infinity;
      unclustered.forEach((cand, i) => {
        const d = haversineMiles(centroidLat, centroidLng, cand.lat, cand.lng);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });
      if (bestDist > MAX_SPREAD_MILES) break; // don't force in a distant outlier
      const next = unclustered.splice(bestIdx, 1)[0];
      next.group = letter;
      members.push(next);
    }

    lastCentroid = {
      lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
      lng: members.reduce((s, m) => s + m.lng, 0) / members.length
    };
  }

  // Cleanup pass: any patient closer to a DIFFERENT group's center than
  // their own gets reassigned there, as long as that group still has room.
  // This fixes jagged/interleaved boundaries left over from the one-pass
  // greedy sweep above — points on the "wrong side" of a boundary move to
  // where they actually belong.
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
    auto.forEach(p => {
      if (!p.group || !centroids[p.group]) return;
      const currentDist = haversineMiles(centroids[p.group].lat, centroids[p.group].lng, p.lat, p.lng);
      let bestGroup = p.group, bestDist = currentDist;
      Object.keys(centroids).forEach(g => {
        if (g === p.group) return;
        if (byGroup[g].length >= groupSizeMax + OVERFLOW_TOLERANCE) return; // hard ceiling, but allow a little flex before it
        const d = haversineMiles(centroids[g].lat, centroids[g].lng, p.lat, p.lng);
        if (d > MAX_SPREAD_MILES) return; // never reassign to a group this far away, even if it's the "closest available"
        if (d < bestDist) { bestDist = d; bestGroup = g; }
      });
      if (bestGroup !== p.group) {
        byGroup[p.group] = byGroup[p.group].filter(x => x !== p);
        (byGroup[bestGroup] = byGroup[bestGroup] || []).push(p);
        p.group = bestGroup;
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

function renderClientsMap() {
  ensureClientsMap();
  if (clientsMarkersLayer) clientsMarkersLayer.remove();
  clientsMarkersLayer = L.layerGroup().addTo(clientsMap);

  const withCoords = getFilteredPatients().filter(p => p.lat !== null && p.lng !== null);
  if (withCoords.length === 0) {
    setTimeout(() => clientsMap.invalidateSize(), 100);
    return;
  }

  withCoords.forEach(p => {
    L.circleMarker([p.lat, p.lng], {
      radius: 8,
      color: groupColor(p.group),
      fillColor: groupColor(p.group),
      fillOpacity: 0.85,
      weight: 2
    })
      .addTo(clientsMarkersLayer)
      .bindTooltip(`${p.name} — Group ${p.group || 'unassigned'}`);
  });

  const bounds = L.latLngBounds(withCoords.map(p => [p.lat, p.lng]));
  clientsMap.fitBounds(bounds, { padding: [30, 30] });
  setTimeout(() => clientsMap.invalidateSize(), 150);
}

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
  tableWrap.style.display = 'block';
  emptyState.style.display = 'none';

  tbody.innerHTML = '';
  getFilteredPatients().forEach(p => {
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
  el.innerHTML = entries.map(([g, c]) =>
    `<span class="group-pill" style="background:${groupColor(g === 'Unassigned' ? 'unassigned' : g)}; color:#fff; margin-right:8px;">${g} — ${c}</span>`
  ).join('');
}

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
    if (mode === 'replace') {
      patients = parsed;
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
    }
    savePatients();
    renderTable();
    renderGroupSummary();
    populateProviderFilter();
    const addedCount = parsed.length - skippedDupes;
    setStatus(`Loaded ${addedCount} patient(s).` + (skippedDupes > 0 ? ` Skipped ${skippedDupes} duplicate(s) (matching name, address, and DOB).` : '') + ' Geocoding addresses next...', 'success');
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

  L.marker([startCoords.lat, startCoords.lng])
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
      `);
  });

  const points = [[startCoords.lat, startCoords.lng], ...scheduledPatients.map(p => [p.lat, p.lng])];
  L.polyline(points, { color: '#EE7EAB', weight: 3, dashArray: '1,8' }).addTo(leafletLayer);

  // Ghost pins: other patients not currently on today's route, so the provider
  // can spot someone nearby and pull them in.
  const scheduledIds = new Set(scheduledPatients.map(p => p.id));
  const otherPatients = getFilteredPatients().filter(p => p.lat !== null && p.lng !== null && !scheduledIds.has(p.id));
  const ghostIcon = L.divIcon({
    className: 'ghost-pin',
    html: '<div class="ghost-pin-dot"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
  otherPatients.forEach(p => {
    L.marker([p.lat, p.lng], { icon: ghostIcon })
      .addTo(leafletLayer)
      .bindPopup(`${escapeHtml(p.name)} (Group ${escapeHtml(p.group || '—')})<br><button type="button" style="margin-top:6px;" onclick="window.addPatientToLeftover('${p.id}')">+ Add to Leftover</button>`);
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

async function handleSaveNewAddress() {
  const label = document.getElementById('newAddressLabel').value.trim() || 'Home base';
  const address = document.getElementById('newAddressText').value.trim();
  if (!address) { setScheduleStatus('Enter an address to save.', 'error'); return; }

  setScheduleStatus('Looking up that address...', '');
  try {
    const coords = await geocodeAddress(address);
    if (!coords) { setScheduleStatus('Could not find that address.', 'error'); return; }
    const saved = loadStartAddresses();
    const entry = { id: 'a_' + Date.now(), label, address, lat: coords.lat, lng: coords.lng };
    saved.push(entry);
    saveStartAddresses(saved);
    populateStartAddressSelect();
    document.getElementById('startAddressSelect').value = entry.id;
    document.getElementById('newAddressForm').style.display = 'none';
    document.getElementById('newAddressLabel').value = '';
    document.getElementById('newAddressText').value = '';
    setScheduleStatus('Address saved.', 'success');
  } catch (e) {
    setScheduleStatus('Error looking up that address.', 'error');
  }
}

function populateGroupSelect() {
  const sel = document.getElementById('groupSelect');
  if (!sel) return;
  const groups = Array.from(new Set(getFilteredPatients().map(p => p.group).filter(Boolean))).sort();
  const current = sel.value;
  sel.innerHTML = groups.map(g => `<option value="${g}">Group ${g}</option>`).join('');
  if (groups.includes(current)) sel.value = current;
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
  return ordered;
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

async function generateRoute() {
  const groupSel = document.getElementById('groupSelect');
  const group = groupSel.value;
  const stopCount = parseInt(document.getElementById('stopCount').value, 10) || 0;
  const startAddrId = document.getElementById('startAddressSelect').value;
  const scheduleDate = document.getElementById('scheduleDate').value || new Date().toISOString().slice(0, 10);
  const includeRecent = document.getElementById('includeRecent').checked;
  const strictGroup = document.getElementById('strictGroupOnly').checked;

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

    const allEligible = getFilteredPatients().filter(p => p.lat !== null && p.lng !== null);
    const eligible = includeRecent ? allEligible : allEligible.filter(p => !isRecentlyVisited(p, scheduleDate));
    const excludedCount = allEligible.length - eligible.length;

    let pool;
    let fillCount = 0;
    let groupOnlyCount = 0;

    if (strictGroup) {
      // Old behavior: stay inside the selected group, only reaching outside it
      // if the group itself can't fill the requested count.
      const groupPatients = eligible.filter(p => p.group === group);
      groupOnlyCount = groupPatients.length;
      if (groupPatients.length === 0) {
        setScheduleStatus(excludedCount > 0
          ? `All patients in that group were visited within the last 30 days. Check "Include patients visited in the last 30 days" to override.`
          : 'No geocoded patients in that group yet.', 'error');
        return;
      }
      pool = groupPatients;
      if (groupPatients.length < stopCount) {
        const needed = stopCount - groupPatients.length;
        const otherByDistance = eligible.filter(p => p.group !== group)
          .map(p => ({ p, dist: haversineMiles(startCoords.lat, startCoords.lng, p.lat, p.lng) }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, needed)
          .map(x => x.p);
        pool = groupPatients.concat(otherByDistance);
        fillCount = otherByDistance.length;
      }
    } else {
      // Default: Group is just a starting hint, not a hard boundary. Pull the
      // truly closest N patients from EVERYONE eligible, regardless of which
      // group they're labeled — this is what actually minimizes driving.
      pool = eligible;
      if (pool.length === 0) {
        setScheduleStatus(excludedCount > 0
          ? `All eligible patients were visited within the last 30 days. Check "Include patients visited in the last 30 days" to override.`
          : 'No geocoded patients available yet.', 'error');
        return;
      }
    }

    // Pick the N closest patients to the start point first (by straight-line
    // distance), THEN order just those N for an efficient visiting sequence.
    // Doing it the other way around (path-order the whole pool, take first N)
    // can pull in a farther stop that only *looked* nearest at one greedy step.
    const byDistance = pool
      .map(p => ({ p, dist: haversineMiles(startCoords.lat, startCoords.lng, p.lat, p.lng) }))
      .sort((a, b) => a.dist - b.dist);

    let closestN = byDistance.slice(0, stopCount).map(x => x.p);

    // Pull in anyone else at the same address OR same complex/building as a
    // selected patient (couples, same complex) so they get scheduled together.
    const addressMates = byDistance
      .map(x => x.p)
      .filter(p => !closestN.includes(p) && closestN.some(sel => isSameLocation(sel, p)));
    closestN = closestN.concat(addressMates);

    const remainder = byDistance.map(x => x.p).filter(p => !closestN.includes(p));

    scheduledPatients = nearestNeighborOrder(startCoords.lat, startCoords.lng, closestN);
    leftoverPatients = remainder;

    document.getElementById('routeBuilderCard').style.display = 'block';
    await recalcAndRender();
    const addedNote = addressMates.length > 0 ? ` (+${addressMates.length} same-address patient(s) added automatically.)` : '';
    const excludedNote = excludedCount > 0 ? ` (${excludedCount} recently-visited patient(s) excluded.)` : '';
    let statusMsg;
    if (strictGroup) {
      const fillNote = fillCount > 0 ? ` Group ${group} only had ${groupOnlyCount} available, so ${fillCount} nearby patient(s) from other groups were added to reach ${stopCount}.` : '';
      statusMsg = `Route generated for Group ${group}.` + excludedNote + addedNote + fillNote;
    } else {
      const groupsUsed = Array.from(new Set(scheduledPatients.map(p => p.group || 'unassigned'))).sort();
      statusMsg = `Route generated: closest ${scheduledPatients.length} patient(s) to your starting address, drawn from group(s) ${groupsUsed.join(', ')}.` + excludedNote + addedNote;
    }
    setScheduleStatus(statusMsg, 'success');
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
  if (stops.length === 0) return [];
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // never hang more than 8s
  try {
    // Round trip: start -> each stop in order -> back to start, so the
    // last leg gives us a real "arrive home" estimate too.
    const coordList = [[startLng, startLat], ...stops.map(s => [s.lng, s.lat]), [startLng, startLat]];
    const coordStr = coordList.map(c => c.join(',')).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=false`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes[0]) return null;
    return data.routes[0].legs.map(leg => ({
      minutes: leg.duration / 60,
      miles: leg.distance / 1609.34
    }));
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
  if (startCoords && scheduledPatients.length > 0) {
    legs = await fetchRouteLegs(startCoords.lat, startCoords.lng, scheduledPatients);
  }
  const usingRealRoads = !!legs;

  let prevLat = startCoords ? startCoords.lat : null;
  let prevLng = startCoords ? startCoords.lng : null;
  let prevPatient = null;

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
    } else {
      // Same address as the previous stop (couple / same building) — no drive needed.
      p.travelMiles = 0;
      p.travelMinutes = 0;
    }
    p.arrivalMinutes = cursorMinutes;
    p.visitDuration = p.visitDuration || visitDuration;
    cursorMinutes += p.visitDuration;
    prevLat = p.lat; prevLng = p.lng; prevPatient = p;
  });

  // Return-to-home leg, for the "arrive home" summary.
  let returnTripMinutes = 0;
  if (startCoords && scheduledPatients.length > 0) {
    if (legs && legs[legs.length - 1]) {
      returnTripMinutes = legs[legs.length - 1].minutes;
    } else {
      const last = scheduledPatients[scheduledPatients.length - 1];
      returnTripMinutes = milesToMinutes(haversineMiles(last.lat, last.lng, startCoords.lat, startCoords.lng));
    }
  }
  const returnHomeMinutes = cursorMinutes + returnTripMinutes;
  renderRouteSummary(dayStartMinutes, returnHomeMinutes, usingRealRoads);

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

function renderScheduleLists() {
  const schedEl = document.getElementById('scheduledList');
  const leftEl = document.getElementById('leftoverList');
  document.getElementById('scheduledCount').textContent = scheduledPatients.length;
  document.getElementById('leftoverCount').textContent = leftoverPatients.length;

  schedEl.innerHTML = scheduledPatients.map((p, i) => dragItemHtml(p, 'scheduled', i, true)).join('');
  leftEl.innerHTML = leftoverPatients.map((p, i) => dragItemHtml(p, 'leftover', i, false)).join('');

  attachDragHandlers();
}

function renderRouteSummary(startMinutes, returnHomeMinutes, usingRealRoads) {
  const el = document.getElementById('routeSummary');
  if (!el) return;
  if (scheduledPatients.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <span class="rs-item"><span class="rs-label">Start:</span> Home ${minutesToClock(startMinutes)}</span>
    <span class="rs-item"><span class="rs-label">Arrive home:</span> ${minutesToClock(returnHomeMinutes)}</span>
    <span class="rs-item"><span class="rs-label">Total day:</span> ${((returnHomeMinutes - startMinutes) / 60).toFixed(1)} hrs</span>
    <span class="rs-item" style="color:${usingRealRoads ? 'var(--lime-deep)' : 'var(--pink-deep)'};">${usingRealRoads ? '✓ real road times' : '⚠ straight-line estimate (routing service unreachable)'}</span>
  `;
}

function dragItemHtml(p, listName, index, showTime) {
  const highlightClass = p.justAdded ? ' highlight-new' : '';
  return `
    <li class="drag-item${highlightClass}" draggable="true" data-id="${p.id}" data-list="${listName}" data-index="${index}">
      <div class="di-name">#${index + 1} ${escapeHtml(p.name)}</div>
      <div class="di-meta">${escapeHtml(p.dob)} — ${escapeHtml(p.address)}${!showTime && p.group ? ` — Group ${escapeHtml(p.group)}` : ''}</div>
      ${showTime && p.arrivalMinutes !== undefined ? `<div class="di-time">${minutesToClock(p.arrivalMinutes)}${p.travelMinutes ? ` <span style="color:var(--text-soft); font-weight:600;">(🚗 ${Math.round(p.travelMinutes)} min / ${p.travelMiles.toFixed(1)} mi)</span>` : ' <span style="color:var(--text-soft); font-weight:600;">(same address)</span>'}</div>` : ''}
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

function cancelRoute() {
  scheduledPatients = [];
  leftoverPatients = [];
  startCoords = null;
  document.getElementById('routeBuilderCard').style.display = 'none';
  document.getElementById('routeSummary').innerHTML = '';
  if (leafletLayer) { leafletLayer.remove(); leafletLayer = null; }
  setScheduleStatus('Route cleared. Adjust your settings and generate again.', '');
}

function wireScheduleUI() {
  document.getElementById('generateRouteBtn').addEventListener('click', generateRoute);
  document.getElementById('cancelRouteBtn').addEventListener('click', cancelRoute);

  document.getElementById('startAddressSelect').addEventListener('change', updateAddressFormVisibility);
  document.getElementById('saveNewAddressBtn').addEventListener('click', handleSaveNewAddress);
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

  document.getElementById('approveScheduleBtn').addEventListener('click', async () => {
    const maxHours = parseFloat(document.getElementById('maxHours').value) || 7;
    const totalHours = await recalcAndRender();
    const scheduleDate = document.getElementById('scheduleDate').value || new Date().toISOString().slice(0, 10);

    const commit = () => {
      scheduledPatients.forEach(sp => {
        const master = patients.find(p => p.id === sp.id);
        if (master) master.lastVisitDate = scheduleDate;
      });
      savePatients();
      renderTable();
      recordApprovedSchedule(scheduleDate, scheduledPatients);
      setScheduleStatus(`Schedule approved for ${scheduleDate} (${totalHours.toFixed(1)} hrs). Check the Home tab calendar to see it.`, 'success');
    };

    if (totalHours > maxHours) {
      showOverageModal(totalHours, maxHours, commit);
    } else {
      commit();
    }
  });
}

/* ============================================
   EDIT PATIENT
   ============================================ */
let editingPatientId = null;

window.openEditPatient = function (patientId) {
  const p = patients.find(pt => pt.id === patientId);
  if (!p) return;
  editingPatientId = patientId;
  document.getElementById('editName').value = p.name || '';
  document.getElementById('editAddress').value = p.address || '';
  document.getElementById('editDob').value = p.dob || '';
  document.getElementById('editCoordinator').value = p.coordinator || '';
  document.getElementById('editProvider').value = p.provider || '';
  document.getElementById('editStatus').textContent = '';
  document.getElementById('editPatientModal').style.display = 'flex';
};

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

  if (addressChanged) {
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
  if (addressChanged) regroup(); else renderGroupSummary();

  document.getElementById('editPatientModal').style.display = 'none';
  editingPatientId = null;
}

function wireEditModal() {
  document.getElementById('editSaveBtn').addEventListener('click', saveEditedPatient);
  document.getElementById('editCancelBtn').addEventListener('click', () => {
    document.getElementById('editPatientModal').style.display = 'none';
    editingPatientId = null;
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
function recordApprovedSchedule(dateStr, list) {
  const schedules = loadSchedules();
  schedules[dateStr] = list.map(p => ({
    id: p.id, name: p.name, dob: p.dob, address: p.address,
    group: p.group, provider: p.provider, arrivalMinutes: p.arrivalMinutes
  }));
  saveSchedules(schedules);
}

function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
    html += `
      <div class="${classes.join(' ')}" data-date="${key}" draggable="${count > 0}">
        <span class="cal-day-num">${d}</span>
        ${count > 0 ? `<span class="cal-day-count">${count}</span>` : ''}
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

  // Keep patient lastVisitDate in sync with the move
  fromList.forEach(entry => {
    const master = patients.find(p => p.id === entry.id);
    if (master && master.lastVisitDate === fromDate) master.lastVisitDate = toDate;
  });
  savePatients();
  renderTable();
  renderCalendar();
}

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
      </div>
    </div>
  `).join('');
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

  const master = patients.find(p => p.id === patientId);
  if (master && master.lastVisitDate === dateStr) {
    master.lastVisitDate = null;
    savePatients();
    renderTable();
  }
  renderCalendar();
  showCalendarDay(dateStr);
};

window.changePatientDate = function (dateStr, patientId) {
  const newDate = prompt('Move this patient to which date? (YYYY-MM-DD)', dateStr);
  if (!newDate || newDate === dateStr) return;

  const schedules = loadSchedules();
  const list = schedules[dateStr];
  if (!list) return;
  const idx = list.findIndex(p => p.id === patientId);
  if (idx === -1) return;
  const [entry] = list.splice(idx, 1);
  if (list.length === 0) delete schedules[dateStr];

  if (!schedules[newDate]) schedules[newDate] = [];
  schedules[newDate].push(entry);
  saveSchedules(schedules);

  const master = patients.find(p => p.id === patientId);
  if (master && master.lastVisitDate === dateStr) {
    master.lastVisitDate = newDate;
    savePatients();
    renderTable();
  }
  renderCalendar();
  showCalendarDay(dateStr);
};

function downloadScheduleCsv(entries, filename) {
  if (entries.length === 0) { alert('Nothing to export for that range.'); return; }
  const header = ['Name', 'DOB', 'Date', 'Time', 'Provider'];
  const escape = (v) => {
    const s = (v ?? '').toString();
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [header.join(',')];
  entries.forEach(e => {
    lines.push([e.name, e.dob, e.date, e.arrivalMinutes !== undefined ? minutesToClock(e.arrivalMinutes) : '', e.provider || '']
      .map(escape).join(','));
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
  applyTheme(loadTheme());
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });

  wireScheduleUI();
  wireCalendarUI();
  wireEditModal();
  renderCalendar();

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

  document.getElementById('resetAutoGroupBtn').addEventListener('click', () => {
    if (!confirm('This clears every manual group assignment (including anything drawn on the map) and re-clusters everyone automatically. Continue?')) return;
    patients.forEach(p => { p.manualGroup = false; });
    savePatients();
    regroup();
  });

  wireClientsMap();

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

  document.getElementById('downloadCsvBtn').addEventListener('click', () => {
    const list = getFilteredPatients();
    if (list.length === 0) { setStatus('Nothing to download yet.', 'error'); return; }
    const csv = patientsToCSV(list);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeProviderFilter ? `patients-${activeProviderFilter}.csv` : 'patients.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('addCsvBtn').addEventListener('click', () => addFileInput.click());

  document.getElementById('clearAllBtn').addEventListener('click', () => {
    if (!confirm('This will remove all patients from this browser. Continue?')) return;
    patients = [];
    savePatients();
    renderTable();
    renderGroupSummary();
    setStatus('Cleared.', '');
  });

  document.getElementById('providerFilter').addEventListener('change', (e) => {
    activeProviderFilter = e.target.value;
    localStorage.setItem(PROVIDER_FILTER_KEY, activeProviderFilter);
    renderTable();
    renderGroupSummary();
  });

  renderTable();
  renderGroupSummary();
  populateProviderFilter();
  if (patients.some(p => p.lat === null || p.lng === null)) {
    geocodeAllPending();
  }
});
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
  const header = ['Name', 'Address', 'DOB', 'Coordinator', 'Provider', ...extraColumns, 'Group'];
  const escape = (v) => {
    const s = (v ?? '').toString();
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [header.join(',')];
  for (const p of list) {
    const extraValues = extraColumns.map(col => (p.extra && p.extra[col]) || '');
    lines.push([p.name, p.address, p.dob, p.coordinator, p.provider, ...extraValues, p.group || '']
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

function regroup() {
  // Keep manually-assigned patients fixed; auto-cluster the rest.
  const manual = patients.filter(p => p.manualGroup && p.group);
  const auto = patients.filter(p => !p.manualGroup && p.lat !== null && p.lng !== null);
  const noCoords = patients.filter(p => p.lat === null || p.lng === null);

  const usedLetters = new Set(manual.map(p => p.group));
  const clusters = []; // { letter, members: [] }
  let nextIdx = 0;
  const nextFreeLetter = () => {
    let letter;
    do { letter = groupLetter(nextIdx++); } while (usedLetters.has(letter));
    usedLetters.add(letter);
    return letter;
  };

  const unclustered = [...auto];
  while (unclustered.length) {
    const seed = unclustered.shift();
    const letter = nextFreeLetter();
    const members = [seed];
    for (let i = unclustered.length - 1; i >= 0; i--) {
      const candidate = unclustered[i];
      const closeToAny = members.some(m =>
        haversineMiles(m.lat, m.lng, candidate.lat, candidate.lng) <= radiusMiles);
      if (closeToAny) {
        members.push(candidate);
        unclustered.splice(i, 1);
      }
    }
    seed.group = letter;
    members.forEach(m => { m.group = letter; });
  }

  noCoords.forEach(p => { if (!p.manualGroup) p.group = null; });

  savePatients();
  renderTable();
  renderGroupSummary();
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

function renderTableHeader() {
  const thead = document.getElementById('patientTableHead');
  if (!thead) return;
  const cols = ['Name', 'Address', 'DOB', 'Coordinator', ...extraColumns, 'Group', 'Override'];
  thead.innerHTML = '<tr>' + cols.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr>';
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
  tableWrap.style.display = 'block';
  emptyState.style.display = 'none';

  tbody.innerHTML = '';
  patients.forEach(p => {
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
      <td><span class="group-pill" data-group="${groupLabel === 'unassigned' ? 'unassigned' : (groupLabel.charCodeAt(0) - 65) % 3 === 0 ? 'A' : (groupLabel.charCodeAt(0) - 65) % 3 === 1 ? 'B' : 'C'}">${escapeHtml(groupLabel)}</span></td>
      <td>
        <select class="group-select" data-id="${p.id}">
          <option value="">Auto</option>
          ${availableGroupLetters().map(l => `<option value="${l}" ${p.manualGroup && p.group === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </td>
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
  patients.forEach(p => {
    const key = p.group || 'Unassigned';
    counts[key] = (counts[key] || 0) + 1;
  });
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = entries.map(([g, c]) =>
    `<span class="group-pill" data-group="${g === 'Unassigned' ? 'unassigned' : 'A'}" style="margin-right:8px;">${g} — ${c}</span>`
  ).join('');
}

function escapeHtml(str) {
  return (str ?? '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ============================================
   UPLOAD HANDLING
   ============================================ */
function handleFile(file, mode) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target.result;
    const parsed = csvToPatients(text);
    if (parsed.length === 0) {
      setStatus('No valid rows found in that CSV. Check the column headers (Name, Address, DOB...).', 'error');
      return;
    }
    if (mode === 'replace') {
      patients = parsed;
    } else {
      patients = patients.concat(parsed);
    }
    savePatients();
    renderTable();
    renderGroupSummary();
    setStatus(`Loaded ${parsed.length} patient(s). Geocoding addresses next...`, 'success');
    await geocodeAllPending();
  };
  reader.onerror = () => setStatus('Could not read that file.', 'error');
  reader.readAsText(file);
}

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

async function handleSaveNewAddress() {
  const label = document.getElementById('newAddressLabel').value.trim() || 'Home base';
  const address = document.getElementById('newAddressText').value.trim();
  if (!address) { setScheduleStatus('Enter an address to save.', 'error'); return; }

  setScheduleStatus('Looking up that address...', '');
  try {
    const coords = await geocodeAddress(address);
    if (!coords) { setScheduleStatus('Could not find that address.', 'error'); return; }
    const saved = loadStartAddresses();
    const entry = { id: 'a_' + Date.now(), label, address, lat: coords.lat, lng: coords.lng };
    saved.push(entry);
    saveStartAddresses(saved);
    populateStartAddressSelect();
    document.getElementById('startAddressSelect').value = entry.id;
    document.getElementById('newAddressForm').style.display = 'none';
    document.getElementById('newAddressLabel').value = '';
    document.getElementById('newAddressText').value = '';
    setScheduleStatus('Address saved.', 'success');
  } catch (e) {
    setScheduleStatus('Error looking up that address.', 'error');
  }
}

function populateGroupSelect() {
  const sel = document.getElementById('groupSelect');
  if (!sel) return;
  const groups = Array.from(new Set(patients.map(p => p.group).filter(Boolean))).sort();
  const current = sel.value;
  sel.innerHTML = groups.map(g => `<option value="${g}">Group ${g}</option>`).join('');
  if (groups.includes(current)) sel.value = current;
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
  return ordered;
}

async function generateRoute() {
  const groupSel = document.getElementById('groupSelect');
  const group = groupSel.value;
  const stopCount = parseInt(document.getElementById('stopCount').value, 10) || 0;
  const startAddrId = document.getElementById('startAddressSelect').value;

  if (!group) { setScheduleStatus('Pick a group first — none found. Upload patients and set a radius on the Clients tab.', 'error'); return; }
  if (!startAddrId) { setScheduleStatus('Pick or add a starting address.', 'error'); return; }

  const saved = loadStartAddresses().find(a => a.id === startAddrId);
  if (!saved) { setScheduleStatus('That saved address could not be found — try re-adding it.', 'error'); return; }
  startCoords = { lat: saved.lat, lng: saved.lng };

  const groupPatients = patients.filter(p => p.group === group && p.lat !== null && p.lng !== null);
  if (groupPatients.length === 0) {
    setScheduleStatus('No geocoded patients in that group yet.', 'error');
    return;
  }

  const ordered = nearestNeighborOrder(startCoords.lat, startCoords.lng, groupPatients);
  scheduledPatients = ordered.slice(0, stopCount);
  leftoverPatients = ordered.slice(stopCount);

  document.getElementById('routeBuilderCard').style.display = 'block';
  recalcAndRender();
  setScheduleStatus(`Route generated for Group ${group}.`, 'success');
}

function recalcAndRender() {
  const startTimeStr = document.getElementById('startTime').value || '08:00';
  const visitDuration = parseFloat(document.getElementById('visitDuration').value) || 15;
  const maxHours = parseFloat(document.getElementById('maxHours').value) || 7;

  const [h, m] = startTimeStr.split(':').map(Number);
  let cursorMinutes = h * 60 + m;
  const dayStartMinutes = cursorMinutes;

  let prevLat = startCoords ? startCoords.lat : null;
  let prevLng = startCoords ? startCoords.lng : null;

  scheduledPatients.forEach((p) => {
    if (prevLat !== null) {
      const miles = haversineMiles(prevLat, prevLng, p.lat, p.lng);
      cursorMinutes += milesToMinutes(miles);
    }
    p.arrivalMinutes = cursorMinutes;
    p.visitDuration = p.visitDuration || visitDuration;
    cursorMinutes += p.visitDuration;
    prevLat = p.lat; prevLng = p.lng;
  });

  const totalHours = (cursorMinutes - dayStartMinutes) / 60;
  renderScheduleLists();
  return totalHours;
}

function minutesToClock(totalMinutes) {
  let h = Math.floor(totalMinutes / 60) % 24;
  const m = Math.round(totalMinutes % 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
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

function dragItemHtml(p, listName, index, showTime) {
  return `
    <li class="drag-item" draggable="true" data-id="${p.id}" data-list="${listName}" data-index="${index}">
      <div class="di-name">#${index + 1} ${escapeHtml(p.name)}</div>
      <div class="di-meta">${escapeHtml(p.dob)} — ${escapeHtml(p.address)}</div>
      ${showTime && p.arrivalMinutes !== undefined ? `<div class="di-time">${minutesToClock(p.arrivalMinutes)}</div>` : ''}
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

function wireScheduleUI() {
  document.getElementById('generateRouteBtn').addEventListener('click', generateRoute);

  document.getElementById('startAddressSelect').addEventListener('change', updateAddressFormVisibility);
  document.getElementById('saveNewAddressBtn').addEventListener('click', handleSaveNewAddress);

  ['startTime', 'visitDuration', 'maxHours'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (scheduledPatients.length) recalcAndRender();
    });
  });

  document.getElementById('approveScheduleBtn').addEventListener('click', () => {
    const maxHours = parseFloat(document.getElementById('maxHours').value) || 7;
    const totalHours = recalcAndRender();
    if (totalHours > maxHours) {
      showOverageModal(totalHours, maxHours, () => {
        setScheduleStatus(`Schedule approved (${totalHours.toFixed(1)} hrs). Calendar view is coming in the next phase.`, 'success');
      });
    } else {
      setScheduleStatus(`Schedule approved (${totalHours.toFixed(1)} hrs). Calendar view is coming in the next phase.`, 'success');
    }
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

  if (tabName === 'schedule') { populateGroupSelect(); populateStartAddressSelect(); }
}

/* ============================================
   INIT
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(loadTheme());
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });

  wireScheduleUI();

  const radiusSlider = document.getElementById('radiusSlider');
  const radiusValue = document.getElementById('radiusValue');
  radiusSlider.value = radiusMiles;
  radiusValue.textContent = radiusMiles + ' mi';
  radiusSlider.addEventListener('input', () => {
    radiusMiles = parseFloat(radiusSlider.value);
    radiusValue.textContent = radiusMiles + ' mi';
  });
  radiusSlider.addEventListener('change', () => {
    saveRadius();
    regroup();
  });

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

  document.getElementById('downloadCsvBtn').addEventListener('click', () => {
    if (patients.length === 0) { setStatus('Nothing to download yet.', 'error'); return; }
    const csv = patientsToCSV(patients);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'patients.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('addCsvBtn').addEventListener('click', () => addFileInput.click());

  document.getElementById('clearAllBtn').addEventListener('click', () => {
    if (!confirm('This will remove all patients from this browser. Continue?')) return;
    patients = [];
    savePatients();
    renderTable();
    renderGroupSummary();
    setStatus('Cleared.', '');
  });

  renderTable();
  renderGroupSummary();
  if (patients.some(p => p.lat === null || p.lng === null)) {
    geocodeAllPending();
  }
});
