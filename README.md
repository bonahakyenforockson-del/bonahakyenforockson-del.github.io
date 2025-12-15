# Barima Nkwan — Demo Backend + Frontend

This folder contains a demo restaurant ordering site (`index.html`, `script.js`, `styles.css`) and a Node/Express backend (`server.js`) with real-time updates (Socket.IO), simple file-based persistence (`orders.json`), and optional Stripe Checkout integration.

## Recent Improvements

✅ **Security Enhancements**

- Added `helmet` for HTTP header hardening
- Implemented rate limiting on login (5 attempts per 15 minutes) and API endpoints
- Added input validation and sanitization for all order data
- Added `.env` support with `dotenv`

✅ **Code Quality**

- Fixed `async` error in admin.js
- Added comprehensive error handling with try-catch blocks
- Extracted menu to `menu.json` for better separation of concerns
- Improved admin dashboard with logout button

✅ **User Experience**

- Added phone number validation (format checks)
- Added estimated delivery time (ETA) on order confirmation
- Enhanced checkout form with better validation messages
- Improved error feedback throughout the app

✅ **Data Validation**

- Server validates menu items exist and prices match
- Validates name (2-100 chars), phone (7+ chars), address (5-500 chars)
- Prevents negative/invalid totals

## Quick start (local development)

1. Install dependencies

```powershell
cd 'c:\Users\Orlando\OneDrive\Desktop\barima_nkwan'
npm install
```

2. Set up environment (optional)

```powershell
Copy-Item .env.example -Destination .env
# Edit .env with your configuration
```

3. Run the server

```powershell
npm start
```

The app will be available at `http://localhost:3000/` by default.

## Environment variables

See `.env.example` for a complete reference. Key variables:

- `PORT` — server port (default `3000`)
- `ADMIN_USER` — admin username (default `admin`)
- `ADMIN_PASS` — admin password (default `password`) for dev only
- `ADMIN_PASS_HASH` — (optional) bcrypt-hashed admin password
- `ADMIN_SESSION_SECRET` — session secret for express-session (required for production)
- `NODE_ENV` — set to `production` to enable secure session cookies
- `STRIPE_SECRET_KEY` — enable Stripe Checkout (test key allowed)
- `STRIPE_WEBHOOK_SECRET` — webhook signing secret for Stripe

## Notes

- The menu is defined in `menu.json` and loaded by both server and client
- Orders are persisted to `orders.json` (use a real database for production)
- Admin authentication supports bcrypt-hashed passwords via `ADMIN_PASS_HASH`
- Login attempts are rate-limited: 5 tries per 15 minutes
- All API endpoints have rate limiting: 30 requests per minute

## Security recommendations (production)

- ✅ Use HTTPS and set `NODE_ENV=production` for secure session cookies
- ✅ Use `ADMIN_PASS_HASH` (bcrypt) instead of plaintext `ADMIN_PASS`
- ✅ Rate limiting is enabled (login: 5/15min, API: 30/min)
- ✅ All inputs are validated on server-side
- ⚠️ Consider adding CSRF protection for form submissions
- ⚠️ Use Redis or similar for session store in production
- ⚠️ Migrate from file-based storage to a real database (PostgreSQL, MongoDB, etc.)

## Testing flows

- **Cash payment**: Place an order with Cash — the server simulates delivery in real-time with location updates
- **Card payment**:
  - If `STRIPE_SECRET_KEY` is configured, redirects to Stripe Checkout
  - Otherwise, use "Complete Payment (Simulate)" button
- **Admin dashboard**: Login with default credentials (admin/password), advance order status, set random delivery locations, and track orders in real-time
- **Tracking**: Use the tracking ID from order confirmation to see live delivery status and ETA

## Project structure

```
barima_nkwan/
├── index.html           # Customer ordering page
├── admin.html           # Admin dashboard
├── admin-login.html     # Admin login
├── script.js            # Client-side logic
├── admin.js             # Admin dashboard logic
├── styles.css           # Shared styling
├── server.js            # Express backend + Socket.IO
├── menu.json            # Menu items definition
├── orders.json          # Order persistence
├── package.json         # Dependencies
├── .env.example         # Environment template
└── README.md            # This file
```
