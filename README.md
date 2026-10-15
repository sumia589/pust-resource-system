# PUST CSE Resource Management System

Full-stack project: **HTML + CSS + JavaScript** frontend, **Node.js + Express** backend, **MongoDB** database.

## Features

| Role    | Can do |
|---------|--------|
| Student | View resources, report problems |
| Teacher | View resources, **request resources**, report problems |
| Staff   | View resources, report problems |
| Admin   | Everything above + Admin Panel (approve/reject requests, handle problem reports, add/edit/delete resources, view users, view full activity records) + AI Suggestions |

- Sign In / Create Account with **email + password** (passwords hashed with bcrypt, login via JWT)
- Resource status: Available, Working, Damaged, Needed
- Every action (login, request, report, approve, edit...) is saved in an activity log (Records tab)
- AI Suggestions: rule-based now (low stock, damaged, open high-priority reports, repeated complaints, high-demand requests). Ready to plug in a real AI model later.

## What you need installed

1. **Node.js** 18 or newer — https://nodejs.org
2. **MongoDB** — choose one:
   - MongoDB Community Server (local) — https://www.mongodb.com/try/download/community
   - or a free cloud database on MongoDB Atlas — https://www.mongodb.com/atlas

## How to run

Open a terminal inside the `backend` folder:

```bash
cd backend
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Open `.env` and set:
- `MONGODB_URI` (local default already works if MongoDB is running; for Atlas paste your connection string)
- `JWT_SECRET` (any long random text)
- optionally the admin email/password

Then:

```bash
npm run seed     # creates admin, demo users and sample resources (run once)
npm start        # starts the server
```

Open **http://localhost:3000** in your browser.

## Default accounts (created by `npm run seed`)

| Role    | Email                | Password     |
|---------|----------------------|--------------|
| Admin   | admin@pust.ac.bd     | Admin@12345  |
| Teacher | teacher@pust.ac.bd   | Teacher@123  |
| Student | student@pust.ac.bd   | Student@123  |
| Staff   | staff@pust.ac.bd     | Staff@123    |

Change the admin password in `.env` before running seed (or delete the demo users) for real use.
New students, teachers and staff can register themselves; admin accounts cannot be self-registered.

## Project structure

```
pust-resource-system/
├── backend/
│   ├── server.js            Express app + serves the frontend
│   ├── config/db.js         MongoDB connection (Mongoose)
│   ├── models/index.js      User, Resource, Request, Report, Activity schemas
│   ├── middleware/auth.js   JWT check + role check
│   ├── routes/              auth, resources, requests, reports, admin
│   ├── scripts/seed.js      Admin + demo data
│   ├── utils.js             Helpers + activity logging
│   └── .env.example
└── frontend/
    ├── index.html           Sign In / Create Account
    ├── app.html             Dashboard (all views)
    ├── css/style.css
    └── js/                  api.js, login.js, app.js
```

## API overview (all under /api, JWT in `Authorization: Bearer <token>`)

| Method | Path | Who |
|--------|------|-----|
| POST | /auth/register, /auth/login | public |
| GET | /auth/me | any user |
| GET | /resources, /resources/stats | any user |
| POST/PUT/DELETE | /resources, /resources/:id | admin |
| POST | /requests | teacher |
| GET | /requests/mine | teacher |
| GET, PATCH | /requests, /requests/:id | admin |
| POST | /reports | any user |
| GET | /reports/mine | any user |
| GET, PATCH | /reports, /reports/:id | admin |
| GET | /admin/summary, /admin/activity, /admin/users, /admin/suggestions | admin |

## Troubleshooting

- **"Cannot connect to MongoDB"** — MongoDB is not running, or `MONGODB_URI` is wrong.
- **"JWT_SECRET is missing"** — you forgot to create `.env` from `.env.example`.
- Port 3000 busy — change `PORT` in `.env`.
