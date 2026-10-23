# Bolo

Voice-first Swiggy cart assistant. Speak naturally, Bolo transcribes your request with Sarvam STT, reasons with Gemini, and manages your Swiggy cart via the Food MCP.

## Prerequisites

- Node.js 20+
- API keys:
  - [Sarvam AI](https://dashboard.sarvam.ai) — `SARVAM_API_KEY`
  - [Google AI Studio](https://aistudio.google.com/apikey) — `GEMINI_API_KEY`
- Swiggy account with at least one saved delivery address
- Swiggy OAuth redirect URI registered: `http://localhost:3001/oauth/callback` (DCR auto-registers on first login; if it fails, email [builders@swiggy.in](mailto:builders@swiggy.in))

## Setup

```bash
# Install dependencies
npm install

# Configure server environment
cp server/.env.example server/.env
# Edit server/.env with your API keys
```

## Run

```bash
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3001

1. Open the client and click **Connect Swiggy**
2. Complete phone + OTP in the browser
3. Hold the mic button and speak, or type a message

## Golden path demo

**Cart only** — say or type:

> Add two chicken biryanis from Behrouz to my Swiggy cart.

Expected flow: load addresses → search Behrouz → find chicken biryani → update cart → show cart total.

**Full COD order** — say or type:

> Order two chicken biryanis from Behrouz with cash on delivery.

Expected flow: search + cart → server fetches coupons → applies best COD coupon → places Cash on Delivery order → shows order ID and total.

**Warning:** Order-intent messages place **real COD orders** on your connected Swiggy account.

## Manual test checklist

- [ ] Connect Swiggy OAuth succeeds; status shows connected
- [ ] Voice: hold mic, speak, transcript appears as user message
- [ ] Golden path adds items and shows price
- [ ] "Make that two" updates quantity from context (no order placed)
- [ ] "What's in my cart?" shows cart summary (no order placed)
- [ ] "Order ... from ..." applies coupon and places COD order
- [ ] Ambiguous "get me a biryani" asks for clarification
- [ ] Closed restaurant suggests alternatives
- [ ] Switching restaurant clears cart first
- [ ] Expired Swiggy session prompts reconnect
- [ ] Invalid Sarvam key shows clear error

## Smoke test (Swiggy MCP)

After OAuth, copy the access token from server session or complete OAuth separately, then:

```bash
SWIGGY_ACCESS_TOKEN=eyJ... npm run smoke-test -w server
```

## Architecture

```
React client → POST /api/transcribe (Sarvam) → POST /api/chat (Gemini + Swiggy MCP)
OAuth: GET /auth/swiggy/login → Swiggy OTP → GET /oauth/callback
Order intent → server-side COD checkout (coupons + place_food_order)
```

## MVP scope

**In:** voice/text input, restaurant/menu search, cart add/update/remove/view, clarification, COD order placement on order-intent messages, auto best-coupon  
**Out:** UPI payment, order tracking, TTS

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start client + server |
| `npm run build` | Production build |
| `npm run start` | Run production server |
