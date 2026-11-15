# AnyWay — Communication Without Barriers

**What if anyone could communicate with anyone, regardless of how they see, hear, or speak?**

AnyWay is an accessibility-first communication platform designed to bridge communication gaps between people with different abilities.

A blind person should be able to have a conversation without needing someone to read their screen. A deaf person should be able to communicate with someone who has never learned sign language. A non-speaking person should be able to express themselves without depending on another person.

**AnyWay makes different communication methods work together in a single conversation.**

Built for the **Nexconn Build Challenge 2026 — Humanitarian & Social Good Track.**

---

## The Vision

Communication platforms are built around assumptions: people can see screens, hear voices, speak, or type.

Millions of people do not interact with technology in these ways.

Existing accessibility solutions often work independently, leaving people to depend on intermediaries or switch between specialized tools to communicate.

We believe communication should adapt to people, not the other way around.

AnyWay aims to build a unified communication layer that translates between different ways of interacting with the world.

## How It Works

Every participant chooses how they want to communicate. AnyWay handles the communication layer between them.

| User | Input | Output |
|---|---|---|
| Blind | Voice | Audio responses |
| Deaf | Sign language | Text and visual responses |
| Non-speaking | Text / Quick phrases | Text or audio |
| Deaf-blind | Braille / Tactile input | Braille and haptic feedback |
| Standard | Text / Voice | Text / Voice |

The central idea: **Two people should never need the same communication abilities to have a conversation.**

## Current Implementation

The current prototype establishes the foundation for this vision.

- **Adaptive chat interfaces:** Different experiences based on communication profiles.
- **Real-time messaging:** Direct conversations powered by Nexconn.
- **Multiple user profiles:** Blind, deaf, non-speaking, deaf-blind and standard users.
- **Message metadata:** Communication mode information travels alongside messages.
- **Chat history:** Previous conversations can be retrieved.
- **Accessibility-first UI:** High contrast, readable typography, keyboard accessibility and larger touch targets.

### Demo Profiles

| Profile | Communication mode |
|---|---|
| Arjun | Blind |
| Priya | Deaf |
| Meera | Non-speaking |
| Kavin | Deaf-blind |
| Amma | Standard |

## Architecture

```text
             PARTICIPANTS
                  |
       +----------+----------+
       |          |          |
     Voice      Text       Sign
       |          |          |
       +----------+----------+
                  |
          ANYWAY INTERFACE
                  |
          COMMUNICATION LAYER
                  |
             NEXCONN SDK
                  |
          REAL-TIME DELIVERY
                  |
          RECEIVER ADAPTATION
                  |
       +----------+----------+
       |          |          |
     Audio      Text      Tactile
       |          |          |
       +----------+----------+
                  |
          OTHER PARTICIPANT
```

The architecture separates message transport from user interaction, allowing new accessibility interfaces to be introduced without rebuilding the messaging infrastructure.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Communication | Nexconn Chat SDK |
| Real-time engine | Nexconn Engine SDK |
| Backend | Node.js |
| UI | Custom accessible components |
| Typography | Atkinson Hyperlegible |

### Nexconn Integration

Nexconn powers the real-time communication infrastructure.

- `NCEngine.initialize()` — Initialize the communication engine.
- `NCEngine.connect()` — Connect participants.
- `DirectChannel.sendMessage()` — Send messages.
- `MessageHandler.onMessageReceived()` — Receive messages in real time.
- `BaseChannel.createMessagesQuery()` — Retrieve conversation history.
- Platform Chat API — Issue user access tokens securely.

The App Secret remains server-side. The browser receives user access tokens instead.

## Roadmap

Our long-term goal is to make AnyWay a unified communication platform across sensory and interaction modalities.

- [ ] Speech-to-text and natural text-to-speech.
- [ ] Indian Sign Language recognition.
- [ ] Sign language responses and animations.
- [ ] Voice and video calls with accessibility support.
- [ ] Braille-based communication.
- [ ] Haptic communication for deaf-blind users.
- [ ] Face-to-face communication through Go Mode.
- [ ] Support for additional sign languages.

## Run Locally

### Prerequisites

- Node.js 20+
- Nexconn developer account

### Installation

```bash
git clone https://github.com/sakthilildih/AnyWay-Chat.git

cd AnyWay-Chat

npm install

cp .env.example .env.local
```

Configure your Nexconn credentials in `.env.local`.

```bash
npm run dev
```

Open `http://localhost:5173`.

### Try the Prototype

Open two browser windows.

**Standard user (Amma), chatting with Priya:**

```text
http://localhost:5173/chat/priya?mode=standard
```

**Deaf user (Priya), chatting with Amma:**

```text
http://localhost:5173/chat/amma?mode=deaf
```

Send messages between the two sessions to explore the adaptive communication experience.

## Project Structure

```text
src/
├── screens/
├── nexconn.ts
├── useChat.ts
├── state.tsx
└── landing.html

public/
.env.example
vite.config.ts
```

## Our Belief

We don't believe accessibility should be an additional feature in communication software.

It should be part of the infrastructure itself.

**AnyWay is building towards a world where the way you communicate never determines who you can communicate with.**

Made in India. Built for everyone.
