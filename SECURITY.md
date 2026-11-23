# Security Policy

AnyWay Chat is used by people with disabilities to talk with family, friends, doctors and colleagues. Their safety and privacy matter to us.

## Reporting a vulnerability

**Please don't report security problems in public issues.**

Report them privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to [this form](https://github.com/Anywaychat/AnyWay-Chat/security/advisories/new).

Please include:
- what the problem is and where (page, API route or file)
- steps to reproduce it
- what an attacker could do with it

We will reply within 7 days, keep you updated, and credit you when the fix is released, unless you'd rather stay anonymous. Please give us reasonable time to fix the problem before you share it publicly.

## What we especially care about

- Anyone reading or sending messages as someone else
- Leaks of personal data: names, usernames, contacts, messages, voice or video
- Camera or microphone data leaving the device when it shouldn't
- Ways to get Nexconn tokens for another person, or to find the App Secret
- Ways to lock out or take over accounts

## How the app protects people

- Sign reading, speech to text, photo descriptions and the natural voice run on the device; camera and microphone data is not uploaded.
- The Nexconn App Secret stays on the server; the browser only gets short-lived access tokens.
- With `DATA_KEY` set, stored data is encrypted at rest (AES-256-GCM). Passwords are scrypt hashes, and logins are stored only as SHA-256 hashes.
- Guest accounts are rate-limited per network address and removed after 14 days unless kept.

## Supported versions

Only the latest version on the `main` branch (the live app) receives security fixes.

## For contributors

Never commit secrets: `.env.local`, API keys, tokens, passwords or user data. If you commit one by mistake, tell the maintainers straight away so it can be rotated.
