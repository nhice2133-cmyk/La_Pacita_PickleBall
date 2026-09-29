# La Pacita Pickle Hub – Booking System

Node.js + Express + Postgres. One service serves the website and the API.

## Roles
- **Customers** – public booking page, no account.
- **Admin** – view bookings and **Accept** pending ones only (enforced on the server).
- **Super Admin** – everything: reject/cancel, courts & rates, create/deactivate/delete multiple admins, GCash settings.

## Run locally
1. Node 20+. Create a free Postgres database (Neon or Supabase) and copy its connection string.
2. `npm install`
3. `cp .env.example .env` → set `DATABASE_URL`, `SUPER_EMAIL`, `SUPER_PASSWORD`, `JWT_SECRET`.
4. `npm start` → http://localhost:3000. Tables and the Super Admin are created on first start. Log in via "Staff Login".

## Deploy on Render FREE (step by step)
Render's free web service has an ephemeral disk: anything stored in files is erased on every restart, spin-down or redeploy. So the data lives in a separate free Postgres.
1. **Database:** create a free project at neon.tech (or supabase.com), copy the Postgres connection string (on Supabase use the **Session pooler** string, not the direct one). (Render's own free Postgres expires after 30 days, so avoid it.)
2. **GitHub:** push this folder to a new repo.
3. **Render:** New → Web Service → connect the repo. Runtime Node, Build `npm install`, Start `npm start`, Instance type **Free**.
4. **Environment variables:** `DATABASE_URL`, `JWT_SECRET` (long random), `SUPER_EMAIL`, `SUPER_PASSWORD`, `NODE_ENV=production`, `TZ=Asia/Manila`, `PAYMENT_MODE=manual`, and `BASE_URL=https://YOUR-APP.onrender.com`.
5. Deploy, open the URL, log in via Staff Login, upload your GCash QR in Settings, and make a test booking.
6. **Stay awake (optional):** free services sleep after 15 minutes idle and take about a minute to wake. Use a free monitor such as UptimeRobot to request `https://YOUR-APP.onrender.com/api/config` every 5 minutes.

## Payment modes (`PAYMENT_MODE`)
- **manual**: customer sees your GCash QR, pays, types the reference number. Staff verify in the GCash app and press Accept.
- **paymongo**: customer goes to PayMongo GCash checkout; slot held 10 minutes; webhook marks it paid (Pending, or Accepted if `AUTO_ACCEPT=true`). A late payment on a slot already taken is flagged **Refund**.
  Setup: PayMongo secret key → `PAYMONGO_SECRET_KEY`; Developers → Webhooks → `https://YOUR-APP.onrender.com/api/paymongo/webhook` for `checkout_session.payment.paid`; webhook secret → `PAYMONGO_WEBHOOK_SECRET`. Test with test keys first and check PayMongo's current docs.

## Before real customers
- Change the Super Admin password; use a long random `JWT_SECRET`.
- Render says free instances aren't meant for production; upgrade the web service (about $7/month) to remove sleeping when you're busy.
- Ideas: login rate limiting, email/SMS notifications, receipt uploads.
