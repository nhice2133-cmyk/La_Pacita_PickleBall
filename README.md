# La Pacita Pickle Hub – Booking System

Node.js + Express + SQLite. One service serves the website and the API.

## Roles
- **Customers** – public booking page, no account.
- **Admin** – dashboard: view bookings and **Accept** pending ones. Nothing else (enforced on the server).
- **Super Admin** – everything: reject/cancel, courts & rates, create/deactivate/delete multiple admins, GCash settings.

## Run locally
1. Install Node 20+.
2. `npm install`
3. `cp .env.example .env` and edit (set `SUPER_EMAIL`, `SUPER_PASSWORD`, `JWT_SECRET`).
4. `npm start` → http://localhost:3000 (the Super Admin is created on first start; log in via "Staff Login").

## Payment modes (`PAYMENT_MODE` in .env)
- **manual** (default): customer sees your GCash QR (upload it in Super Admin → Settings), pays, types the GCash reference number. Staff compare with the GCash app and press Accept.
- **paymongo**: customer is sent to PayMongo's GCash checkout. The slot is held for 10 minutes; PayMongo's webhook marks it paid automatically (Pending, or Accepted if `AUTO_ACCEPT=true`). If a late payment arrives after the slot was taken, the booking is flagged **Refund**.

### PayMongo setup
1. Create a PayMongo account, get your secret key (test key first) → `PAYMONGO_SECRET_KEY`.
2. Dashboard → Developers → Webhooks → add `https://YOUR-DOMAIN/api/paymongo/webhook` for the event `checkout_session.payment.paid`. Copy the webhook secret → `PAYMONGO_WEBHOOK_SECRET`.
3. Set `PAYMENT_MODE=paymongo` and `BASE_URL=https://YOUR-DOMAIN`. Test in test mode, then switch to live keys once PayMongo activates GCash on your account.
Check PayMongo's current docs if anything differs from this setup.

## Deploy (Render or Railway)
1. Push this folder to a GitHub repo.
2. Create a **Web Service** (Node). Build: `npm install`. Start: `npm start`.
3. Add a **persistent disk/volume** (e.g. mounted at `/data`) and set `DB_PATH=/data/data.db` – otherwise bookings are lost on redeploy.
4. Add the environment variables from `.env.example` (set `NODE_ENV=production`).
5. Optionally attach your own domain; HTTPS is automatic.

## Before you go live
- Change the Super Admin password; use a long random `JWT_SECRET`.
- Back up the SQLite file regularly.
- Consider login rate-limiting (e.g. `express-rate-limit`) and email/SMS notifications as next steps.
