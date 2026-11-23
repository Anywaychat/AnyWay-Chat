# Privacy

AnyWay Chat is used by people who are deaf, blind or can't speak to talk with family, friends, doctors and colleagues. This page explains, in plain words, what happens to your information in the app at [anywaychat.vercel.app](https://anywaychat.vercel.app). It describes what the code in this repository does.

## What stays on your device

These run inside your browser. AnyWay's own server never receives the camera picture or the sound:

- **Sign reading.** The camera picture is turned into hand and body points and read on your device.
- **Writing out voice notes** (Whisper), **photo descriptions** (Florence-2) and the **natural voice** (Kokoro).
- **Signs you teach the app** in the Sign lab.

## What our server stores

For each account:

- your username, your name, and how you talk (deaf, blind, can't speak, or talk and type)
- your password, only as a scrypt hash (we can't see the password itself)
- your contacts, the nicknames you give them, the people you blocked, and the groups you're in
- your saved picture phrases and your settings (language, voice, text size, alerts)
- your profile photo, if you add one
- when you joined and when you last used the app
- a list of your calls: with whom, when, voice or video, answered or not
- the devices you allowed to get notifications
- reviews you write (and whether your name may be shown), and reports you make

Login sessions are stored only as SHA-256 hashes. The server can encrypt everything it stores with AES-256-GCM (the `DATA_KEY` setting). The data is kept in Upstash Redis, and the app is hosted on Vercel.

## What goes through other services

| Service | What it gets | Why |
| --- | --- | --- |
| **Nexconn** | Your messages, photos, files, voice notes and video messages; the sound and picture of calls while a call is on; your username and name | Delivering messages and calls |
| **Your browser's speech recognition** (Chrome and Edge may use Google's or Microsoft's servers) | What you say while "Hey Chat", dictation or live call captions are listening | Turning speech into text |
| **Google Translate**, with **MyMemory** as a fallback | The text of a message or caption that needs translating | Showing it in your language |
| **Your browser's push service** (Google, Mozilla or Apple) | An encrypted notification it can't read | Telling you about messages and calls when the app is closed |
| **Google Fonts, jsDelivr and Hugging Face** | Your device's network address, when fonts and AI model files are downloaded | Fonts, and the on-device AI |

We don't use advertising, tracking or analytics services, and we don't sell or share your information for marketing.

## What others can see

- **People in the app** can find you by username or name. They see your name, username, how you talk and your photo.
- **The public dashboard** (`/admin`) shows usage numbers and an anonymous list of accounts (how each one talks, when it joined and was last active, how many contacts it has). It never shows names or usernames.
- **Reviews** you write are public. Your name is shown only if you choose.

## Camera and microphone

Your browser asks your permission before the app can use them.

- **Camera:** sign reading in chats (deaf mode), video calls and video messages.
- **Microphone:** "Hey Chat" (in blind mode it listens while the app is open, so you can use it hands-free), dictation, voice notes, calls and live captions.

Your browser shows when the camera or microphone is on. You can take the permission back at any time in your browser's settings.

## How long we keep it

- **Guest accounts** ("Try it now") are deleted after 14 days unless you keep them.
- **Accounts** are kept until they are deleted. To delete your account and everything the server stores about you, contact us (below). A delete button in the app is planned.
- **Messages** are kept by Nexconn as your chat history. "Delete for everyone" removes a message for both people.

## Children

If you are under 18, please use AnyWay only with your parent's or guardian's permission.

## Your choices and questions

You can ask for a copy of your information, ask us to correct or delete it, or report a privacy problem. Contact the maintainers through the [AnyWay Chat organisation on GitHub](https://github.com/Anywaychat). For anything sensitive, use a [private report](https://github.com/Anywaychat/AnyWay-Chat/security/advisories/new).

We'll update this page when the app changes, and the changes are visible in this repository's history.
