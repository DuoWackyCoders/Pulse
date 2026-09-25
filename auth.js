/* ============================================
   AUTH GATE
   Everything here is deliberately separate from
   script.js — this file only decides whether the
   #authScreen or the #appRoot (the actual PULSE app)
   is visible. It never touches patients, schedules,
   or any of the app's own logic.
   ============================================ */
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function showApp(session) {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appRoot').style.display = 'flex';
  const emailLabel = document.getElementById('loggedInEmail');
  if (emailLabel) emailLabel.textContent = session.user.email;
  // Fire-and-forget: the app is already visible with default settings
  // (light theme, group size 20, etc.); this quietly swaps in the
  // person's real saved settings once it comes back from Supabase.
  if (typeof initUserSettings === 'function') initUserSettings();
  if (typeof initStartAddresses === 'function') initStartAddresses();
  if (typeof initPatients === 'function') initPatients();
  if (typeof initSchedules === 'function') initSchedules();
  if (typeof initFeedback === 'function') initFeedback();
  if (typeof initChangelog === 'function') initChangelog();
  if (window.currentOrgRole === 'admin' && typeof refreshTeamMembers === 'function') refreshTeamMembers();
  if (window.isPulseOwner) {
    const navBtn = document.getElementById('masterPulseNavBtn');
    if (navBtn) navBtn.style.display = '';
    if (typeof initMasterPulse === 'function') initMasterPulse();
  }
}

function showMaintenanceScreen(message) {
  hideAllAuthViews();
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('authMaintenanceMessage').textContent =
    message || 'PULSE is temporarily down for maintenance — please check back soon.';
  document.getElementById('authMaintenanceView').style.display = 'block';
}

function showSuspendedScreen(reason) {
  hideAllAuthViews();
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('authSuspendedReason').textContent =
    reason ? `Reason given: ${reason}` : '';
  document.getElementById('authSuspendedView').style.display = 'block';
}

function showAuthScreen() {
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('appRoot').style.display = 'none';
  showLoginView();
}

function hideAllAuthViews() {
  document.getElementById('authLoginView').style.display = 'none';
  document.getElementById('authResetView').style.display = 'none';
  document.getElementById('authNewPasswordView').style.display = 'none';
  document.getElementById('authOrgSetupView').style.display = 'none';
  document.getElementById('authMaintenanceView').style.display = 'none';
  document.getElementById('authSuspendedView').style.display = 'none';
  setAuthStatus('', '');
}

function showLoginView() {
  hideAllAuthViews();
  document.getElementById('authLoginView').style.display = 'block';
}

function showResetView() {
  hideAllAuthViews();
  document.getElementById('authResetView').style.display = 'block';
}

function showNewPasswordView() {
  hideAllAuthViews();
  document.getElementById('authNewPasswordView').style.display = 'block';
}

function showOrgSetupView() {
  hideAllAuthViews();
  document.getElementById('authOrgSetupView').style.display = 'block';
}

// Every login lands here first instead of going straight to showApp(). This
// checks, in order: are you the owner of PULSE itself (separate from any
// one company's admin role — see sql/004_pulse_owner_admin.sql); is the
// whole site in maintenance mode (a Pulse owner still gets in, so they can
// turn it back off); does the person already belong to a company (a row
// in memberships) — if not, the one-time "name your company" screen; and
// is THAT company currently suspended. Only after all of that does
// window.currentOrgId/currentOrgRole get set and showApp() run.
async function checkOrgSetup(session) {
  const isOwner = typeof checkPulseOwner === 'function' ? await checkPulseOwner() : false;

  if (!isOwner && typeof checkMaintenanceMode === 'function') {
    const maint = await checkMaintenanceMode();
    if (maint && maint.maintenance_mode) {
      showMaintenanceScreen(maint.maintenance_message);
      return;
    }
  }

  const { data: memberships, error } = await supabaseClient
    .from('memberships')
    .select('org_id, role, organizations(suspended, suspended_reason)')
    .eq('user_id', session.user.id)
    .limit(1);

  if (error) {
    setAuthStatus('Could not check your account setup: ' + error.message, 'error');
    return;
  }

  if (memberships && memberships.length > 0) {
    const membership = memberships[0];
    const org = membership.organizations;
    if (org && org.suspended && !isOwner) {
      showSuspendedScreen(org.suspended_reason);
      return;
    }
    window.currentOrgId = membership.org_id;
    window.currentOrgRole = membership.role;
    window.currentUserId = session.user.id;
    // "Viewing as" always starts as yourself — an admin explicitly picks a
    // teammate from here to see the app through their eyes instead.
    window.viewingAsUserId = null;
    window.viewingAsLabel = null;
    showApp(session);
  } else {
    showOrgSetupView();
  }
}

// "Just me" fills in a reasonable personal default (from the email they
// signed up with) rather than making a solo user think up a company name.
// They can still edit it before hitting Continue.
async function handleJustMeFill() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const namePart = session.user.email.split('@')[0];
  const guess = namePart.charAt(0).toUpperCase() + namePart.slice(1);
  document.getElementById('orgNameInput').value = guess;
  document.getElementById('orgNameInput').focus();
}

async function handleCreateOrg() {
  const name = document.getElementById('orgNameInput').value.trim();
  if (!name) { setAuthStatus('Enter a name first — a company name, or just your own.', 'error'); return; }
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { setAuthStatus('Your session expired — please log in again.', 'error'); showAuthScreen(); return; }

  setAuthStatus('Setting this up...', '');
  // create_organization does both inserts (the company, then your admin
  // membership) as one atomic database action — see
  // sql/002_create_organization_function.sql for why that matters.
  const { data: newOrgId, error } = await supabaseClient.rpc('create_organization', { org_name: name });
  if (error) { setAuthStatus(error.message, 'error'); return; }

  window.currentOrgId = newOrgId;
  window.currentOrgRole = 'admin';
  showApp(session);
}

function setAuthStatus(msg, kind) {
  const el = document.getElementById('authStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-line' + (kind ? ' ' + kind : '');
}

async function handleSignUp() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if (!email || !password) { setAuthStatus('Enter an email and password first.', 'error'); return; }
  setAuthStatus('Creating your account...', '');
  // Explicitly tell Supabase where the confirmation link should send them
  // back to, rather than relying on the project's Site URL setting alone —
  // that setting still needs to allow this URL (Authentication -> URL
  // Configuration), but this avoids depending on it defaulting correctly.
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });
  if (error) { setAuthStatus(error.message, 'error'); return; }
  if (data.session) {
    // Email confirmation is off — signUp already logs them in, onAuthStateChange takes it from here.
    setAuthStatus('Account created!', 'success');
  } else {
    setAuthStatus('Account created! Check your email to confirm it, then log in below.', 'success');
  }
}

async function handleLogIn() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if (!email || !password) { setAuthStatus('Enter an email and password first.', 'error'); return; }
  setAuthStatus('Logging in...', '');
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) { setAuthStatus(error.message, 'error'); return; }
  setAuthStatus('', '');
}

async function handleLogOut() {
  await supabaseClient.auth.signOut();
}

async function handleSendResetEmail() {
  const email = document.getElementById('resetEmail').value.trim();
  if (!email) { setAuthStatus('Enter your email first.', 'error'); return; }
  setAuthStatus('Sending reset link...', '');
  // redirectTo must be on Supabase's allowed redirect list (Authentication ->
  // URL Configuration) or the emailed link won't come back here.
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  if (error) { setAuthStatus(error.message, 'error'); return; }
  setAuthStatus('Check your email for a reset link.', 'success');
}

async function handleSetNewPassword() {
  const newPassword = document.getElementById('newPasswordInput').value;
  if (!newPassword || newPassword.length < 6) { setAuthStatus('Password must be at least 6 characters.', 'error'); return; }
  setAuthStatus('Updating password...', '');
  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
  if (error) { setAuthStatus(error.message, 'error'); return; }
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) showApp(session);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('authSignUpBtn').addEventListener('click', handleSignUp);
  document.getElementById('authLogInBtn').addEventListener('click', handleLogIn);
  document.getElementById('logoutBtn').addEventListener('click', handleLogOut);
  document.getElementById('authPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogIn();
  });

  document.getElementById('showForgotPasswordBtn').addEventListener('click', showResetView);
  document.getElementById('backToLoginBtn').addEventListener('click', showLoginView);
  document.getElementById('sendResetEmailBtn').addEventListener('click', handleSendResetEmail);
  document.getElementById('setNewPasswordBtn').addEventListener('click', handleSetNewPassword);
  document.getElementById('createOrgBtn').addEventListener('click', handleCreateOrg);
  document.getElementById('orgSetupJustMeBtn').addEventListener('click', handleJustMeFill);
  document.getElementById('orgSetupLogoutBtn').addEventListener('click', handleLogOut);
  document.getElementById('maintenanceLogoutBtn').addEventListener('click', handleLogOut);
  document.getElementById('suspendedLogoutBtn').addEventListener('click', handleLogOut);

  // Fires once immediately with whatever session already exists (or none),
  // then again on every future login/logout — this single listener is what
  // decides which screen is showing at all times. A password-reset link
  // lands here as its own event, distinct from a normal login, so it gets
  // routed to the "set a new password" view instead of straight into the app.
  // Every other successful session goes through checkOrgSetup first, since
  // showApp() itself is never called directly here anymore.
  //
  // Supabase also re-fires this with a still-valid session for the SAME
  // person just from switching browser tabs/windows and coming back (it
  // quietly re-checks the session on focus) — not just on an actual login.
  // Without the guard below, every one of those silently re-ran
  // checkOrgSetup -> showApp -> initPatients()/initSchedules()/etc., which
  // re-fetches from the database and OVERWRITES whatever's currently on
  // screen with what's already saved — wiping out a just-made change (like
  // a group assignment) if its own save hadn't finished landing yet. Only
  // react when the logged-in person actually changed (a real login/logout),
  // not on a same-person re-confirmation.
  let activeSessionUserId = null;
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { showNewPasswordView(); return; }
    if (session) {
      if (session.user.id === activeSessionUserId) return;
      activeSessionUserId = session.user.id;
      checkOrgSetup(session);
    } else {
      activeSessionUserId = null;
      showAuthScreen();
    }
  });
});
