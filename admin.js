function $(s){return document.querySelector(s)}
function format(v){return Number(v).toFixed(2)}

async function loadOrders(){
  try {
    const res = await fetch('/api/orders');
    if(!res.ok) throw new Error('Failed to load orders');
    return res.json();
  } catch(err) {
    console.error('Failed to load orders:', err);
    return [];
  }
}

function renderOrders(list){
  const wrap = document.getElementById('orders-list');
  wrap.innerHTML = '';
  if(!list.length) { wrap.innerHTML = '<p class="small">No orders yet.</p>'; return; }
  list.reverse().forEach(o=>{
    const box = document.createElement('div');
    box.className = 'menu-item';
    box.style.marginBottom = '10px';
    box.innerHTML = `
      <div><strong>${o.id}</strong> — ${o.name} — GHC ${format(o.total)}</div>
      <div class="small">Status: ${['Received','Preparing','Out for delivery','Delivered'][o.statusIndex] || o.statusIndex}</div>
      <div class="small">Placed: ${new Date(o.created).toLocaleString()}</div>
      <div style="margin-top:8px">
        <button class="advance" data-id="${o.id}">Advance Status</button>
        <button class="set-loc" data-id="${o.id}">Set Random Location</button>
      </div>
    `;
    wrap.appendChild(box);
  });
  document.querySelectorAll('.advance').forEach(b=>b.addEventListener('click', async e=>{
    try{
      const id = e.target.dataset.id;
      const res = await fetch('/api/orders/' + id);
      if(!res.ok) throw new Error('Failed to fetch order');
      const o = await res.json();
      o.statusIndex = Math.min((o.statusIndex||0)+1,3);
      const updateRes = await fetch('/api/orders/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({statusIndex: o.statusIndex}) });
      if(!updateRes.ok) throw new Error('Failed to update status');
      refresh();
    } catch(err){ console.error('Error advancing status:', err); alert('Failed to update status'); }
  }));
  document.querySelectorAll('.set-loc').forEach(b=>b.addEventListener('click', async e=>{
    try{
      const id = e.target.dataset.id;
      const lat = 5.6037 + (Math.random()-0.5)*0.03;
      const lng = -0.1870 + (Math.random()-0.5)*0.03;
      const res = await fetch('/api/orders/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ current: {lat,lng} }) });
      if(!res.ok) throw new Error('Failed to update location');
      refresh();
    } catch(err){ console.error('Error setting location:', err); alert('Failed to update location'); }
  }));
}

async function refresh(){
  const list = await loadOrders();
  renderOrders(list);
}

// Add logout button and handler
const logoutBtn = document.createElement('button');
logoutBtn.className = 'primary';
logoutBtn.style.marginLeft = '10px';
logoutBtn.textContent = 'Logout';
logoutBtn.addEventListener('click', async ()=>{
  try{
    const res = await fetch('/admin/logout', { method:'POST' });
    if(res.ok) window.location = '/admin-login.html';
    else throw new Error('Logout failed');
  } catch(err){ console.error('Logout failed:', err); alert('Logout failed'); }
});
const header = document.querySelector('h1');
if(header) header.parentElement.insertBefore(logoutBtn, header.nextSibling);

// Socket updates
const socket = io();
socket.on('orderUpdated', (o)=>{
  refresh();
});

refresh();
