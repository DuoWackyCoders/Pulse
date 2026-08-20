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
  if (btn) {
    if (theme === 'dark') btn.textContent = '☀️ Light mode';
    else if (theme === 'light') btn.textContent = '🌙 Dark mode';
    else btn.textContent = '☀️ Reset to Light';
  }
  const sel = document.getElementById('themeSelect');
  if (sel) sel.value = theme;
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

  const searchInput = document.getElementById('clientsSearchInput');
  const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const displayed = getFilteredPatients().filter(p => !searchTerm || p.name.toLowerCase().includes(searchTerm));

  if (displayed.length === 0) {
    tableWrap.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.innerHTML = `<p>No patients match "${escapeHtml(searchInput.value)}".</p>`;
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
  savePatients();
  renderTable();
  renderGroupSummary();
  populateProviderFilter();
  resetManualRows();

  const statusEl = document.getElementById('manualAddStatus');
  statusEl.textContent = `Added ${toAdd.length} patient(s).` + (skipped > 0 ? ` Skipped ${skipped} duplicate(s).` : '') + ' Geocoding now...';
  statusEl.className = 'status-line success';

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
      : `${escapeHtml(p.name)} (Group ${escapeHtml(p.group || '—')})<br><button type="button" style="margin-top:6px;" onclick="window.addPatientToLeftover('${p.id}')">+ Add to Leftover</button>`;
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
  await recalcAndRender();
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
    const arrivalMinutes = cursorMinutes;
    const duration = p.visitDuration || defaultVisitDuration;
    cursorMinutes += duration;
    stops.push({ id: p.id, name: p.name, dob: p.dob, address: p.address, provider: p.provider, group: p.group, lat: p.lat, lng: p.lng, arrivalMinutes, travelMinutes, travelMiles });
    prevLat = p.lat; prevLng = p.lng; prevPatient = p;
  });

  let returnTripMinutes = 0;
  if (legs && legs[legs.length - 1]) {
    returnTripMinutes = legs[legs.length - 1].minutes;
  } else {
    const last = orderedPatients[orderedPatients.length - 1];
    returnTripMinutes = milesToMinutes(haversineMiles(last.lat, last.lng, startCoords.lat, startCoords.lng));
  }
  const returnHomeMinutes = cursorMinutes + returnTripMinutes;
  const totalHours = (returnHomeMinutes - dayStartMinutes) / 60;

  return { stops, totalHours, usingRealRoads, dayStartMinutes, returnHomeMinutes };
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
            <input type="number" class="wdc-count" min="1" value="8" placeholder="Stops">
          </div>
        ` : `
          <div class="wdc-fields">
            <select class="wdc-group">${groupSelectOptionsHtml()}</select>
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
  const visitDuration = parseFloat(document.getElementById('weekVisitDuration').value) || 15;
  const includeRecent = document.getElementById('weekIncludeRecent').checked;
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
      const stopCount = parseInt(card.querySelector('.wdc-count').value, 10) || 0;

      setWeekStatus(`Generating ${WEEK_DAY_LABELS[i]} (${i + 1} of 5)...`, '');

      const selection = selectRoutePatients({
        group, stopCount, startCoords: weekStartCoords, scheduleDate: dateStr, includeRecent, excludeIds: usedThisWeek
      });

      if (selection.error) {
        weekResults.push({ date: dateStr, dayLabel: WEEK_DAY_LABELS[i], group, stopCount, error: selection.error });
        continue;
      }

      selection.scheduled.forEach(p => usedThisWeek.add(p.id));
      const timing = await computeTimingForDay(weekStartCoords, selection.scheduled, startTime, visitDuration);

      weekResults.push({
        date: dateStr, dayLabel: WEEK_DAY_LABELS[i], group, stopCount,
        stops: timing.stops, totalHours: timing.totalHours, usingRealRoads: timing.usingRealRoads,
        fillCount: selection.fillCount, excludedCount: selection.excludedCount
      });
    }

    renderWeekResults();
    const successDays = weekResults.filter(d => !d.error && !d.offDay).length;
    setWeekStatus(`Generated ${successDays} of 5 days. Review below, then Approve Whole Week.`, 'success');
    document.getElementById('approveWeekBtn').style.display = weekResults.some(d => !d.error) ? 'inline-block' : 'none';
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
    return `
      <div class="week-result-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
          <h3>${day.dayLabel} — ${day.date}</h3>
          <button type="button" class="btn-tiny" onclick="window.openWeekDayInGoogleMaps(${dayIdx})">🗺️ Open in Google Maps</button>
        </div>
        <p class="wrc-meta">
          Group ${escapeHtml(day.group === '__ANY__' ? 'Closest Mix' : day.group)} · ${day.stops.length} stop(s) · ${day.totalHours.toFixed(1)} hrs
          · ${day.usingRealRoads ? '✓ real road times' : '⚠ straight-line estimate'}${fillNote}${excludedNote}
        </p>
        ${day.stops.map((s, i) => `
          <div class="week-stop-row">
            <span>#${i + 1} ${escapeHtml(s.name)} (Grp- ${escapeHtml(s.group || '—')})</span>
            <span>${minutesToClock(s.arrivalMinutes)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}

function setWeekStatus(msg, kind) {
  const el = document.getElementById('weekStatus');
  el.textContent = msg;
  el.className = 'status-line' + (kind ? ' ' + kind : '');
}

function approveWeek() {
  const datesToApprove = weekResults
    .filter(d => !d.offDay && !d.error && d.stops && d.stops.length > 0)
    .map(d => d.date);
  const conflicts = datesWithExistingSchedule(datesToApprove);

  if (conflicts.length > 0) {
    showOverwriteConfirm(
      `${conflicts.length} day(s) this week already have an approved schedule (${conflicts.join(', ')}). Continuing will overwrite those days' patient lists on the calendar — the prior schedule for those specific dates will be replaced, not merged. Continue?`,
      commitApproveWeek
    );
  } else {
    commitApproveWeek();
  }
}

function commitApproveWeek() {
  let totalApproved = 0;
  weekResults.forEach(day => {
    if (day.offDay || day.error || !day.stops || day.stops.length === 0) return;
    day.stops.forEach(s => {
      const master = patients.find(p => p.id === s.id);
      if (master) master.lastVisitDate = day.date;
    });
    recordApprovedSchedule(day.date, day.stops);
    totalApproved += day.stops.length;
  });
  savePatients();
  renderTable();
  setWeekStatus(`Approved the week — ${totalApproved} patient visit(s) across the days that generated successfully. Check the Home tab calendar.`, 'success');
  document.getElementById('approveWeekBtn').style.display = 'none';
}

function cancelWeek() {
  weekResults = [];
  document.getElementById('weekResults').innerHTML = '';
  document.getElementById('approveWeekBtn').style.display = 'none';
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

  const addrList = document.getElementById('adminAddressList');
  const saved = loadStartAddresses();
  addrList.innerHTML = saved.length === 0
    ? '<p class="status-line">No saved addresses yet — add one on the Schedule tab.</p>'
    : saved.map(a => `<div class="search-result-row"><span>${escapeHtml(a.label)} — ${escapeHtml(a.address)}</span></div>`).join('');
}

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
}

function switchScheduleMode(mode) {
  document.getElementById('scheduleModeDaily').style.display = mode === 'daily' ? 'block' : 'none';
  document.getElementById('scheduleModeWeekly').style.display = mode === 'weekly' ? 'block' : 'none';
  document.getElementById('dailyModeBtn').classList.toggle('active', mode === 'daily');
  document.getElementById('weeklyModeBtn').classList.toggle('active', mode === 'weekly');
  if (mode === 'weekly') {
    populateWeekStartAddressSelect();
    syncWorkDayCheckboxesUI();
    renderWeekDayCards();
  }
}

function wireWeeklyUI() {
  document.getElementById('dailyModeBtn').addEventListener('click', () => switchScheduleMode('daily'));
  document.getElementById('weeklyModeBtn').addEventListener('click', () => switchScheduleMode('weekly'));
  document.getElementById('weekStartDate').addEventListener('change', renderWeekDayCards);
  document.getElementById('generateWeekBtn').addEventListener('click', generateWeek);
  document.getElementById('approveWeekBtn').addEventListener('click', approveWeek);
  document.getElementById('cancelWeekBtn').addEventListener('click', cancelWeek);

  document.querySelectorAll('.workDayToggle').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-day'), 10);
      standardWorkDays[idx] = e.target.checked;
      saveStandardWorkDays(standardWorkDays);
      renderWeekDayCards();
    });
  });
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

    scheduledPatients = result.scheduled;
    leftoverPatients = result.leftover;

    document.getElementById('routeBuilderCard').style.display = 'block';
    await recalcAndRender();
    const addedNote = result.addressMateCount > 0 ? ` (+${result.addressMateCount} same-address patient(s) added automatically.)` : '';
    const excludedNote = result.excludedCount > 0 ? ` (${result.excludedCount} recently-visited patient(s) excluded.)` : '';
    let statusMsg;
    if (result.strictGroup) {
      const fillNote = result.fillCount > 0 ? ` Group ${group} only had ${result.groupOnlyCount} available, so ${result.fillCount} nearby patient(s) from other groups were added to reach ${stopCount}.` : '';
      statusMsg = `Route generated for Group ${group}${group2 ? ' + ' + group2 : ''}.` + excludedNote + addedNote + fillNote;
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
  renderRouteSummary(dayStartMinutes, returnHomeMinutes, usingRealRoads, returnTripMinutes, returnTripMiles);

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

function renderRouteSummary(startMinutes, returnHomeMinutes, usingRealRoads, returnTripMinutes, returnTripMiles) {
  const el = document.getElementById('routeSummary');
  if (!el) return;
  if (scheduledPatients.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <span class="rs-item"><span class="rs-label">Start:</span> Home ${minutesToClock(startMinutes)}</span>
    <span class="rs-item"><span class="rs-label">Return trip:</span> 🚗 ${Math.round(returnTripMinutes)} min / ${returnTripMiles.toFixed(1)} mi</span>
    <span class="rs-item"><span class="rs-label">Arrive home:</span> ${minutesToClock(returnHomeMinutes)}</span>
    <span class="rs-item"><span class="rs-label">Total day:</span> ${((returnHomeMinutes - startMinutes) / 60).toFixed(1)} hrs</span>
    <span class="rs-item" style="color:${usingRealRoads ? 'var(--lime-deep)' : 'var(--pink-deep)'};">${usingRealRoads ? '✓ real road times' : '⚠ straight-line estimate (routing service unreachable)'}</span>
  `;
}

function dragItemHtml(p, listName, index, showTime) {
  const highlightClass = p.justAdded ? ' highlight-new' : '';
  return `
    <li class="drag-item${highlightClass}" draggable="true" data-id="${p.id}" data-list="${listName}" data-index="${index}">
      <div class="di-name">#${index + 1} ${escapeHtml(p.name)}${p.group ? ` <span style="color:var(--text-soft); font-weight:600; font-size:0.8em;">(Grp- ${escapeHtml(p.group)})</span>` : ''}</div>
      <div class="di-meta">${escapeHtml(p.dob)} — ${escapeHtml(p.address)}</div>
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

function cancelRoute() {
  scheduledPatients = [];
  leftoverPatients = [];
  startCoords = null;
  document.getElementById('routeBuilderCard').style.display = 'none';
  document.getElementById('routeSummary').innerHTML = '';
  document.getElementById('myMapsHelp').style.display = 'none';
  if (leafletLayer) { leafletLayer.remove(); leafletLayer = null; }
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
      scheduledPatients.forEach(sp => {
        const master = patients.find(p => p.id === sp.id);
        if (master) master.lastVisitDate = scheduleDate;
      });
      savePatients();
      renderTable();
      recordApprovedSchedule(scheduleDate, scheduledPatients);
      setScheduleStatus(`Schedule approved for ${scheduleDate} (${totalHours.toFixed(1)} hrs). Check the Home tab calendar to see it.`, 'success');
    };

    const proceedPastOverageCheck = () => {
      if (totalHours > maxHours) {
        showOverageModal(totalHours, maxHours, commit);
      } else {
        commit();
      }
    };

    if (datesWithExistingSchedule([scheduleDate]).length > 0) {
      showOverwriteConfirm(
        `${scheduleDate} already has an approved schedule. Continuing will overwrite it with today's list — the prior schedule for this date will be replaced, not merged. Continue?`,
        proceedPastOverageCheck
      );
    } else {
      proceedPastOverageCheck();
    }
  }

  document.getElementById('approveScheduleBtn').addEventListener('click', handleApproveClick);
  document.getElementById('approveScheduleBtnTop').addEventListener('click', handleApproveClick);
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

  // Keep patient lastVisitDate in sync with the move
  fromList.forEach(entry => {
    const master = patients.find(p => p.id === entry.id);
    if (master && master.lastVisitDate === fromDate) master.lastVisitDate = toDate;
  });
  savePatients();
  renderTable();
  renderCalendar();
}

window.cancelDaySchedule = function (dateStr) {
  const schedules = loadSchedules();
  const list = schedules[dateStr] || [];
  if (list.length === 0) { alert('Nothing scheduled on this day.'); return; }
  if (!confirm(`Cancel the entire schedule for ${dateStr}? This removes all ${list.length} patient(s) from the calendar for this day and cannot be undone.`)) return;

  list.forEach(entry => {
    const master = patients.find(p => p.id === entry.id);
    if (master && master.lastVisitDate === dateStr) master.lastVisitDate = null;
  });
  delete schedules[dateStr];
  saveSchedules(schedules);
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

  weekDates.forEach(d => {
    const list = schedules[d] || [];
    list.forEach(entry => {
      const master = patients.find(p => p.id === entry.id);
      if (master && master.lastVisitDate === d) master.lastVisitDate = null;
    });
    delete schedules[d];
  });
  saveSchedules(schedules);
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

  const master = patients.find(p => p.id === patientId);
  if (master && master.lastVisitDate === fromDate) {
    master.lastVisitDate = newDate;
    savePatients();
    renderTable();
  }
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
  applyTheme(loadTheme());
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });

  wireScheduleUI();
  wireWeeklyUI();
  wireAdminTab();
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

  document.getElementById('downloadCsvBtn').addEventListener('click', downloadAllPatientsCsv);

  document.getElementById('addCsvBtn').addEventListener('click', () => addFileInput.click());

  document.getElementById('clearAllBtn').addEventListener('click', showClearAllStep1);

  document.getElementById('addManualRowBtn').addEventListener('click', addManualRow);
  document.getElementById('clientsSearchInput').addEventListener('input', renderTable);
  document.getElementById('scheduleSearchInput').addEventListener('input', (e) => renderScheduleSearchResults(e.target.value.trim()));
  document.getElementById('submitManualAddBtn').addEventListener('click', submitManualAdd);
  addManualRow(); // start with one blank row

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
