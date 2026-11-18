# AnyWay Chat: talk your way

**One chat where deaf, blind and non-speaking people talk with anyone, each in their own way.**

A deaf person signs to the camera and their friend reads it. A blind person speaks and hears every reply. A person who can't speak taps pictures and AnyWay says it out loud. The other person just chats normally.

Built with the **Nexconn Chat SDK** and **Call SDK** for the Nexconn Build Challenge 2026 (Humanitarian & Social Good).

**Live app: [anywaychat.vercel.app](https://anywaychat.vercel.app)**

> **Trying it alone?** Sign up, then tap **Add them** to chat with three demo friends who answer by themselves:
> **Priya** (deaf, her replies arrive as signs), **Arjun** (blind, he talks) and **Meera** (can't speak, she taps).
> Then open **Face to face** to use one phone as an interpreter between two people.

---

## Who it's for

Chat apps assume everyone can see, hear, speak and type. Hundreds of millions of people can't do one of those, so today a blind teenager waits for a parent to read his messages, and a deaf customer writes on paper at the counter.

AnyWay translates **between** ways of communicating, inside one conversation:

| You are | You send by | You receive as |
|---|---|---|
| **Deaf** | Signing to the camera (Indian Sign Language, read on your phone), typing, picking signs, video messages | Text, plus every message played as ISL sign videos; voice notes written out; screen flashes and vibration |
| **Blind** | Talking: "Hey Chat, tell Priya I'm on my way" works on every screen | Every message read aloud (who sent it, and how: "Priya signed…"), photos described, spoken call alerts |
| **Non-speaking** | Tapping a picture phrase board (AAC), typing, or sending your words as a natural voice message | Text, read aloud if you like |
| **Hearing (talk & type)** | Typing or talking, as in any chat | Messages, with a label showing how they were made ("Signed in ISL · HELLO · HOW ARE YOU") |

Every message is also **translated** into the reader's language (11 Indian languages), with the original underneath.

## Features

- **Chat** (direct and group): text, photos, files, voice notes, video messages, replies, edits, delete for everyone, reactions, read receipts, typing indicator, online status, search, block and report.
- **Voice and video calls with live captions:** speech becomes captions for a deaf person, shown as signs too; a deaf person's signs on camera become captions, read aloud for the other person; non-speaking people answer with quick taps that are spoken. Live translation between languages on calls.
- **Face to face (Go mode):** one phone between two people, interpreting both ways. Their half faces them (upside down on a phone), with a big Speak button and a keyboard, so the other person needs no app.
- **Sign reader (on the device):** MediaPipe hand and body tracking, then a sign model trained on the INCLUDE ISL dataset (263 everyday words). It scores 97.8% on held-out signs seen through a laptop camera, and asks "Did you sign…?" when it's unsure instead of guessing.
- **Blind voice assistant:** "Hey Chat" on every screen (messages, calls, groups, contacts, settings), asks "which one?" when two contacts share a name, and has a big Tap to speak button and the Space key.
- **Other on-device AI:** voice notes written out (Whisper), photo descriptions (Florence-2) and an optional natural voice (Kokoro). Audio and video never leave the phone.
- **Accessibility for everyone:** text size, high contrast, light and dark, screen reader labels, vibration patterns, flash alerts, installable app (PWA) with push notifications, including "… is calling you" when the app is closed.

## How Nexconn is used

| Nexconn | Where |
|---|---|
| **Chat SDK** `NCEngine.initialize` / `connect` | One connection per signed-in person (`src/nexconn.ts`) |
| `DirectChannel` / `GroupChannel` `sendMessage`, `sendMediaMessage` | Text, photos, files, HD voice notes, video messages |
| Message `extra` | How a message was made (signed, spoken, tapped), with the signs, so each reader gets it their own way |
| Reference messages, `updateMessage`, `deleteMessageForAll`, message metadata | Replies, edits, delete for everyone, reactions |
| Read receipts, typing status, `userModule.subscribeEvent` | Ticks, "typing…", online dots |
| Custom non-stored message type `anyway:caption` | Live call captions, signs and translations between the two phones |
| `createChannelsQuery` / `createMessagesQuery` | Chat list with unread counts, history |
| **Call SDK** `NCCallEngine` | 1-to-1 voice and video calls, 640×480 adaptive video, weak-connection warning |
| **Platform Chat API** | Access tokens (App Secret stays on the server), group create/join/leave, blocklist, server-sent messages for the demo friends |

## Privacy and security

- Sign reading, voice notes to text, photo descriptions and the natural voice all run **on the phone**. Camera and microphone data is never uploaded.
- With `DATA_KEY` set, everything the server stores is **encrypted at rest** (AES-256-GCM). Passwords are scrypt hashes; login sessions are stored only as SHA-256 hashes.
- Every change to stored data runs under a lock, so many people signing up at once (a school class) can't overwrite each other.

## Architecture

```text
 Deaf: signs ─┐                                   ┌─ text + ISL sign videos
 Blind: voice ─┤   on-device AI (sign reader,     ├─ read aloud, photos described
 Non-speaking ─┤   speech, Whisper, Florence-2)   ├─ text, spoken for you
 Hearing: type ┘              │                    └─ text, "signed / spoken / tapped"
                              ▼
               message + how it was made (extra)
                              │
             Nexconn Chat SDK / Call SDK (real time)
                              │
     Node API on Vercel: accounts, tokens, groups (Upstash Redis, encrypted)
```

## Run locally

Needs Node 20+ and a Nexconn app (free plan).

```bash
git clone https://github.com/sakthilildih/AnyWay-Chat.git
cd AnyWay-Chat
npm install
cp .env.example .env.local   # add your Nexconn App Key and App Secret
npm run dev
```

Open http://localhost:5173. Accounts are saved in `data/db.json` locally, or in Upstash Redis when `KV_REST_API_URL` / `KV_REST_API_TOKEN` are set (Vercel).

| Setting | What it does |
|---|---|
| `VITE_NEXCONN_APP_KEY`, `NEXCONN_APP_SECRET` | Nexconn app (the secret stays on the server) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis storage (added by Vercel) |
| `DATA_KEY` | Encrypts stored data. Keep it safe: without it, stored data can't be read |
| `ADMIN_KEY` | Unlocks user management on `/admin` (locked on the live site without it) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Push notifications |

`/admin` shows live usage numbers and reviews (no names or personal data).

## Built during the challenge

Everything here was built for the Nexconn Build Challenge 2026, starting Nov 15, 2026. ISL sign videos and training data: the INCLUDE dataset by AI4Bharat (CC BY 4.0).

Made in India. Built for everyone.
