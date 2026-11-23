# Roadmap

This page separates what **works today** from what is **planned**. We don't promise planned features until they are built and tested.

Want to help with something? Comment on its issue, or open one, before you start.

## Works today

**Every way of talking**
- Deaf: sign to the camera (Indian Sign Language, one sign at a time, 263 everyday words, read on the device), type, or send video messages; every message received is also played as ISL sign videos
- Blind: "Hey Chat" voice control on every screen, every message read aloud with who sent it and how, photos described
- Can't speak: a picture phrase board (AAC) that says phrases out loud, typing, and typed words sent as voice
- Talk & type: a normal chat, with each message labelled with how it was made
- Older people: text up to Huge, high contrast, messages read aloud, live captions on calls

**Chat and calls (Nexconn Chat SDK and Call SDK)**
- Direct and group chats: text, photos, files, voice notes, video messages, replies, edits, delete for everyone, reactions, read ticks, typing, online status, search, block and report
- One-to-one voice and video calls with live captions both ways, sign reading on camera and quick spoken replies
- Translation of messages, voice notes and call captions between 11 languages
- Face to face (Go mode): one phone between two people interprets both ways

**Getting started**
- One-tap guest accounts with three demo friends, "Things to try" for each mode, and a QR code to call yourself from your phone
- Installable web app (PWA) with call notifications
- Delete my account, an age question at sign-up, and limits on wrong-password attempts

## Next (help wanted)

| Area | What we want to build |
| --- | --- |
| Sign language | Read short sign sentences, not just single signs; fingerspelling; more signers and lighting in the training data; more words |
| Phones | More reliable always-on "Hey Chat" on Android and iPhone |
| Testing | End-to-end tests for every mode on real phones; screen reader test runs (TalkBack, VoiceOver, NVDA) |
| Languages | Interface text in Indian languages, not only translated messages |
| AAC | Phrase boards people can edit, share, and use in their own language |
| Calls | Group calls with captions |

## Later

- Other sign languages besides ISL
- Native Android and iOS apps
- Tools for organisations: counter tablets in Go mode for hospitals, banks and offices; team plans for schools and workplaces
- An API so other apps can add sign reading and captions

## How items move

Ideas start as issues. Maintainers label them `planned`, `help wanted` or `good first issue`. When a pull request is merged and tested, the item moves to **Works today** above. See [GOVERNANCE.md](GOVERNANCE.md).
