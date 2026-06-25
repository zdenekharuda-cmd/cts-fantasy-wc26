export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

export async function requireLogin() {
  const { user } = await api('/api/me');
  if (!user) window.location.href = '/login.html';
  return user;
}

export async function renderNav() {
  const nav = document.querySelector('[data-nav]');
  if (!nav) return;
  const { user } = await api('/api/me');
  nav.innerHTML = user
    ? `<a href="/tips.html">Tipy</a><a href="/bonus.html">Bonusové tipy</a><a href="/scoreboard.html">Žebříček</a><a href="/bracket.html">Pavouk</a><a href="/bodovani.html">Bodování</a><span>${escapeHtml(user.nickname)}</span><button id="logoutBtn">Odhlásit</button>`
    : `<a href="/login.html">Přihlášení</a><a href="/register.html">Registrace</a><a href="/bonus.html">Bonusové tipy</a><a href="/scoreboard.html">Žebříček</a><a href="/bracket.html">Pavouk</a><a href="/bodovani.html">Bodování</a>`;

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await api('/api/logout', { method: 'POST' });
      window.location.href = '/login.html';
    });
  }
}

export function setMessage(element, text, type = '') {
  element.textContent = text;
  element.className = `message ${type}`.trim();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function flagSpan(code) {
  return code ? `<span class="fi fi-${escapeHtml(code)}"></span>` : `<span>🏳️</span>`;
}

export function formatKickoff(iso) {
  if (!iso) return 'Time TBD';
  const date = new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

renderNav().catch(() => {});
