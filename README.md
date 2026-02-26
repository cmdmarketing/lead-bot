# Lead Bot — Discord Preview Setter System

## Railway Environment Variables
Set these in Railway → your project → Variables:

```
DISCORD_TOKEN=your_discord_bot_token
NEW_LEADS_CHANNEL_ID=your_new_leads_channel_id
REVIEW_CHANNEL_ID=your_review_channel_id
GOOGLE_API_KEY=your_google_places_api_key
```

## GHL Webhook Setup
Point your GHL webhook to:
```
https://YOUR-RAILWAY-URL.railway.app/webhook
```

## How It Works
1. GHL fires webhook when lead is interested
2. Bot looks up their GMB via phone number
3. Posts full lead card in #new-leads for Noah
4. Noah builds the preview, then types /done [url] in Discord
5. Bot pings you in #ready-for-review with the preview link
