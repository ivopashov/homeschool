# Math Adventure

Math-only homeschool web app for a child workflow:

- parent creates dated math instructions
- child solves 3 batches of 10 multiple-choice questions
- short break between batches
- answers and batches are saved
- OpenAI generates adaptive questions when configured
- Neon/Postgres stores data in production

## Local Setup

Install dependencies:

```bash
npm install
```

Create local config:

```bash
cp .env.example .env.local
```

Set at least:

```bash
OPENAI_API_KEY=sk-your-real-key
OPENAI_MODEL=gpt-4.1-mini
DATABASE_URL=
```

Leave `DATABASE_URL` empty for local JSON storage in `.data/db.json`.

Start locally:

```bash
npm run dev
```

Open:

```text
http://localhost:3001
```

## Neon Setup

1. Create a free Neon project at https://neon.com.
2. Create or use the default database.
3. Copy the pooled Postgres connection string.
4. Use it as:

```bash
DATABASE_URL=postgresql://...
```

The app auto-creates required tables:

- `day_plans`
- `math_sessions`

## Vercel Setup

1. Import the GitHub repo into Vercel.
2. Framework preset: `Other`.
3. Install command:

```bash
npm install
```

4. Leave build command and output directory empty.
5. Add environment variables:

```bash
OPENAI_API_KEY=sk-your-real-key
OPENAI_MODEL=gpt-4.1-mini
DATABASE_URL=postgresql://...
```

6. Deploy.

## Notes

- `server.js` is only for local development.
- Vercel uses static files plus `/api/*.js` serverless functions.
- `.env.local` and `.data/` are ignored by git.
- If `OPENAI_API_KEY` is missing, the app falls back to deterministic local math generation.
