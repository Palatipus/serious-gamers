// Shared portal navigation builder
export function getPlayer() {
  const raw = localStorage.getItem('sg_player');
  if (!raw) { window.location.href = 'index.html'; return null; }
  return JSON.parse(raw);
}

export function logout() {
  localStorage.removeItem('sg_player');
  window.location.href = 'index.html';
}

export function buildNav(activePage) {
  const player = getPlayer();
  if (!player) return;

  const initials = player.username.slice(0, 2).toUpperCase();

  const navLinks = [
    { href: 'dashboard.html',    icon: '🏠', label: 'Dashboard',   id: 'dashboard' },
    { href: 'tournaments.html',  icon: '🏆', label: 'Tournaments',  id: 'tournaments' },
    { href: 'my-matches.html',   icon: '⚽', label: 'My Matches',   id: 'my-matches' },
  ];

  const html = `
    <nav class="sidenav" id="sidenav">
      <div class="sidenav-logo">
        <div class="wordmark">SERIOUS<br>GAMERS</div>
        <div class="sub">Tournament Platform</div>
      </div>
      <div class="sidenav-player">
        <div class="player-avatar">${initials}</div>
        <div class="player-info">
          <div class="name">${player.username}</div>
          <div class="role">Player</div>
        </div>
      </div>
      <div class="sidenav-links">
        <div class="nav-section-label">Navigation</div>
        ${navLinks.map(l => `
          <a href="${l.href}" class="${activePage === l.id ? 'active' : ''}">
            <span class="nav-icon">${l.icon}</span>${l.label}
          </a>`).join('')}
        <div class="nav-section-label" style="margin-top:12px">Admin</div>
        <a href="admin.html" class="${activePage === 'admin' ? 'active' : ''}" style="color:var(--red)">
          <span class="nav-icon">⚡</span>Admin Panel
        </a>
      </div>
      <div class="sidenav-bottom">
        <button class="btn btn-ghost btn-sm" style="width:100%" id="logoutBtn">Sign Out</button>
      </div>
    </nav>`;

  document.body.insertAdjacentHTML('afterbegin', html);

  // Logout button — reliable direct handler, no dynamic import needed
  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('sg_player');
    window.location.href = 'index.html';
  });

  // Mobile hamburger toggle
  document.getElementById('hamburgerBtn')?.addEventListener('click', () => {
    document.getElementById('sidenav').classList.toggle('open');
  });

  return player;
}
