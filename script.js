/* ============================================
   STORAGE KEYS
   ============================================ */
const STORAGE_KEY = 'patientRouter.patients.v1';
const RADIUS_KEY = 'patientRouter.radius.v1';
const THEME_KEY = 'patientRouter.theme.v1';

/* ============================================
   STATE
   ============================================ */
let patients = loadPatients();     // array of patient objects
let radiusMiles = loadRadius();    // clustering radius

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
function loadRadius() {
  const raw = localStorage.getItem(RADIUS_KEY);
  return raw ? parseFloat(raw) : 5;
}
function saveRadius() {
  localStorage.setItem(RADIUS_KEY, String(radiusMiles));
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

function csvToPatients(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];

  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = {
    name: header.findIndex(h => h.includes('name')),
    address: header.findIndex(h => h.includes('address')),
    dob: header.findIndex(h => h.includes('dob') || h.includes('birth')),
    coordinator: header.findIndex(h => h.includes('coordinator')),
    provider: header.findIndex(h => h.includes('provider')),
    notes: header.findIndex(h => h.includes('note')),
  };

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const name = idx.name >= 0 ? (cols[idx.name] || '').trim() : '';
    const address = idx.address >= 0 ? (cols[idx.address] || '').trim() : '';
    if (!name && !address) continue;

    out.push({
      id: 'p_' + Date.now() + '_' + r + '_' + Math.random().toString(36).slice(2, 7),
      name,
      address,
      dob: idx.dob >= 0 ? (cols[idx.dob] || '').trim() : '',
      coordinator: idx.coordinator >= 0 ? (cols[idx.coordinator] || '').trim() : '',
      provider: idx.provider >= 0 ? (cols[idx.provider] || '').trim() : '',
      notes: idx.notes >= 0 ? (cols[idx.notes] || '').trim() : '',
      lat: null,
      lng: null,
      group: null,
      manualGroup: false,
    });
  }
  return out;
}

function patientsToCSV(list) {
  const header = ['Name', 'Address', 'DOB', 'Coordinator', 'Provider', 'Notes', 'Group'];
  const escape = (v) => {
    const s = (v ?? '').toString();
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [header.join(',')];
  for (const p of list) {
    lines.push([p.name, p.address, p.dob, p.coordinator, p.provider, p.notes, p.group || '']
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

function renderTable() {
  const tbody = document.getElementById('patientTableBody');
  const emptyState = document.getElementById('emptyState');
  const tableWrap = document.getElementById('tableWrap');
  if (!tbody) return;

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
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.address)}${p.geocodeFailed ? ' <span style="color:var(--pink-deep)">(not found)</span>' : ''}</td>
      <td>${escapeHtml(p.dob)}</td>
      <td>${escapeHtml(p.coordinator)}</td>
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
   TAB NAVIGATION
   ============================================ */
function switchTab(tabName) {
  document.querySelectorAll('.tab-panel').forEach(el => { el.style.display = 'none'; });
  const target = document.getElementById('tab-' + tabName);
  if (target) target.style.display = 'block';

  document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
  if (activeBtn) activeBtn.classList.add('active');
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
