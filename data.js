/* ============================================
   USER SETTINGS (Supabase-backed)
   Personal preferences — theme, group size, work days, practitioner
   info, saved "home" address, extra CSV columns. One row per person in
   the user_settings table, independent of which company they belong to.
   script.js reads/writes the in-memory `userSettings` object below and
   calls saveUserSettings() to persist a change; this file owns talking
   to Supabase so script.js doesn't need to know how that works.
   ============================================ */

const DEFAULT_USER_SETTINGS = {
  theme: 'light',
  group_size_max: 20,
  home_address_id: null,
  standard_work_days: [true, true, true, true, true],
  extra_columns: [],
  practitioner_name: '',
  practitioner_phone: '',
  practitioner_email: '',
  // Schedule tab defaults — remembered so they don't reset to a generic
  // value every login. null/'' here just means "nothing saved yet";
  // script.js falls back to sensible hardcoded values in that case.
  stop_count: null,
  start_time: '',
  return_time: '',
  visit_duration: null,
  max_hours: null,
  route_direction: ''
};

// Seeds the starting theme from the same local anti-flash cache the inline
// <head> script already applied to the page before any of this ran — so
// script.js's own initial "apply the default" call re-applies the SAME
// value instead of stomping it back to the hardcoded default (which is
// exactly what caused a visible flash back to light, especially on the
// login screen where no login ever happens to correct it afterward).
function getCachedTheme() {
  try { return localStorage.getItem('pulseLastTheme') || DEFAULT_USER_SETTINGS.theme; }
  catch (e) { return DEFAULT_USER_SETTINGS.theme; }
}

let userSettings = { ...DEFAULT_USER_SETTINGS, theme: getCachedTheme() };

// Called once, right after login (from auth.js's showApp). Fetches this
// person's settings row, or creates one with defaults if this is their
// first time logging in. Then tells script.js to re-apply whatever it
// already rendered with defaults, now with their real saved values.
async function initUserSettings() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  const { data, error } = await supabaseClient
    .from('user_settings')
    .select('*')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) {
    console.error('Failed to load user settings', error);
    return;
  }

  if (data) {
    userSettings = {
      theme: data.theme || DEFAULT_USER_SETTINGS.theme,
      group_size_max: data.group_size_max ?? DEFAULT_USER_SETTINGS.group_size_max,
      home_address_id: data.home_address_id || null,
      standard_work_days: data.standard_work_days || DEFAULT_USER_SETTINGS.standard_work_days,
      extra_columns: data.extra_columns || [],
      practitioner_name: data.practitioner_name || '',
      practitioner_phone: data.practitioner_phone || '',
      practitioner_email: data.practitioner_email || '',
      stop_count: data.stop_count ?? null,
      start_time: data.start_time || '',
      return_time: data.return_time || '',
      visit_duration: data.visit_duration ?? null,
      max_hours: data.max_hours ?? null,
      route_direction: data.route_direction || ''
    };
  } else {
    // First login ever for this person — create their settings row with defaults.
    const { error: insertError } = await supabaseClient
      .from('user_settings')
      .insert({ user_id: session.user.id });
    if (insertError) console.error('Failed to create default settings row', insertError);
    userSettings = { ...DEFAULT_USER_SETTINGS };
  }

  if (typeof applyLoadedUserSettings === 'function') applyLoadedUserSettings();
}

// Updates the in-memory copy immediately (so the UI feels instant) and
// writes the change to Supabase in the background. patch only needs to
// contain the field(s) that changed, e.g. { theme: 'dark' }.
async function saveUserSettings(patch) {
  Object.assign(userSettings, patch);
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return; // not logged in yet (e.g. the very first theme apply on page load) — nothing to save to
  const { error } = await supabaseClient
    .from('user_settings')
    .update(patch)
    .eq('user_id', session.user.id);
  if (error) console.error('Failed to save settings', error);
}

/* ============================================
   START ADDRESSES (Supabase-backed)
   Saved home-base / office addresses a person picks from when building a
   route. script.js keeps calling loadStartAddresses()/addStartAddress()/
   deleteStartAddress() exactly as before — those now read/write the
   in-memory `startAddresses` array below (kept in sync with Supabase)
   instead of localStorage, so none of their many call sites needed to
   change into async code themselves.
   ============================================ */
let startAddresses = [];

async function initStartAddresses() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  const { data, error } = await supabaseClient
    .from('start_addresses')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: true });

  if (error) { console.error('Failed to load start addresses', error); return; }

  startAddresses = data || [];
  if (typeof applyLoadedStartAddresses === 'function') applyLoadedStartAddresses();
}

// Inserts one address into Supabase and returns the saved row (with its
// real id), or null if it failed. Does not touch the in-memory array —
// script.js's addStartAddress() does that itself once this resolves.
async function insertStartAddress(entry) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabaseClient
    .from('start_addresses')
    .insert({ user_id: session.user.id, label: entry.label, address: entry.address, lat: entry.lat, lng: entry.lng })
    .select()
    .single();
  if (error) { console.error('Failed to save address', error); return null; }
  return data;
}

async function removeStartAddress(id) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const { error } = await supabaseClient
    .from('start_addresses')
    .delete()
    .eq('id', id)
    .eq('user_id', session.user.id);
  if (error) console.error('Failed to delete address', error);
}

/* ============================================
   FEEDBACK (Supabase-backed)
   Bug reports / suggestions submitted from the About tab. Only an org
   admin can ever read them back (see sql/003_feedback_and_changelog.sql),
   so this only actually loads anything for an admin — script.js's Admin
   tab is the only place feedbackEntries gets shown.
   ============================================ */
let feedbackEntries = [];

async function initFeedback() {
  if (window.currentOrgRole !== 'admin') return;
  const { data, error } = await supabaseClient
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('Failed to load feedback', error); return; }
  feedbackEntries = data || [];
  if (typeof renderFeedbackInbox === 'function') renderFeedbackInbox();
}

// Returns { ok: true } or { ok: false, error }. photoFile is an optional
// File object straight from the <input type="file">; when present it's
// uploaded first and only the resulting storage path is saved on the
// feedback row (never a public URL — the bucket is private, so viewing it
// later always goes through getFeedbackPhotoUrl's signed link instead).
async function submitFeedback(message, photoFile) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return { ok: false, error: 'Not logged in.' };
  if (!window.currentOrgId) return { ok: false, error: 'Could not tell which company you belong to — try refreshing.' };

  let photoPath = null;
  if (photoFile) {
    photoPath = `${window.currentOrgId}/${Date.now()}_${photoFile.name}`;
    const { error: uploadError } = await supabaseClient.storage
      .from('feedback-photos')
      .upload(photoPath, photoFile);
    if (uploadError) return { ok: false, error: 'Photo upload failed: ' + uploadError.message };
  }

  const { error } = await supabaseClient.from('feedback').insert({
    org_id: window.currentOrgId,
    message,
    photo_url: photoPath
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function markFeedbackResolved(id, resolved) {
  const { error } = await supabaseClient
    .from('feedback')
    .update({ status: resolved ? 'resolved' : 'open' })
    .eq('id', id);
  if (error) { console.error('Failed to update feedback status', error); return false; }
  const entry = feedbackEntries.find(f => f.id === id);
  if (entry) entry.status = resolved ? 'resolved' : 'open';
  return true;
}

// photo_url on the row is just a storage path (private bucket) — this
// exchanges it for a short-lived link actually usable in an <img> or link.
async function getFeedbackPhotoUrl(path) {
  const { data, error } = await supabaseClient.storage
    .from('feedback-photos')
    .createSignedUrl(path, 3600);
  if (error) { console.error('Failed to get feedback photo link', error); return null; }
  return data.signedUrl;
}

/* ============================================
   CHANGELOG (Supabase-backed)
   PULSE's own "what's new" list — not org-scoped, everyone logged in
   sees the same list (see sql/003_feedback_and_changelog.sql).
   ============================================ */
let changelogEntries = [];

async function initChangelog() {
  const { data, error } = await supabaseClient
    .from('changelog')
    .select('*')
    .order('released_at', { ascending: false });
  if (error) { console.error('Failed to load changelog', error); return; }
  changelogEntries = data || [];
  if (typeof renderChangelog === 'function') renderChangelog();
}

/* ============================================
   TEAMMATES (Supabase-backed)
   Adding a second (or third...) person to your company, and viewing the
   app exactly as one of them sees it. See sql/006_teammates.sql — an
   invite only works if that email already has a PULSE account; the app
   itself never sends email or reads anyone's address directly.
   ============================================ */

// Returns 'added' | 'not_found' | 'already_member' | 'error'.
async function inviteTeammate(email) {
  const { data, error } = await supabaseClient.rpc('invite_teammate', {
    target_org_id: window.currentOrgId,
    teammate_email: email
  });
  if (error) { console.error('Failed to invite teammate', error); return 'error'; }
  return data;
}

// Returns [{ user_id, email, role }, ...] or [] on failure.
async function listOrgMembers() {
  const { data, error } = await supabaseClient.rpc('list_org_members', { target_org_id: window.currentOrgId });
  if (error) { console.error('Failed to load team members', error); return []; }
  return data || [];
}

async function removeTeammate(userId) {
  const { error } = await supabaseClient
    .from('memberships')
    .delete()
    .eq('org_id', window.currentOrgId)
    .eq('user_id', userId);
  if (error) { console.error('Failed to remove teammate', error); return false; }
  return true;
}

async function changeTeammateRole(userId, role) {
  const { error } = await supabaseClient
    .from('memberships')
    .update({ role })
    .eq('org_id', window.currentOrgId)
    .eq('user_id', userId);
  if (error) { console.error('Failed to change teammate role', error); return false; }
  return true;
}

// entry: { title, description, mediaUrl, releasedAt }. Returns { ok, error }.
async function postChangelogEntry(entry) {
  const { error } = await supabaseClient.from('changelog').insert({
    title: entry.title,
    description: entry.description,
    media_url: entry.mediaUrl || null,
    released_at: entry.releasedAt
  });
  if (error) return { ok: false, error: error.message };
  await initChangelog();
  return { ok: true };
}

/* ============================================
   MASTER PULSE (Supabase-backed)
   The "owner of PULSE itself" view — entirely separate from any one
   company's admin role. See sql/004_pulse_owner_admin.sql for how this
   boundary is enforced: a Pulse owner can suspend a company or flip the
   sitewide maintenance switch, and see feedback across every company, but
   the database itself never lets them read patient/schedule data.
   ============================================ */
window.isPulseOwner = false;
let allOrganizations = [];
let allFeedbackEntries = [];
let platformSettings = { maintenance_mode: false, maintenance_message: '' };

// Whether the CURRENTLY LOGGED IN person is a Pulse owner. A non-owner
// gets back an empty result here (not an error) — Row Level Security only
// ever lets someone see their OWN row in pulse_owners, if they have one.
async function checkPulseOwner() {
  const { data, error } = await supabaseClient
    .from('pulse_owners')
    .select('user_id')
    .maybeSingle();
  window.isPulseOwner = !error && !!data;
  return window.isPulseOwner;
}

// Safe to call even for a non-owner — the sitewide maintenance flag is
// readable by anyone logged in (see sql/004), just not editable by them.
async function checkMaintenanceMode() {
  const { data, error } = await supabaseClient
    .from('platform_settings')
    .select('maintenance_mode, maintenance_message')
    .eq('id', 'main')
    .maybeSingle();
  if (error) { console.error('Failed to check maintenance mode', error); return null; }
  return data;
}

async function initMasterPulse() {
  if (!window.isPulseOwner) return;
  const [{ data: orgs, error: orgErr }, { data: fb, error: fbErr }, { data: settings, error: settingsErr }] = await Promise.all([
    supabaseClient.from('organizations').select('id, name, suspended, suspended_reason, created_at').order('created_at', { ascending: false }),
    supabaseClient.from('feedback').select('*, organizations(name)').order('created_at', { ascending: false }),
    supabaseClient.from('platform_settings').select('*').eq('id', 'main').single()
  ]);
  if (orgErr) console.error('Failed to load organizations', orgErr); else allOrganizations = orgs || [];
  if (fbErr) console.error('Failed to load all feedback', fbErr); else allFeedbackEntries = fb || [];
  if (settingsErr) console.error('Failed to load platform settings', settingsErr); else platformSettings = settings || platformSettings;
  if (typeof renderMasterPulse === 'function') renderMasterPulse();
}

async function setOrgSuspended(orgId, suspended, reason) {
  const { error } = await supabaseClient
    .from('organizations')
    .update({ suspended, suspended_reason: suspended ? (reason || null) : null })
    .eq('id', orgId);
  if (error) { console.error('Failed to update organization', error); return false; }
  const org = allOrganizations.find(o => o.id === orgId);
  if (org) { org.suspended = suspended; org.suspended_reason = suspended ? (reason || null) : null; }
  return true;
}

async function saveMaintenanceMode(enabled, message) {
  const { error } = await supabaseClient
    .from('platform_settings')
    .update({ maintenance_mode: enabled, maintenance_message: message, updated_at: new Date().toISOString() })
    .eq('id', 'main');
  if (error) { console.error('Failed to update platform settings', error); return false; }
  platformSettings.maintenance_mode = enabled;
  platformSettings.maintenance_message = message;
  return true;
}

async function markOwnerFeedbackResolved(id, resolved) {
  const { error } = await supabaseClient
    .from('feedback')
    .update({ status: resolved ? 'resolved' : 'open' })
    .eq('id', id);
  if (error) { console.error('Failed to update feedback status', error); return false; }
  const entry = allFeedbackEntries.find(f => f.id === id);
  if (entry) entry.status = resolved ? 'resolved' : 'open';
  return true;
}
