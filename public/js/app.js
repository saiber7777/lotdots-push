/* Blossom Rock Crew App — main client logic. */
const me = requireLogin();
let META = { areas: [], categories: [], statuses: [] };
let properties = [];
let currentProp = null;
let map = null;
let markers = [];
let pendingLatLng = null;
let allItems = [];
let meMarker = null;
let users = [];

const $ = (id) => document.getElementById(id);

function showMsg(html, kind = 'error') {
  $('msg').innerHTML = html ? `<div class="${kind}">${html}</div>` : '';
  if (html) setTimeout(() => { $('msg').innerHTML = ''; }, 5000);
}

async function boot() {
  $('who').innerHTML = `${esc(me.name || me.email)}<br>${esc(me.role)}`;
  $('logoutBtn').onclick = logout;

  META = await api('/api/meta');
  $('fArea').innerHTML = META.areas.map(a => `<option>${esc(a)}</option>`).join('');
  $('fCat').innerHTML = META.categories.map(c => `<option>${esc(c)}</option>`).join('');

  properties = (await api('/api/properties')).properties;
  if (!properties.length) {
    showMsg('No properties yet. An admin needs to add one under Team &amp; properties.');
  }
  $('propSel').innerHTML = properties.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('propSel').onchange = () => { currentProp = properties.find(p => p.id == $('propSel').value); refreshAll(); };
  currentProp = properties[0] || null;

  if (me.role === 'admin') {
    $('teamTab').style.display = '';
    loadUsers();
  } else {
    $('newOrderCard').style.display = (me.role === 'supervisor') ? '' : 'none';
  }

  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      ['map', 'list', 'orders', 'team'].forEach(k => { $('tab-' + k).style.display = (k === t.dataset.tab) ? '' : 'none'; });
      if (t.dataset.tab === 'map' && map) setTimeout(() => map.invalidateSize(), 50);
      if (t.dataset.tab === 'list') loadItems();
      if (t.dataset.tab === 'orders') loadOrders();
    };
  });

  $('statusFilter').onchange = loadItems;
  $('pinCancel').onclick = () => { $('pinFormCard').style.display = 'none'; pendingLatLng = null; };
  $('pinForm').onsubmit = savePin;
  $('userForm').onsubmit = createUser;
  $('propForm').onsubmit = createProperty;
  $('woCreate').onclick = createWorkOrder;

  initMap();
  await refreshAll();
}

async function refreshAll() {
  if (!currentProp) return;
  await loadItems();
  drawMarkers();
}

async function loadItems() {
  if (!currentProp) return;
  const st = $('statusFilter').value;
  const q = `?property_id=${currentProp.id}${st ? '&status=' + st : ''}`;
  allItems = (await api('/api/items' + q)).items;
  $('listCount').textContent = `${allItems.length} item${allItems.length === 1 ? '' : 's'}`;
  renderItems();
  drawMarkers();
}

/* ---------------- Map ---------------- */
function initMap() {
  map = L.map('map').setView([33.4123, -111.5496], 15);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Imagery &copy; Esri',
    maxZoom: 19,
  }).addTo(map);
  map.on('click', (e) => {
    pendingLatLng = e.latlng;
    $('pinCoords').textContent = `(${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)})`;
    $('pinFormCard').style.display = '';
    $('pinFormCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  // Locate-me button (top-right of the map)
  const locateCtrl = L.control({ position: 'topright' });
  locateCtrl.onAdd = function () {
    const btn = L.DomUtil.create('button', 'locate-btn');
    btn.type = 'button';
    btn.title = 'Locate me';
    btn.setAttribute('aria-label', 'Locate me');
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b2d63" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6" fill="#3b2d63" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg>';
    L.DomEvent.on(btn, 'click', (ev) => {
      L.DomEvent.stopPropagation(ev);
      btn.classList.add('locating');
      map.locate({ setView: true, maxZoom: 17, timeout: 15000 });
    });
    L.DomEvent.disableClickPropagation(btn);
    return btn;
  };
  locateCtrl.addTo(map);
  map.on('locationfound', (e) => {
    document.querySelectorAll('.locate-btn').forEach(b => b.classList.remove('locating'));
    if (meMarker) map.removeLayer(meMarker);
    meMarker = L.circleMarker(e.latlng, { radius: 9, weight: 3, color: '#ffffff', fillColor: '#1d4ed8', fillOpacity: 1 }).addTo(map);
    meMarker.bindPopup('You are here').openPopup();
  });
  map.on('locationerror', () => {
    document.querySelectorAll('.locate-btn').forEach(b => b.classList.remove('locating'));
    showMsg('Could not get your location. Allow location access for this site, then try again.');
  });
  if (currentProp) map.setView([currentProp.center_lat, currentProp.center_lng], currentProp.default_zoom);
}

function pinIcon(item) {
  return L.divIcon({
    className: '',
    html: `<div class="pin-badge ${item.status}">${item.pin_number}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function drawMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  allItems.forEach(it => {
    const mk = L.marker([it.lat, it.lng], { icon: pinIcon(it) }).addTo(map);
    mk.bindPopup(`<strong>#${it.pin_number} ${esc(it.category)}</strong><br>${esc(it.area)}<br>${esc(it.notes || '')}<br>${statusPill(it.status)}`);
    markers.push(mk);
  });
  if (currentProp && !markers.length) map.setView([currentProp.center_lat, currentProp.center_lng], currentProp.default_zoom);
}

async function savePin(e) {
  e.preventDefault();
  if (!pendingLatLng || !currentProp) return;
  const err = $('pinErr');
  err.innerHTML = '';
  try {
    const fd = new FormData();
    fd.append('property_id', currentProp.id);
    fd.append('area', $('fArea').value);
    fd.append('category', $('fCat').value);
    fd.append('notes', $('fNotes').value);
    fd.append('lat', pendingLatLng.lat);
    fd.append('lng', pendingLatLng.lng);
    const f = $('fPhoto').files[0];
    if (f) fd.append('photo', f);
    const { item } = await api('/api/items', { method: 'POST', body: fd });
    $('pinForm').reset();
    $('pinFormCard').style.display = 'none';
    pendingLatLng = null;
    showMsg(`Pin #${item.pin_number} saved.`, 'success');
    await loadItems();
  } catch (ex) {
    err.innerHTML = `<div class="error">${esc(ex.message)}</div>`;
  }
}

/* ---------------- Work list ---------------- */
function renderItems() {
  const box = $('items');
  if (!allItems.length) { box.innerHTML = '<p class="hint">No work items yet. Drop a pin on the map to add one.</p>'; return; }
  box.innerHTML = allItems.map(it => `
    <div class="item">
      ${it.photo_path ? `<img class="thumb" src="${esc(it.photo_path)}" alt="">` : `<div class="thumb" style="display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:0.7rem">no photo</div>`}
      <div class="meta">
        <div class="title">#${it.pin_number} — ${esc(it.category)} ${statusPill(it.status)}</div>
        <div class="sub">${esc(it.area || 'No area')} · ${esc(it.property_name)}</div>
        <div class="sub">${esc(it.notes || '')}</div>
        <div class="sub">Added ${fmtDate(it.created_at)}${it.assigned_name ? ` · Assigned to ${esc(it.assigned_name)}` : ''}${it.completed_at ? ` · Done ${fmtDate(it.completed_at)}` : ''}</div>
        ${it.proof_photo_path ? `<div class="sub"><a href="${esc(it.proof_photo_path)}" target="_blank">View completion photo</a></div>` : ''}
      </div>
      <div class="actions">${itemActions(it)}</div>
    </div>`).join('');

  box.querySelectorAll('[data-act]').forEach(btn => {
    btn.onclick = () => itemAction(btn.dataset.act, Number(btn.dataset.id));
  });
}

function itemActions(it) {
  const canSup = ['admin', 'supervisor'].includes(me.role);
  let h = '';
  if (it.status === 'open' && canSup) h += `<button class="btn small" data-act="assign" data-id="${it.id}">Assign</button>`;
  if (it.status === 'assigned' && (canSup || true)) {
    h += `<button class="btn small yellow" data-act="complete" data-id="${it.id}">Mark done + photo</button>`;
  }
  if (canSup && it.status !== 'open') h += `<button class="btn small ghost" data-act="reopen" data-id="${it.id}">Reopen</button>`;
  if (canSup) h += `<button class="btn small danger" data-act="del" data-id="${it.id}">Delete</button>`;
  return h || '<span class="hint">—</span>';
}

async function itemAction(act, id) {
  try {
    if (act === 'assign') {
      const list = users.length ? users : (await api('/api/users')).users;
      const name = prompt('Assign to (type crew member name):\n' + list.map(u => `- ${u.name} (${u.role})`).join('\n'));
      if (!name) return;
      const u = list.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!u) { showMsg('No team member with that name.'); return; }
      await api(`/api/items/${id}`, { method: 'PATCH', body: { assigned_to: u.id, status: 'assigned' } });
    } else if (act === 'complete') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = async () => {
        if (!input.files[0]) return;
        const fd = new FormData();
        fd.append('proof', input.files[0]);
        await api(`/api/items/${id}/complete`, { method: 'POST', body: fd });
        showMsg('Marked done with photo proof.', 'success');
        await loadItems();
      };
      input.click();
      return;
    } else if (act === 'reopen') {
      if (me.role !== 'admin') { showMsg('Only admins can reopen items.'); return; }
      await api(`/api/items/${id}`, { method: 'PATCH', body: { status: 'open', assigned_to: null } });
    } else if (act === 'del') {
      if (!confirm('Delete this item?')) return;
      await api(`/api/items/${id}`, { method: 'DELETE' });
    }
    await loadItems();
  } catch (ex) { showMsg(esc(ex.message)); }
}

/* ---------------- Work orders ---------------- */
async function loadOrders() {
  if (!currentProp) return;
  const open = allItems.filter(i => i.status !== 'done');
  $('woPick').innerHTML = open.length
    ? open.map(i => `<label style="display:block;margin:6px 0"><input type="checkbox" class="woChk" value="${i.id}" checked> #${i.pin_number} — ${esc(i.category)} (${esc(i.area || 'no area')})</label>`).join('')
    : '<p class="hint">No open items to include.</p>';
  const orders = (await api(`/api/workorders?property_id=${currentProp.id}`)).work_orders;
  $('orders').innerHTML = orders.length
    ? `<table class="plain"><tr><th>Title</th><th>Items</th><th>Created</th><th></th></tr>${orders.map(o =>
      `<tr><td>${esc(o.title)}</td><td>${JSON.parse(o.item_ids || '[]').length}</td><td>${fmtDate(o.created_at)}</td><td><a href="/workorder.html?id=${o.id}" target="_blank">Open</a></td></tr>`).join('')}</table>`
    : '<p class="hint">No work orders yet.</p>';
}

async function createWorkOrder() {
  const ids = [...document.querySelectorAll('.woChk:checked')].map(c => Number(c.value));
  if (!ids.length) { showMsg('Check at least one item.'); return; }
  try {
    const { work_order } = await api('/api/workorders', {
      method: 'POST',
      body: { property_id: currentProp.id, title: $('woTitle').value, item_ids: ids },
    });
    window.open(`/workorder.html?id=${work_order.id}`, '_blank');
    loadOrders();
  } catch (ex) { showMsg(esc(ex.message)); }
}

/* ---------------- Team & properties (admin) ---------------- */
async function loadUsers() {
  users = (await api('/api/users')).users;
  $('users').innerHTML = `<table class="plain"><tr><th>Name</th><th>Email</th><th>Role</th></tr>${users.map(u =>
    `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td></tr>`).join('')}</table>`;
}

async function createUser(e) {
  e.preventDefault();
  const err = $('userErr');
  err.innerHTML = '';
  try {
    await api('/api/users', {
      method: 'POST',
      body: { name: $('uName').value, email: $('uEmail').value, password: $('uPass').value, role: $('uRole').value },
    });
    $('userForm').reset();
    showMsg('Account created.', 'success');
    loadUsers();
  } catch (ex) { err.innerHTML = `<div class="error">${esc(ex.message)}</div>`; }
}

async function createProperty(e) {
  e.preventDefault();
  try {
    const { property } = await api('/api/properties', {
      method: 'POST',
      body: { name: $('pName').value, city: $('pCity').value, state: $('pState').value },
    });
    properties.push(property);
    $('propSel').innerHTML = properties.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    $('propForm').reset();
    showMsg(`Property "${esc(property.name)}" added.`, 'success');
  } catch (ex) { showMsg(esc(ex.message)); }
}

boot().catch(ex => showMsg(esc(ex.message)));
