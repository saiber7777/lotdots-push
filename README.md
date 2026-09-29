# Blossom Rock Crew App

A real multi-user web app for the Blossom Rock porter crew: a shared satellite
work map, numbered pins with photos, and clean multi-page work orders with
PDF/image export. Everyone logs in — crew, supervisors, and admins — and all
data is saved on the server.

## Run it on your own computer (free, for testing)

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
cd blossom-rock-crew-app
npm install
cp .env.example .env
# Edit .env: set JWT_SECRET to a long random string, e.g. run:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Create your admin account + the Blossom Rock property:
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='pick-a-strong-password' ADMIN_NAME='Saiber' npm run seed

npm start
```

Open **http://localhost:3000** and log in with the admin email/password you just set.

- **Admin** (you): Team & properties tab — create crew/supervisor accounts, add properties.
- **Crew**: log in on their phones, tap the map to drop pins, attach photos.
- **Supervisors/admins**: assign work, generate work orders, print/save as PDF.

Photos are resized automatically on upload. Local data lives in `data/app.db`
(SQLite) and photos in `uploads/` — both are free and need nothing else.

## Take it live on your own domain

Four steps. Nothing here needs a paid account to start (free tiers work).

### 1. Buy a domain
Buy one from any registrar (Cloudflare, Namecheap, Porkbun…). Example:
`blossomrockcrew.com`. This is the one thing that costs money (~$10–15/year).

### 2. Create free hosting + database accounts
- **Hosting**: [Render.com](https://render.com) — free tier, deploys straight from GitHub.
- **Database**: Render's free managed Postgres (created automatically by `render.yaml` below).

### 3. Deploy
1. Put this folder in a GitHub repo (private is fine).
2. In Render: **New → Blueprint** and select your repo. Render reads `render.yaml`
   and creates the web service + Postgres database.
3. After deploy, run the seed **once** to create your admin account. In Render:
   open the service → **Shell** tab and run:
   ```bash
   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='pick-a-strong-password' ADMIN_NAME='Saiber' npm run seed
   ```
4. Open your Render URL (e.g. `https://blossom-rock-crew-app.onrender.com`) and log in.

### 4. Point your domain at it
1. In Render: service → **Settings → Custom Domain** → add your domain.
   Render shows you the DNS records to create.
2. At your registrar, add the DNS record Render asks for (usually a CNAME
   pointing at your `onrender.com` address).
3. Wait a few minutes for DNS + Render's free HTTPS certificate. Done —
   your crew logs in at your own domain.

## How the pieces fit

| Piece | Local dev | Production (Render) |
|---|---|---|
| App server | `npm start` | Docker container (`Dockerfile`) |
| Database | SQLite file (`data/app.db`) | Managed Postgres (`DATABASE_URL`) |
| Photos | `uploads/` folder | `uploads/` folder (see note) |
| Login | email + password, bcrypt hash, JWT | same |

**Postgres swap:** set the `DATABASE_URL` env var and the app uses Postgres
instead of SQLite — no code changes. All queries use `?` placeholders, which
the database layer rewrites for Postgres automatically.

**Uploads note:** on Render's free plan, files in `uploads/` disappear when the
service restarts or redeploys (ephemeral disk). The app and database are fine —
only uploaded photos are affected. For permanent photo storage, either add a
Render persistent disk (paid instance) or move uploads to object storage
(S3/Cloudflare R2) later.

## API quick reference

- `POST /api/auth/login` → `{ token, user }`
- `GET /api/properties` · `POST /api/properties` (admin)
- `GET /api/items?property_id=&status=` · `POST /api/items` (multipart, photo)
- `PATCH /api/items/:id` (status flow: open → assigned → done)
- `POST /api/items/:id/complete` (multipart proof photo, required)
- `POST /api/workorders` · `GET /api/workorders/:id`
- `GET /api/meta` → areas, categories, statuses
