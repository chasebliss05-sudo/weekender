# Weekender

Trip planner for study abroad students: pick where you are, where you're going, your dates and budget, and get live flights, hostels and rentals, plus sites, things to do and nightlife.

## How it works

- `index.html` is the app.
- `api/search.js` is a Vercel serverless function that calls SerpApi (Google Flights and Google Hotels) and returns clean JSON to the app. Responses are cached for 6 hours to save API credits.
- Trains and buses are estimates with Rome2rio links. Those providers have no open API.

## Deploy

1. Import this repo in Vercel (Framework preset: Other, no build command).
2. Project > Settings > Environment Variables: add `SERPAPI_KEY` with your SerpApi key.
3. Redeploy.

If the key is missing or a search fails, the app falls back to estimated prices.
