const state = {
  token: localStorage.getItem('supporthub_token') || null,
  user: null,
  activeTab: 'clients',
};

const authPanel = document.getElementById('auth-panel');
const dashboardPanel = document.getElementById('dashboard-panel');
const statsEl = document.getElementById('stats');
const tabContent = document.getElementById('tab-content');
const welcome = document.getElementById('welcome');
const roleInfo = document.getElementById('role-info');

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }

  return data;
}

function setMessage(form, message, isError = false) {
  let el = form.querySelector('.msg');
  if (!el) {
    el = document.createElement('small');
    el.className = 'msg';
    form.appendChild(el);
  }
  el.textContent = message;
  el.style.color = isError ? '#fb7185' : '#14b8a6';
}

function tableForRows(rows) {
  if (!rows.length) {
    return '<p>No records yet.</p>';
  }

  const keys = Object.keys(rows[0]);
  const headers = keys.map((k) => `<th>${k}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${keys.map((key) => `<td>${String(row[key] ?? '')}</td>`).join('')}</tr>`)
    .join('');

  return `<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
}

async function loadSummary() {
  const summary = await api('/api/v1/dashboard/summary');
  statsEl.innerHTML = Object.entries(summary.totals)
    .map(
      ([label, value]) =>
        `<article class="stat"><small>${label.toUpperCase()}</small><strong>${value}</strong></article>`
    )
    .join('');
}

function formHtml(tab) {
  if (tab === 'clients') {
    return `<form id="create-clients" class="grid-2">
      <input name="name" placeholder="Client name" required />
      <input name="support_number" placeholder="Support number" />
      <button type="submit">Add Client</button>
    </form>`;
  }

  if (tab === 'agents') {
    return `<form id="create-agents" class="grid-2">
      <input name="client_id" placeholder="Client ID" required />
      <input name="full_name" placeholder="Agent full name" required />
      <input name="email" placeholder="Agent email" type="email" required />
      <input name="extension" placeholder="Extension e.g. 1001" required />
      <button type="submit">Add Agent</button>
    </form>`;
  }

  if (tab === 'calls') {
    return `<form id="create-calls" class="grid-2">
      <input name="client_id" placeholder="Client ID" required />
      <input name="agent_id" placeholder="Agent ID" />
      <input name="caller_number" placeholder="Caller number" required />
      <select name="status">
        <option>completed</option>
        <option>ringing</option>
        <option>in-progress</option>
        <option>missed</option>
      </select>
      <input name="duration_seconds" type="number" min="0" value="0" />
      <button type="submit">Log Call</button>
    </form>`;
  }

  if (tab === 'tickets') {
    return `<form id="create-tickets" class="grid-2">
      <input name="client_id" placeholder="Client ID" required />
      <input name="call_id" placeholder="Call ID" />
      <input name="subject" placeholder="Subject" required />
      <input name="description" placeholder="Description" />
      <select name="priority">
        <option>normal</option>
        <option>high</option>
        <option>urgent</option>
        <option>low</option>
      </select>
      <button type="submit">Create Ticket</button>
    </form>`;
  }

  return '';
}

function endpointByTab(tab) {
  if (tab === 'users') return '/api/v1/auth/users';
  return `/api/v1/${tab}`;
}

function payloadByTab(tab, form) {
  const data = Object.fromEntries(new FormData(form));

  if (tab === 'calls') {
    data.direction = 'inbound';
  }

  if (data.client_id) data.client_id = Number(data.client_id);
  if (data.agent_id) data.agent_id = Number(data.agent_id);
  if (data.call_id) data.call_id = Number(data.call_id);
  if (data.duration_seconds) data.duration_seconds = Number(data.duration_seconds);

  Object.keys(data).forEach((key) => {
    if (data[key] === '') {
      delete data[key];
    }
  });

  return data;
}

async function renderTab(tab = state.activeTab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  let rows = [];
  try {
    rows = await api(endpointByTab(tab));
  } catch (error) {
    tabContent.innerHTML = `<p>${error.message}</p>`;
    return;
  }

  tabContent.innerHTML = `${formHtml(tab)}${tableForRows(rows)}`;

  const form = tabContent.querySelector('form');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api(endpointByTab(tab), {
          method: 'POST',
          body: JSON.stringify(payloadByTab(tab, form)),
        });
        form.reset();
        await loadSummary();
        await renderTab(tab);
      } catch (error) {
        setMessage(form, error.message, true);
      }
    });
  }
}

async function showDashboard() {
  authPanel.classList.add('hidden');
  dashboardPanel.classList.remove('hidden');

  const me = await api('/api/v1/auth/me');
  state.user = me;
  welcome.textContent = `Welcome, ${me.full_name}`;
  roleInfo.textContent = `Role: ${me.role} | Client ID: ${me.client_id ?? 'N/A'} | Agent ID: ${me.agent_id ?? 'N/A'}`;

  await loadSummary();
  await renderTab(state.activeTab);
}

async function attemptResume() {
  if (!state.token) {
    return;
  }

  try {
    await showDashboard();
  } catch (error) {
    localStorage.removeItem('supporthub_token');
    state.token = null;
  }
}

document.getElementById('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    await api('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ ...data, role: 'admin' }),
    });
    setMessage(form, 'Bootstrap admin created. You can now login.');
    form.reset();
  } catch (error) {
    setMessage(form, error.message, true);
  }
});

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    const response = await api('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    state.token = response.token;
    localStorage.setItem('supporthub_token', state.token);
    form.reset();
    await showDashboard();
  } catch (error) {
    setMessage(form, error.message, true);
  }
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    renderTab(btn.dataset.tab);
  });
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await api('/api/v1/auth/logout', { method: 'POST' });
  } catch (error) {
    // ignore logout errors when session already invalid
  }
  state.token = null;
  state.user = null;
  localStorage.removeItem('supporthub_token');
  dashboardPanel.classList.add('hidden');
  authPanel.classList.remove('hidden');
});

attemptResume();
