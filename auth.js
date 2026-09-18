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
}

function showAuthScreen() {
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('appRoot').style.display = 'none';
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
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
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

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('authSignUpBtn').addEventListener('click', handleSignUp);
  document.getElementById('authLogInBtn').addEventListener('click', handleLogIn);
  document.getElementById('logoutBtn').addEventListener('click', handleLogOut);
  document.getElementById('authPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogIn();
  });

  // Fires once immediately with whatever session already exists (or none),
  // then again on every future login/logout — this single listener is what
  // decides which screen is showing at all times.
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session) showApp(session);
    else showAuthScreen();
  });
});
