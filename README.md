# CTS fantasy WC '26

Very simple company fantasy football web app for the 2026 FIFA World Cup.

## What it includes

- Registration page: name, nickname, email, password
- Login page: nickname + password
- Tip page: all World Cup 2026 matches, teams, flags, date/time, venue, score prediction
- Tips lock automatically 5 minutes before match kick-off
- Scoreboard page: total points sorted from highest to lowest
- Optional admin page: sync fixture/results source and manually enter final scores

## Scoring rules

The app uses exclusive scoring. Points do **not** stack:

- Exact score: 3 points
- Correct goal difference and correct winner/draw: 2 points
- Correct winner/draw only: 1 point
- Wrong result: 0 points

Examples:

- Real result 2:1, tip 2:1 = 3 points
- Real result 2:1, tip 1:0 = 2 points
- Real result 2:1, tip 3:1 = 1 point
- Real result 2:1, tip 1:1 = 0 points

## Data sources

Default match source:

`https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json`

This is a public no-key fixture JSON from the OpenFootball `worldcup.json` project. It includes all 104 World Cup 2026 matches, including knockout placeholders. When final scores are added to that source, the sync process imports them.

For production live/final scores, use a proper football API such as API-SPORTS/API-Football. The API-SPORTS guide says World Cup 2026 uses `league=1` and `season=2026`, and `fixtures?league=1&season=2026` returns the 104-match schedule with fixture id, UTC time, venue, and status.

## Requirements

- Node.js 20+
- npm

## Setup

```bash
cp .env.example .env
npm install
npm run sync:matches
npm start
```

Open:

`http://localhost:3000`

## Environment variables

```bash
PORT=3000
SESSION_SECRET=change-this-long-random-string
ADMIN_TOKEN=change-this-admin-token
OPENFOOTBALL_URL=https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json
```

Set a strong `SESSION_SECRET` and `ADMIN_TOKEN` before using this with colleagues.

## Pages

- `/register.html` — registration
- `/login.html` — login
- `/tips.html` — user predictions
- `/scoreboard.html` — ranking
- `/admin.html` — optional admin tools

## Admin use

1. Add an `ADMIN_TOKEN` in `.env`.
2. Start the app.
3. Log in as any normal user.
4. Open `/admin.html`.
5. Paste the admin token.
6. Click **Sync from OpenFootball** or manually enter final scores.

The scoreboard recalculates whenever it is opened/refreshed, so there is no separate scoring job.

## Important notes

- This app stores data in JSON files under `/data` to keep the project very simple.
- Passwords are hashed with bcryptjs.
- The default session store is in memory, which is fine for a small internal demo, but use a persistent session store before serious deployment.
- For real company production use, move data to PostgreSQL/SQLite, add HTTPS, backups, email verification, password reset, and stronger admin roles.

## Optional deployment idea

For an internal demo, run it on a small company VM:

```bash
npm install --omit=dev
npm run sync:matches
PORT=3000 npm start
```

Put Nginx or another reverse proxy with HTTPS in front of it.
