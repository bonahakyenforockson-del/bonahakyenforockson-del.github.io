const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Optional Stripe integration (test-mode). Set STRIPE_SECRET_KEY in env to enable.
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const ORDERS_FILE = path.join(__dirname, 'orders.json');
const MENU_FILE = path.join(__dirname, 'menu.json');

function readOrders(){
  try{ return JSON.parse(fs.readFileSync(ORDERS_FILE,'utf8')||'[]'); }catch(e){ return []; }
}
function writeOrders(arr){ fs.writeFileSync(ORDERS_FILE, JSON.stringify(arr, null, 2)); }

function readMenu(){
  try{ return JSON.parse(fs.readFileSync(MENU_FILE,'utf8')||'[]'); }catch(e){ return []; }
}

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Rate limiting for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
});

// session middleware for admin
app.use(session({
  secret: process.env.ADMIN_SESSION_SECRET || 'replace-with-secure-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// serve static site files
app.use(express.static(__dirname));

// Validation helper
function validateOrderInput(body){
  const errors = [];
  if(!body.name || typeof body.name !== 'string' || body.name.length < 2 || body.name.length > 100) 
    errors.push('Invalid name');
  if(!body.phone || typeof body.phone !== 'string' || body.phone.length < 7) 
    errors.push('Invalid phone');
  if(!body.addr || typeof body.addr !== 'string' || body.addr.length < 5 || body.addr.length > 500) 
    errors.push('Invalid address');
  if(!Array.isArray(body.items) || body.items.length === 0) 
    errors.push('Order must contain items');
  if(typeof body.total !== 'number' || body.total <= 0) 
    errors.push('Invalid total');
  return errors;
}

const server = http.createServer(app);
let io;
try {
  io = new Server(server, { cors: { origin: '*' } });
  io.on('connection', socket => {
    console.log('ws connected', socket.id);
    socket.on('disconnect', ()=>console.log('ws disconnected', socket.id));
  });
} catch (err) {
  console.error('Socket.IO error:', err.message);
  io = null;
}

// helper to generate tracking id
function genId(){ return 'BN' + Date.now().toString().slice(-6); }

app.get('/api/orders', (req, res) => {
  const arr = readOrders();
  res.json(arr);
});

app.get('/api/orders/:id', (req, res) => {
  const arr = readOrders();
  const o = arr.find(x => x.id === req.params.id);
  if(!o) return res.status(404).json({error:'Not found'});
  res.json(o);
});

app.post('/api/orders', apiLimiter, (req, res) => {
  const body = req.body;
  const errors = validateOrderInput(body);
  if(errors.length > 0) return res.status(400).json({error: errors.join('; ')});
  
  // Validate menu items exist and prices match
  const menu = readMenu();
  for(const item of body.items){
    const menuItem = menu.find(m => m.id === item.id);
    if(!menuItem) return res.status(400).json({error: 'Invalid menu item: ' + item.id});
    if(menuItem.price !== item.price) return res.status(400).json({error: 'Price mismatch for: ' + item.id});
  }
  
  const id = genId();
  const order = {
    id,
    name: body.name.substring(0, 100),
    phone: body.phone.substring(0, 20),
    addr: body.addr.substring(0, 500),
    items: body.items,
    total: body.total,
    created: Date.now(),
    statusIndex: 0,
    dest: body.dest || null,
    current: null,
    payment: body.payment || { method: 'cash', status: 'pending' }
  };
  const arr = readOrders();
  arr.push(order);
  writeOrders(arr);

  simulateDelivery(order.id, order.dest);
  if(io) io.emit('orderUpdated', order);
  res.json(order);
});

// Create Stripe Checkout session for an order (optional). Expects order details in body.
app.post('/api/create-checkout-session', async (req, res) => {
  if(!stripe) return res.status(500).json({error:'Stripe not configured on server.'});
  const body = req.body;
  if(!body.name || !body.phone || !body.addr || !body.items) return res.status(400).json({error:'Missing fields'});
  // create order first
  const id = genId();
  const order = { id, name: body.name, phone: body.phone, addr: body.addr, items: body.items, total: body.total || 0, created: Date.now(), statusIndex:0, dest: body.dest || null, current: null, payment: { method: 'card', status: 'pending' } };
  const arr = readOrders(); arr.push(order); writeOrders(arr);

  try{
    const line_items = body.items.map(it=>{
      const menuPrice = (it.price || 0);
      return {
        price_data: {
          currency: 'ghs',
          product_data: { name: it.name || it.id },
          unit_amount: Math.round(menuPrice * 100)
        },
        quantity: it.qty || 1
      };
    });
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      metadata: { orderId: id },
      success_url: (process.env.SUCCESS_URL || 'http://localhost:3000') + `/payment-success.html?order=${id}`,
      cancel_url: (process.env.CANCEL_URL || 'http://localhost:3000')
    });
    res.json({ url: session.url, orderId: id });
  }catch(err){
    console.error('stripe err', err);
    res.status(500).json({error:err.message});
  }
});

// Stripe webhook endpoint to mark orders paid (optional)
app.post('/webhook', bodyParser.raw({type: 'application/json'}), (req, res) => {
  if(!stripe){ res.status(400).send('stripe not configured'); return; }
  const sig = req.headers['stripe-signature'];
  let event;
  try{
    if(process.env.STRIPE_WEBHOOK_SECRET){
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = req.body; // unsafe but fallback
    }
  }catch(err){ console.error('webhook error', err); return res.status(400).send(`Webhook Error: ${err.message}`); }
  if(event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded'){
    const session = event.data.object;
    const orderId = session.metadata && session.metadata.orderId;
    if(orderId){
      const arr = readOrders();
      const idx = arr.findIndex(x=>x.id===orderId);
      if(idx>=0){ arr[idx].payment = { method:'card', status:'paid', sessionId: session.id }; arr[idx].statusIndex = Math.max(arr[idx].statusIndex, 1); writeOrders(arr); if(io) io.emit('orderUpdated', arr[idx]); }
    }
  }
  res.json({received:true});
});

app.put('/api/orders/:id', (req, res) => {
  const arr = readOrders();
  const idx = arr.findIndex(x => x.id === req.params.id);
  if(idx < 0) return res.status(404).json({error:'Not found'});
  const updated = Object.assign(arr[idx], req.body);
  arr[idx] = updated;
  writeOrders(arr);
  if(io) io.emit('orderUpdated', updated);
  res.json(updated);
});

// simple simulation: pick start near restaurant and walk to dest in steps
function simulateDelivery(trackingId, dest){
  // restaurant coordinate (example: Accra central)
  const start = {lat: 5.6037, lng: -0.1870};
  const destination = dest || {lat: start.lat + (Math.random()-0.5)*0.05, lng: start.lng + (Math.random()-0.5)*0.05};
  const steps = 6;
  const points = [];
  for(let i=0;i<=steps;i++){
    const t = i/steps;
    points.push({lat: start.lat + (destination.lat - start.lat)*t, lng: start.lng + (destination.lng - start.lng)*t});
  }

  // timers: advance status and move along points
  // status timeline (ms)
  const statusDelays = [2000, 7000, 14000];
  // update location every few seconds
  let moveIndex = 0;
  const moveInterval = setInterval(()=>{
    const arr = readOrders();
    const oIdx = arr.findIndex(x => x.id === trackingId);
    if(oIdx < 0){ clearInterval(moveInterval); return; }
    const order = arr[oIdx];
    order.current = points[Math.min(moveIndex, points.length-1)];
    writeOrders(arr);
    if(io) io.emit('orderUpdated', order);
    moveIndex++;
    if(moveIndex > points.length) clearInterval(moveInterval);
  }, 3000);

  // update status
  let st = 0;
  statusDelays.reduce((acc, delay, i) => {
    setTimeout(()=>{
      const arr = readOrders();
      const oIdx = arr.findIndex(x => x.id === trackingId);
      if(oIdx < 0) return;
      const order = arr[oIdx];
      order.statusIndex = Math.min(order.statusIndex + 1, 3);
      writeOrders(arr);
      if(io) io.emit('orderUpdated', order);
    }, acc + delay);
    return acc + delay;
  }, 0);
}

// --- admin/auth routes ---
app.get('/admin', (req, res) => {
  if(req.session && req.session.adminAuthenticated){
    res.sendFile(path.join(__dirname, 'admin.html'));
  } else {
    res.redirect('/admin-login.html');
  }
});

app.get('/admin-login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-login.html'));
});

// Serve menu.json endpoint
app.get('/menu.json', (req, res) => {
  const menu = readMenu();
  res.json(menu);
});

app.post('/admin/login', loginLimiter, async (req, res) => {
  try{
    const { user, pass } = req.body || {};
    const ADMIN_USER = process.env.ADMIN_USER || 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
    const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || null;
    if(user !== ADMIN_USER) return res.status(401).json({error:'Invalid credentials'});
    // if a hashed password is provided via env, verify with bcrypt
    if(ADMIN_PASS_HASH){
      const match = await bcrypt.compare(pass || '', ADMIN_PASS_HASH);
      if(match){ req.session.adminAuthenticated = true; return res.json({ok:true}); }
      return res.status(401).json({error:'Invalid credentials'});
    }
    // fallback to plain-text (still allowed for local/dev)
    if(pass === ADMIN_PASS){ req.session.adminAuthenticated = true; return res.json({ok:true}); }
    return res.status(401).json({error:'Invalid credentials'});
  }catch(err){
    console.error('admin login error', err);
    return res.status(500).json({error:'Server error'});
  }
});

app.post('/admin/logout', (req, res)=>{ req.session.destroy(()=>res.json({ok:true})); });

const PORT = process.env.PORT || 3000;

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at', promise, 'reason:', reason);
  process.exit(1);
});

server.listen(PORT, 'localhost', ()=>{
  console.log('Server running on port', PORT);
  console.log('Ready to accept connections...');
});

server.on('error', (err) => {
  console.error('ERROR: Server bind failed:', err.message);
  process.exit(1);
});
