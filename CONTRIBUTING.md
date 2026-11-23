# Contributing to AnyWay Chat

Thank you for helping. AnyWay Chat lets people who are deaf, blind or can't speak, and older people losing their sight or hearing, talk with anyone, each in their own way. Every contribution should make that easier for real people.

You don't need to write code to help:

| You are | You can help by |
| --- | --- |
| A developer | Fixing bugs, building roadmap items, adding tests |
| Deaf or an ISL user | Testing the sign reader, recording sign examples, checking sign videos are right |
| Blind or low-vision | Testing "Hey Chat", screen reader labels and the spoken flow |
| Non-speaking, or an AAC user or therapist | Improving the picture phrase board and its phrases |
| A translator | Checking translations and app text in Indian languages |
| A designer | Making screens simpler, clearer and higher contrast |

## Before you start

1. Read [ACCESSIBILITY.md](ACCESSIBILITY.md). Every change must keep the app usable for every way of talking.
2. Look at [open issues](https://github.com/Anywaychat/AnyWay-Chat/issues) and [ROADMAP.md](ROADMAP.md). Issues labelled `good first issue` are a good place to begin.
3. For anything bigger than a small fix, open an issue first and describe what you want to change, so nobody's work is wasted.

## Set up the project

Needs Node 20+ and a free Nexconn app (from the Nexconn Console).

```bash
git clone https://github.com/Anywaychat/AnyWay-Chat.git
cd AnyWay-Chat
npm install
cp .env.example .env.local   # add your own Nexconn App Key and App Secret
npm run dev
```

Open http://localhost:5173. Accounts are saved in `data/db.json` on your computer. Never commit `.env.local` or `data/`.

If `npm install` warns that install scripts for `sharp` or `protobufjs` were not run, that's fine: the web app doesn't need them (`sharp` is only used by the AI library when it runs in Node, which AnyWay never does).

The fastest way to try every mode is http://localhost:5173/try, which makes a guest account with three demo friends.

## Project layout

| Path | What's there |
| --- | --- |
| `src/screens/` | Pages: chats, chat, calls, profile, face to face (Go mode), sign lab, admin |
| `src/components/` | Shared parts: sign camera, call captions, voice notes, language menu |
| `src/nexconn.ts`, `src/useChat.ts`, `src/calls.ts` | Nexconn Chat SDK and Call SDK |
| `src/sign.ts`, `src/workers/` | The on-device ISL sign reader and other on-device AI |
| `src/speech.ts`, `src/voiceIntents.ts` | Speech and "Hey Chat" commands |
| `server/api.ts` | The Node API: accounts, tokens, groups, translation |
| `tests/` | Automated tests (Vitest) |

## Making a change

1. Fork the repository and create a branch: `git checkout -b fix/short-description`.
2. Keep the change focused on one thing.
3. Run the checks before you push:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```

4. Test your change in the modes it touches (deaf, blind, can't speak, talk & type), on a phone-sized screen as well as a laptop.
5. Open a pull request that says what changed, why, and how you tested it. Add screenshots for visual changes.

## Pull request checklist

- [ ] Typecheck, lint, tests and build pass
- [ ] New logic has tests where it can
- [ ] Works with a screen reader (labels, focus order) and by keyboard
- [ ] Text is plain and short; nothing important is shown only by colour or only by sound
- [ ] No camera, microphone or personal data leaves the device unless the feature clearly needs it
- [ ] No secrets, keys or personal data in the code or commits

## Writing style

- Plain, everyday words. The app is used by people of all ages and reading levels.
- Name things by what they do for the person ("Read my messages"), not by how they work.
- Be honest in the UI and docs: don't claim a feature works if it doesn't yet.

## Licence

By contributing, you agree that your contribution is released under the [GNU GPL-3.0](LICENSE), the same licence as the project.

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md) in every issue, pull request and discussion.
