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
  practitioner_email: ''
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
      practitioner_email: data.practitioner_email || ''
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
