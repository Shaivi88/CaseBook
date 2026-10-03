# Casebook on Vercel

A static front end (`public/index.html`) plus one serverless function (`api/ai.js`) that keeps your AI key on the server.

```
public/index.html   the whole app (no build step)
api/ai.js           POST /api/ai: validates, rate-limits, streams the AI reply back as plain text
vercel.json         output folder, 60 s function limit, security headers
.env.example        the settings you need
```

## Deploy (about 5 minutes)

### Option A: Git (recommended)
1. Create a GitHub repository and push this folder to it.
2. At vercel.com/new, import the repository. Leave the framework as **Other**; there is no build command.
3. Under **Environment Variables** add `ANTHROPIC_API_KEY` (your key) and `ACCESS_CODE` (any phrase you choose).
4. Press **Deploy**. Open the URL, press Open app, load a sample case and press Analyze.

### Option B: command line
```bash
npm i -g vercel
cd casebook-vercel
vercel login
vercel                       # creates the project, gives a preview URL
vercel env add ANTHROPIC_API_KEY production
vercel env add ACCESS_CODE production
vercel --prod
```
Environment variables only apply to deployments made after you add them, so redeploy if you add them late.

## Settings

| Variable | Required | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | The key the server uses. Never put it in `public/`. |
| `ACCESS_CODE` | recommended | Visitors are asked for it once per browser session. Without it, anyone with the link can spend your credit. |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MIN` | no | Requests allowed per visitor per window. Default 40 per 10 minutes. |
| `MODEL_QUICK`, `MODEL_DEFAULT`, `MODEL_COMPLEX` | no | Override which model each tier uses. Defaults are in `api/ai.js`. |

## Protect your money
- Set a **monthly spend limit** in your AI provider's console before sharing the link.
- Keep `ACCESS_CODE` set on any public URL.
- The built-in limiter keeps its counts in memory per server instance, so it is a speed bump, not a wall. For a hard limit add a rate-limit rule in **Vercel Firewall** for the path `/api/ai`.
- Vercel's free Hobby plan is for personal, non-commercial use. Check the current terms if this will be used commercially.

## Limits to know about
- Each AI call is its own function run, capped at 60 seconds in `vercel.json`. As far as I could confirm, that is also the Hobby plan maximum, and Pro allows more. The analysis is three separate calls, so each gets its own 60 seconds. A very long case can still time out; if so, shorten it or raise `maxDuration` on a paid plan.
- Cases, chats and scores live in each visitor's browser storage. They do not sync between devices. Use Library, Download backup to move them.
- All visitors share your key and your credit.

## Things I could not verify here
- I could not deploy to Vercel from this environment, so the steps above are untested on a live account.
- The security headers in `vercel.json` (including the content security policy) were written carefully but never loaded in a real browser. If the page loads without styling or fonts, or buttons do nothing, open the browser console: a blocked resource there points at the line to loosen.
- The server function and the page were tested together against a fake AI service, not the real one. The first real Analyze is the real test. If it fails, check the function logs in the Vercel dashboard (the log shows the HTTP status but never your text).

## Local run
```bash
npm i -g vercel
vercel dev        # serves public/ and api/ on http://localhost:3000
```
Put the same variables in a local `.env` file (copy `.env.example`); `.env` is already git-ignored.
