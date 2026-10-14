# LoL Worlds Moneyball

A "Moneyball for League of Legends" web app. It sorts every Worlds 2026 team into archetypes using advanced stats from their games since MSI, and breaks down any head-to-head matchup.

## APIs

- **Leaguepedia** (Cargo API): game list, results, end-of-game stats, picks and bans
- **lolesports feed**: in-game stats at 15 minutes
- **Groq**: writes the scouting reports and matchup breakdowns

## Stack

React + Vite, deployed on Vercel.

## Running locally

```bash
npm install
npm run dev
```

### Fetching data

The fetch script needs a Leaguepedia bot password (free, from `Special:BotPasswords` on lol.fandom.com). Put it in a `.env` file:

```
LEAGUEPEDIA_USER=YourName@botname
LEAGUEPEDIA_PASS=your-bot-password
```

Then run:

```bash
npm run fetch
```

Everything it downloads goes into `data/cache.json`.
