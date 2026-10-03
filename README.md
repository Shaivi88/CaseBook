# Casebook on Vercel

A static front end (`public/index.html`) plus one serverless function (`api/ai.js`) that keeps your Groq API key on the server and streams responses back to the browser.

```
public/index.html   the whole app (no build step)
api/ai.js           POST /api/ai: validates, rate-limits, streams the AI reply back as plain text
vercel.json         output folder, 60 s function limit, security headers
package.json        one dependency: groq-sdk
.env.example        the settings you need
```

## Deploy (about 5 minutes)

### Option A: Git (recommended)
1. Push this folder to a GitHub repository.
2. At vercel.com/new, import the repository. Leave the framework as **Other**; there is no build command.
3. Under **Environment Variables** add `GROQ_API_KEY` and optionally `ACCESS_CODE`.
4. Press **Deploy**.

### Option B: command line
```bash
npm i -g vercel
vercel login
vercel                         # creates the project, gives a preview URL
vercel env add GROQ_API_KEY production
vercel env add ACCESS_CODE production
vercel --prod
```

Environment variables only apply to deployments made after you add them, so redeploy if you add them late.

## Settings

| Variable | Required | What it does |
|---|---|---|
| `GROQ_API_KEY` | yes | Get a free key at [console.groq.com](https://console.groq.com). Never put it in `public/`. |
| `ACCESS_CODE` | recommended | Visitors are asked for it once per browser session. Without it, anyone with the link can use your quota. |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MIN` | no | Requests allowed per visitor per window. Default: 40 per 10 minutes. |
| `MODEL_QUICK` | no | Model for fast/coaching calls. Default: `llama-3.1-8b-instant`. |
| `MODEL_DEFAULT` | no | Model for analysis calls. Default: `llama-3.3-70b-versatile`. |
| `MODEL_COMPLEX` | no | Model for complex calls. Default: `llama-3.3-70b-versatile`. |

## Protect your quota
- Set `ACCESS_CODE` on any public URL so strangers can't drain your free-tier limits.
- Groq's free tier allows ~14,400 requests/day. The built-in limiter (40 req/10 min per IP) is a speed bump, not a wall. For a hard limit, add a rate-limit rule in **Vercel Firewall** for the path `/api/ai`.
- Vercel's free Hobby plan is for personal, non-commercial use. Check the current terms if this will be used commercially.

## Limits to know about
- Each AI call is its own function run, capped at 60 seconds in `vercel.json`. The analysis is three separate calls so each gets its own 60 seconds. A very long case can still time out; shorten the case or raise `maxDuration` on a paid Vercel plan.
- Cases, chats, and scores live in each visitor's browser storage. They do not sync between devices. Use Library → Download backup to move them.
- All visitors share your API key and your quota.

## Local run
```bash
npm install
npm i -g vercel
vercel dev        # serves public/ and api/ on http://localhost:3000
```
Copy `.env.example` to `.env` and fill in your key. `.env` is already git-ignored.
