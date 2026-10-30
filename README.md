# Listing Studio

Snap your product → get **background prompts**, **per-photo swap prompts**, and a **Vinted listing with price**. One tap copies anything.

Uses Gemini only to *read* photos and write text, so it runs on the **free** Gemini API tier (like a calorie-scanner app). Images are made by you in Gemini / Google Flow with the prompts.

## What you get per product
- **4 background prompts** — simple surfaces picked to suit your product (wood, studio, concrete tiles, linen…), plus your own saved styles. Optional: add a photo of a background you like and idea #1 will match it.
- **A prompt for every photo** — keeps the product, box (as worn/torn as it is), tissue paper, booklets, extra laces, certificates and measuring tape 100% the same; only swaps the floor. Close-ups / tag shots are flagged.
- **Vinted listing** — short title, slim description, hashtags (all editable), retail price in €, resale range and a suggested price.
- Everything is saved on your phone under **Recent**.

## Setup
1. **API key (free):** aistudio.google.com → *Get API key* → *Create API key*.
2. **GitHub:** new public repo (e.g. `listing-studio`) → *Add file → Upload files* → drag in everything inside this folder (the `js` and `icons` folders too) → *Commit changes*.
3. **Pages:** repo *Settings → Pages* → Branch `main`, folder `/ (root)` → Save. After ~1 min it's live at `https://YOUR-USERNAME.github.io/listing-studio/`.
4. **iPhone:** open the link in Safari → Share → *Add to Home Screen*.
5. Open the app → ⚙︎ → paste key → **Test key**.

## Using the prompts
1. Copy a **background** prompt → Gemini / Flow (Nano Banana 2) → download the background.
2. For each photo: new chat → attach **your photo first**, then **the background** → paste that photo's prompt.
3. Compare the result with your original — especially labels. If the AI changed anything, use the original.

## Notes
- Free tier has per-minute / per-day limits. If you hit one, wait a minute.
- Price uses Google Search when allowed for better accuracy (toggle in Settings). Always sanity-check against sold items on Vinted.
- Edit all prompt wording in `js/prompts.js`.
