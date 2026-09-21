# Budget

Local-first personal finance for German bank CSVs. Import bookings, categorize with rules, track budgets, cash, lending, and contracts — all on your machine in SQLite.

![Budget](public/logo.svg)

## Features

- Import German CAMT / Umsatz CSV (bank export)
- Rules-based auto-categorization (stored in your DB)
- Monthly budgets, year sheet, cash wallet, lending / repayments
- Recurring contracts detection, insights, and a simple ask assistant
- Setup wizard for first run; data stays in `data/haushalt.sqlite` (created automatically)

## Requirements

- Node.js 22+ (uses the built-in `node:sqlite` module)

## Quick start

```bash
npm install
cp .env.example .env   # optional — defaults work for local use
npm run dev
```

- UI: http://127.0.0.1:5173  
- API: http://127.0.0.1:8787/api/v1  

On first start the API creates `data/`, the SQLite file, tables, and a thin generic seed (categories + keyword rules). Your rules, people, and budgets live only in that database — not in the repo.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API + Vite UI together |
| `npm run dev:api` | API only (`tsx watch`) |
| `npm run dev:ui` | Vite only |
| `npm start` | API without file watch |
| `npm run build` | Typecheck + production UI build |

## Configuration

Copy `.env.example` to `.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HAUSHALT_API_KEY` | `haushalt-local` | Bearer / `X-Api-Key` for the API |
| `VITE_HAUSHALT_API_KEY` | `haushalt-local` | Same key for the UI |
| `PORT` | `8787` | API port |
| `HAUSHALT_AI_KEY` | — | Optional OpenAI-compatible key for contract labeling |
| `HAUSHALT_AI_BASE_URL` | OpenAI | Optional custom base URL |
| `HAUSHALT_AI_MODEL` | `gpt-4o-mini` | Optional model name |

## API

See [API.md](./API.md) for the full endpoint catalog. Auth:

```http
Authorization: Bearer <HAUSHALT_API_KEY>
```

## Privacy

- No cloud account; the ledger is a local SQLite file under `data/`
- `data/` and `.env` are gitignored — do not commit your bank history or API keys
- Seeds in `src/data/` are generics for **new** installs only; they do not overwrite an existing database

## Stack

React 19 · Vite · Ant Design · Express · TypeScript · SQLite (`node:sqlite`)

## License

[MIT](./LICENSE)
