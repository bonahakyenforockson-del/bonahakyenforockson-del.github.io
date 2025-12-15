// Simple single-page ordering + backend-powered delivery tracking
// NOTE: This frontend expects the backend server (server.js) to be running
// and serving the API at the same origin. Socket.IO client is used for real-time updates.
let menu = [];
let cart = {};
let socket;
let trackMap = null;
let trackMarker = null;
let trackPolyline = null;
const API_BASE = '';

// Load menu from server
async function loadMenu(){
  try {
    const res = await fetch('/menu.json');
    if(res.ok) menu = await res.json();
    else menu = [];
  } catch(e) {
    console.error('Failed to load menu:', e);
    menu = [];
  }
}

function $(s){return document.querySelector(s)}
function $all(s){return Array.from(document.querySelectorAll(s))}

function format(val){return Number(val).toFixed(2)}

// Validation helpers
function isValidPhone(phone){
  return /^[\d\s\-\+\(\)]{7,}$/.test(phone.replace(/\s/g,''));
}

function isValidName(name){
  return name.length >= 2 && name.length <= 100;
}

function isValidAddress(addr){
  return addr.length >= 5 && addr.length <= 500;
}

// Render menu
function renderMenu(){
  const el = $('#menu-list');
  el.innerHTML = '';
  menu.forEach(it => {
    const card = document.createElement('div');
    card.className = 'menu-item';
    card.innerHTML = `
      <h3>${it.name}</h3>
      <p>${it.desc}</p>
      <div class="meta"><strong>GHC ${format(it.price)}</strong><button data-id="${it.id}">Add</button></div>
    `;
    el.appendChild(card);
  });
  // Add handlers
  $all('.menu-item button').forEach(btn => btn.addEventListener('click', e => addToCart(e.target.dataset.id)));
}

function addToCart(id){
  cart[id] = cart[id] ? cart[id] + 1 : 1;
  renderCart();
}

function removeFromCart(id){
  delete cart[id];
  renderCart();
}

function changeQty(id, delta){
  cart[id] = (cart[id]||0) + delta;
  if(cart[id] <= 0) delete cart[id];
  renderCart();
}

function renderCart(){
  const wrap = $('#cart-items');
  wrap.innerHTML = '';
  const keys = Object.keys(cart);
  let total = 0;
  if(keys.length === 0){
    wrap.innerHTML = '<p class="small">Your cart is empty. Add items from the menu.</p>';
  }
  keys.forEach(id => {
    const item = menu.find(m=>m.id===id);
    const qty = cart[id];
    const row = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `
      <div>
        <div><strong>${item.name}</strong></div>
        <div class="small">GHC ${format(item.price)} × ${qty}</div>
      </div>
      <div>
        <button onclick="changeQty('${id}',-1)">-</button>
        <button onclick="changeQty('${id}',1)">+</button>
        <button onclick="removeFromCart('${id}')">Remove</button>
      </div>
    `;
    wrap.appendChild(row);
    total += item.price * qty;
  });
  $('#cart-total').textContent = format(total);
  $('#cart-count').textContent = keys.reduce((s,k)=>s+cart[k],0);
}

// Modal helpers
function openModal(html){
  $('#modal-body').innerHTML = html;
  const modal = $('#modal');
  modal.setAttribute('aria-hidden','false');
}
function closeModal(){
  $('#modal').setAttribute('aria-hidden','true');
}

// Checkout flow
function checkout(){
  if(Object.keys(cart).length === 0){ alert('Cart is empty'); return; }
  const html = `
    <h3>Checkout</h3>
    <div class="form-row"><label for="c-name">Name</label><input id="c-name" required aria-label="Name"></div>
    <div class="form-row"><label for="c-phone">Phone</label><input id="c-phone" required aria-label="Phone"></div>
    <div class="form-row"><label for="c-addr">Delivery Address</label><textarea id="c-addr" rows="3" required aria-label="Delivery Address"></textarea></div>
    <div class="form-row"><label>Approx delivery location (optional)</label>
      <div style="display:flex;gap:8px"><input id="c-lat" placeholder="lat (e.g. 5.60)" aria-label="Latitude" /><input id="c-lng" placeholder="lng (e.g. -0.18)" aria-label="Longitude" /></div>
    </div>
    <div class="form-row"><label for="c-pay">Payment method</label>
      <select id="c-pay"><option value="cash">Cash on delivery</option><option value="card">Card (Simulate)</option></select></div>
    <!-- Simulated payment form (hidden until card chosen) -->
    <div id="payment-form" style="display:none; margin-top:8px">
      <div class="form-row"><label for="card-number">Card number (simulated)</label><input id="card-number" placeholder="4242 4242 4242 4242" aria-label="Card number" /></div>
      <div class="form-row" style="display:flex;gap:8px"><input id="card-exp" placeholder="MM/YY" aria-label="Expiry" /><input id="card-cvc" placeholder="CVC" aria-label="CVC" /></div>
      <div class="form-row"><button id="pay-now" class="primary">Complete Payment (Simulate)</button></div>
    </div>
    <div class="form-row"><button id="place-order" class="primary">Place Order (Cash)</button></div>
  `;
  openModal(html);
  // show/hide payment form when payment method changes
  $('#c-pay').addEventListener('change', (e)=>{
    if(e.target.value === 'card') $('#payment-form').style.display = 'block'; else $('#payment-form').style.display = 'none';
  });
  $('#place-order').addEventListener('click', ()=>placeOrder(false));
  $('#pay-now') && $('#pay-now').addEventListener('click', ()=>placeOrder(true));
}

async function placeOrder(simulatePayment = false){
  const name = $('#c-name').value.trim();
  const phone = $('#c-phone').value.trim();
  const addr = $('#c-addr').value.trim();
  const lat = parseFloat($('#c-lat').value) || null;
  const lng = parseFloat($('#c-lng').value) || null;
  
  // Validate inputs
  if(!isValidName(name)){ alert('Name must be 2-100 characters'); return; }
  if(!isValidPhone(phone)){ alert('Please enter a valid phone number'); return; }
  if(!isValidAddress(addr)){ alert('Address must be 5-500 characters'); return; }

  const items = Object.keys(cart).map(id=>{
    const m = menu.find(x=>x.id===id);
    if(!m){ alert('Invalid menu item: ' + id); throw new Error('Invalid item'); }
    return { id, qty: cart[id], name: m.name, price: m.price };
  });
  
  const total = Number($('#cart-total').textContent);
  if(total <= 0){ alert('Cart is empty or invalid'); return; }
  
  const body = { name, phone, addr, items, total };
  if(!isNaN(lat) && !isNaN(lng)) body.dest = {lat, lng};

  try{
    const paySelect = $('#c-pay') ? $('#c-pay').value : 'cash';

    // If card was chosen and this is not a local "simulate" click, try Stripe Checkout endpoint
    if(paySelect === 'card' && !simulatePayment){
      body.payment = { method: 'card', status: 'pending' };
      const resp = await fetch(API_BASE + '/api/create-checkout-session', { method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)});
      if(!resp.ok) throw new Error('Failed to create checkout session');
      const data = await resp.json();
      const url = data.url || data.sessionUrl || data.checkoutUrl;
      if(!url) throw new Error('No checkout URL returned');
      window.location = url;
      return;
    }

    // if simulatePayment true, mark as paid and set payment method
    if(simulatePayment){ body.payment = { method: 'card', status: 'paid', details: { card: $('#card-number') ? $('#card-number').value.trim() : '' } }; }
    else { body.payment = { method: 'cash', status: 'pending' }; }

    const resp = await fetch(API_BASE + '/api/orders', { method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)});
    if(!resp.ok) throw new Error('Failed to place order');
    const order = await resp.json();
    
    // Calculate ETA (30 min base + location-based estimate)
    const etaMinutes = 30 + (body.dest ? 15 : 0);
    const etaTime = new Date();
    etaTime.setMinutes(etaTime.getMinutes() + etaMinutes);
    
    // clear cart
    cart = {};
    renderCart();

    const html = `
      <h3>Order Placed</h3>
      <p class="status">Thank you ${order.name}! Your order has been placed. Tracking ID: <strong>${order.id}</strong></p>
      <p><strong>Estimated delivery:</strong> ${etaTime.toLocaleTimeString()} (${etaMinutes} min)</p>
      <p>Use the tracking ID to trace delivery or click below to track now.</p>
      <div style="margin-top:12px"><button id="track-now" class="primary">Track Now</button></div>
    `;
    openModal(html);
    $('#track-now').addEventListener('click', ()=>{ showTracking(order.id) });
  }catch(err){
    alert('Order failed: ' + err.message);
  }
}

// backend-backed helpers
async function fetchOrder(id){
  const resp = await fetch(API_BASE + '/api/orders/' + id);
  if(!resp.ok) return null;
  return resp.json();
}

// Show tracking UI
function showTracking(id){
  const html = `
    <h3>Track Order</h3>
    <div class="form-row"><label>Enter Tracking ID</label><input id="t-id" value="${id||''}" placeholder="e.g. BN123456" aria-label="tracking id"></div>
    <div class="form-row"><button id="t-go" class="primary">Track</button></div>
    <div id="t-result"></div>
  `;
  openModal(html);
  // show map container
  $('#track-map').style.display = 'block';
  $('#t-go').addEventListener('click', ()=>{
    const tid = $('#t-id').value.trim();
    if(!tid) return alert('Enter tracking id');
    displayTrackingResult(tid);
  });
  if(id) displayTrackingResult(id);
}

function displayTrackingResult(tid){
  const target = $('#t-result');
  fetchOrder(tid).then(o=>{
    if(!o){ target.innerHTML = `<p class="small">No order found with ID <strong>${tid}</strong>.</p>`; return; }
    const steps = ['Received','Preparing','Out for delivery','Delivered'];
    let html = `<p><strong>Order ${o.id}</strong> — ${o.name} — GHC ${format(o.total)}</p>`;
    html += `<div class="tracking-steps">`;
    for(let i=0;i<steps.length;i++){
      const active = i<=o.statusIndex ? 'step active' : 'step';
      html += `<div class="${active}">${steps[i]}</div>`;
    }
    html += `</div>`;
    html += `<p class="small">Placed: ${new Date(o.created).toLocaleString()}</p>`;
    // add ETA placeholder
    html += `<div id="eta" class="small" style="margin-top:8px"></div>`;
    target.innerHTML = html;
    // update map marker if coordinates exist
    if(o.current && o.current.lat && o.current.lng){
      showOnMap([o.current.lat, o.current.lng], o);
    }
  }).catch(err=>{ target.innerHTML = `<p class="small">Error fetching order.</p>`; });
}

function distanceMeters(a, b){
  const toRad = v => v * Math.PI / 180;
  const lat1 = a[0], lon1 = a[1], lat2 = b[0], lon2 = b[1];
  const R = 6371000;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const rad1 = toRad(lat1);
  const rad2 = toRad(lat2);
  const x = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(rad1)*Math.cos(rad2)*Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  return R * c;
}

function animateMarkerTo(marker, toLatLng, duration = 1200){
  if(!marker) return marker = L.marker(toLatLng).addTo(trackMap);
  const from = marker.getLatLng();
  const start = performance.now();
  const dest = L.latLng(toLatLng[0], toLatLng[1]);
  function step(now){
    const t = Math.min(1, (now - start) / duration);
    const lat = from.lat + (dest.lat - from.lat) * t;
    const lng = from.lng + (dest.lng - from.lng) * t;
    marker.setLatLng([lat, lng]);
    if(t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function showOnMap(latlng, order){
  // initialize map if needed
  if(!trackMap){
    trackMap = L.map('track-map').setView(latlng, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(trackMap);
  }

  // draw route polyline from restaurant start to destination (if available)
  const rest = [5.6037, -0.1870];
  const dest = order.dest && order.dest.lat && order.dest.lng ? [order.dest.lat, order.dest.lng] : null;
  if(dest){
    const route = [rest, dest];
    if(trackPolyline){ trackPolyline.setLatLngs(route); }
    else { trackPolyline = L.polyline(route, { color: '#2b8cff', weight: 4, opacity: 0.7 }).addTo(trackMap); }
    // fit bounds to show both
    const bounds = L.latLngBounds(route);
    trackMap.fitBounds(bounds.pad(0.25));
  }

  if(!trackMarker){
    trackMarker = L.marker(latlng).addTo(trackMap);
  } else {
    // animate marker smoothly to new position
    animateMarkerTo(trackMarker, latlng, 1000);
  }

  // estimate ETA and show in UI
  const etaEl = document.getElementById('eta');
  if(etaEl){
    const remaining = dest ? distanceMeters(latlng, dest) : 0;
    // assume average speed 10 m/s (~36 km/h) for estimate
    const secs = Math.max(0, Math.round(remaining / 10));
    const mins = Math.floor(secs / 60);
    const secRem = secs % 60;
    etaEl.textContent = dest ? `Approx. ${mins}m ${secRem}s to destination` : 'Location available';
  }
}

// Event wiring
document.addEventListener('DOMContentLoaded', async ()=>{
  await loadMenu();
  renderMenu();
  renderCart();
  $('#checkout-btn').addEventListener('click', checkout);
  $('#view-cart').addEventListener('click', ()=>{ window.scrollTo({top:document.querySelector('.cart').offsetTop, behavior:'smooth'})});
  $('#view-track').addEventListener('click', ()=>showTracking());
  $('#modal-close').addEventListener('click', closeModal);
  // close modal when clicking backdrop
  $('#modal').addEventListener('click', (e)=>{ if(e.target.id === 'modal') closeModal(); });
  // connect socket.io for real-time updates
  try{
    socket = io();
    socket.on('connect', ()=>console.log('socket connected'));
    socket.on('orderUpdated', (order)=>{
      // if modal open and tracking that order, refresh view
      const tid = $('#t-id') ? $('#t-id').value.trim() : null;
      if(tid && order.id === tid){
        displayTrackingResult(tid);
      }
    });
  }catch(e){ console.warn('socket.io not available', e); }
});
