// 2026 World Cup Prediction App - Client-Side Logic

const flagMap = {
  // Grupo A
  'Mexico': '🇲🇽', 'Sudafrica': '🇿🇦', 'Corea del Sur': '🇰🇷', 'Chequia': '🇨🇿',
  // Grupo B
  'Canada': '🇨🇦', 'Bosnia y Herzegovina': '🇧🇦', 'Catar': '🇶🇦', 'Suiza': '🇨🇭',
  // Grupo C
  'Brasil': '🇧🇷', 'Marruecos': '🇲🇦', 'Haiti': '🇭🇹', 'Escocia': '🏴',
  // Grupo D
  'Estados Unidos': '🇺🇸', 'Paraguay': '🇵🇾', 'Australia': '🇦🇺', 'Turquia': '🇹🇷',
  // Grupo E
  'Alemania': '🇩🇪', 'Curazao': '🇨🇼', 'Costa de Marfil': '🇨🇮', 'Ecuador': '🇪🇨',
  // Grupo F
  'Paises Bajos': '🇳🇱', 'Japon': '🇯🇵', 'Suecia': '🇸🇪', 'Tunez': '🇹🇳',
  // Grupo G
  'Belgica': '🇧🇪', 'Egipto': '🇪🇬', 'Iran': '🇮🇷', 'Nueva Zelanda': '🇳🇿',
  // Grupo H
  'Espania': '🇪🇸', 'Cabo Verde': '🇨🇻', 'Arabia Saudita': '🇸🇦', 'Uruguay': '🇺🇾',
  // Grupo I
  'Francia': '🇫🇷', 'Senegal': '🇸🇳', 'Irak': '🇮🇶', 'Noruega': '🇳🇴',
  // Grupo J
  'Argentina': '🇦🇷', 'Argelia': '🇩🇿', 'Austria': '🇦🇹', 'Jordania': '🇯🇴',
  // Grupo K
  'Portugal': '🇵🇹', 'Republica Democratica del Congo': '🇨🇩', 'Uzbekistan': '🇺🇿', 'Colombia': '🇨🇴',
  // Grupo L
  'Inglaterra': '🏴', 'Croacia': '🇭🇷', 'Ghana': '🇬🇭', 'Panama': '🇵🇦'
};

function getFlag(team) {
  if (!team) return '🏳️';
  return flagMap[team] || '🏳️';
}

// Authentication Check
function getSession() {
  const userStr = localStorage.getItem('user');
  const code = localStorage.getItem('access_code');
  if (!userStr || !code) return null;
  return {
    user: JSON.parse(userStr),
    access_code: code
  };
}

function setSession(user, accessCode) {
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('access_code', accessCode);
}

function clearSession() {
  localStorage.removeItem('user');
  localStorage.removeItem('access_code');
  window.location.href = '/login.html';
}

// Check auth on page load
function checkAuth() {
  const session = getSession();
  const currentPath = window.location.pathname;
  const isAuthPage = currentPath.endsWith('login.html') || currentPath.endsWith('register.html');

  if (!session && !isAuthPage) {
    window.location.href = '/login.html';
    return false;
  }
  
  if (session && isAuthPage) {
    window.location.href = '/index.html';
    return false;
  }

  // Admin route check
  if (currentPath.endsWith('admin.html')) {
    if (!session || (!session.user.is_admin && session.user.username !== 'prisma')) {
      window.location.href = '/index.html';
      return false;
    }
  }

  return true;
}

// API Fetch helper
async function apiFetch(endpoint, method = 'GET', body = null) {
  const session = getSession();
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (session) {
    headers['x-username'] = session.user.username;
    headers['x-access-code'] = session.access_code;
  }

  const config = { method, headers };
  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(endpoint, config);
  if (response.status === 401) {
    // Session expired or invalid
    clearSession();
    throw new Error('Sesión expirada');
  }
  
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Error en la petición');
  }
  return data;
}

// Toast Alert
function showToast(message, isError = false) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  
  toast.textContent = message;
  if (isError) {
    toast.classList.add('error');
  } else {
    toast.classList.remove('error');
  }
  
  toast.classList.add('active');
  
  setTimeout(() => {
    toast.classList.remove('active');
  }, 3000);
}

// Render dynamic header navigation
function renderHeader() {
  const headerEl = document.querySelector('header');
  if (!headerEl) return;

  const session = getSession();
  if (!session) return;

  const currentPath = window.location.pathname;
  const isAdmin = session.user.is_admin || session.user.username === 'prisma';

  headerEl.innerHTML = `
    <div class="nav-container">
      <a href="/index.html" class="logo">
        <span>🏆</span> Mundial 2026
      </a>
      <nav>
        <a href="/index.html" class="${currentPath.endsWith('index.html') || currentPath === '/' ? 'active' : ''}">
          📅 Partidos
        </a>
        <a href="/ranking.html" class="${currentPath.endsWith('ranking.html') ? 'active' : ''}">
          📊 Posiciones
        </a>
        <a href="/especiales.html" class="${currentPath.endsWith('especiales.html') ? 'active' : ''}">
          ⭐ Especiales
        </a>
        ${isAdmin ? `
          <a href="/admin.html" class="${currentPath.endsWith('admin.html') ? 'active' : ''}">
            ⚙️ Admin
          </a>
        ` : ''}
      </nav>
      <div style="display: flex; align-items: center; gap: 1rem;">
        <div id="header-clock" class="header-clock" style="font-weight: 600; color: var(--accent-gold); font-size: 0.9rem;"></div>
        <div class="user-badge" onclick="window.location.href='/profile.html'" style="cursor:pointer;">
          <img src="${session.user.team_crest}" alt="Escudo">
          <div class="team-info">
            <span class="username">${session.user.fullname}</span>
            <span class="points">${session.user.team_name}</span>
          </div>
        </div>
        <button onclick="clearSession()" class="btn-logout" title="Cerrar sesión">
          🚪 <span style="display: inline-block;">Salir</span>
        </button>
      </div>
    </div>
  `;
  updateClock();
}

// Format ISO date to display nicely (Spanish local format - Madrid timezone)
function formatMatchDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  }) + ' hs';
}

// Clock update function (Madrid timezone)
function updateClock() {
  const clockEl = document.getElementById('header-clock');
  if (!clockEl) return;
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Madrid'
  }) + ' (Madrid)';
}

// Update clock every second
setInterval(updateClock, 1000);

// Global initialization
document.addEventListener('DOMContentLoaded', () => {
  if (checkAuth()) {
    renderHeader();
  }
});
