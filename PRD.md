# Bolo — Voice Food Ordering Agent

## 1. Product Overview

**Bolo** is a voice-first AI food-ordering agent that lets users search for food and manage their Swiggy cart using natural voice commands.

The user speaks to Bolo, the system converts speech to text, an AI agent interprets the request and uses **Swiggy MCP** to perform the required actions. Results and responses are displayed on screen as text.

## 2. Problem

Food ordering involves manually searching restaurants, browsing menus, selecting items, and managing quantities.

Bolo aims to make this interaction conversational:

> “Add two chicken biryanis from Behrouz to my cart.”

## 3. Goal

Build an MVP that can:

* Understand natural voice commands.
* Search Swiggy restaurants and menus.
* Identify requested food items.
* Add, remove, and modify cart items.
* Display agent actions and responses on screen.
* Require explicit confirmation before placing an order.

## 4. MVP Scope

### Voice Input

* User presses a microphone button.
* User speaks naturally.
* Speech is converted to text using an STT model from **Sarvam**.
* Transcribed text is displayed on screen.

### AI Agent

The agent should:

* Understand the user's intent.
* Maintain conversational context.
* Decide which Swiggy MCP tool to use.
* Ask for clarification when necessary.
* Avoid unnecessary questions.

### Swiggy Integration

Using Swiggy Food MCP:

* Search restaurants.
* Browse menus.
* Search for food items.
* Add items to cart.
* Modify quantities.
* Remove items.
* View cart.

### Visual Response

Instead of TTS, Bolo displays responses on screen.

Example:

```text
You
"Add two chicken biryanis from Behrouz."

Bolo
🔍 Searching Behrouz...

Bolo
✓ Added 2 × Chicken Biryani
₹548
```

## 5. Ordering Flow

```text
User speaks
     ↓
STT
     ↓
Text displayed
     ↓
AI Agent
     ↓
Swiggy MCP
     ↓
Cart updated
     ↓
Result displayed
```

For actual ordering:

```text
Cart ready
     ↓
Bolo shows order summary
     ↓
User explicitly confirms
     ↓
Place order
```

Bolo must **never place an order without explicit confirmation**. It only adds item to the cart. Next steps are done manually by the user.

## 6. Example Interactions

### Simple Order

**User:**
"Add a chicken biryani from Behrouz."

**Bolo:**
"Added 1 Chicken Biryani from Behrouz to your cart."

### Quantity Change

**User:**
"Make that two."

**Bolo:**
"Updated the quantity to 2."

### Ambiguity

**User:**
"Get me a biryani."

**Bolo:**
"I found multiple biryani options. Which one would you like?"

### Cart Review

**User:**
"What's in my cart?"

**Bolo:**

```text
Your Cart

2 × Chicken Biryani     ₹548
1 × Coke                 ₹60
----------------------------
Total                    ₹608
```

## 7. UI

The MVP should have a minimal interface:

```text
┌──────────────────────────────┐
│            BOLO              │
│                              │
│  You                         │
│  "Add two chicken biryanis"  │
│                              │
│  Bolo                        │
│  ✓ Added 2 × Chicken Biryani │
│  ₹548                        │
│                              │
│                              │
│            🎙️               │
│       Tap to speak           │
└──────────────────────────────┘
```

## 8. Architecture

```text
┌──────────────────┐
│   React Client   │
│                  │
│ Voice UI         │
│ Conversation UI  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│    STT Model     │
│     Sarvam       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   Agent Server   │
│                  │
│ LLM + Tool Calls │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│    Swiggy MCP    │
│                  │
│ Search / Menu    │
│ Cart / Ordering  │
└──────────────────┘
```

## 9. Suggested Tech Stack

* **Frontend:** React + TypeScript
* **Backend:** Node.js + TypeScript
* **STT:** Sarvam
* **LLM:** Gemini
* **Agent communication:** MCP
* **Food platform:** Swiggy Food MCP
* **Authentication:** Swiggy OAuth 2.1 + PKCE

## 10. Out of Scope for MVP

* TTS / spoken responses
* Autonomous ordering
* Payment handling
* Order tracking
* Personalized recommendations
* Complex dietary planning
* Multi-platform food ordering

## 11. Success Criteria

The MVP is successful if a user can say:

> **"Add two chicken biryanis from Behrouz to my Swiggy cart."**

and Bolo can independently:

**Listen → Transcribe → Understand → Search → Select → Add → Display**

while asking for clarification only when necessary.
