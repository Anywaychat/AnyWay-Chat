# Accessibility

Accessibility is not a feature of AnyWay Chat; it is the reason it exists. Every change must keep the app usable for every way of talking.

## Principles

1. **Every message reaches every person.** What one person signs, says, taps or types must reach the other in a form they can use: text, voice, sign language, captions, in their language.
2. **Never only one sense.** Nothing important is shown only by colour, only by sound, or only by vibration. Alerts use sound and vibration and a visible flash.
3. **Blind users never need to see the screen.** Everything can be done by voice ("Hey Chat") or with a screen reader.
4. **Deaf users never need to hear.** Every sound has a visual: captions, flashes and text.
5. **Non-speaking users never need to speak.** Every place that takes speech also takes taps and typing.
6. **Plain and calm.** Short, everyday words; one main action per screen; no time limits that rush people.
7. **Honest.** When the app isn't sure (for example, which sign was made), it asks instead of guessing.
8. **Private by default.** Camera and microphone stay on the device.

## Rules for code

- Use real buttons, links and form fields (not clickable `div`s), with clear labels.
- Every image and icon has alt text or is marked as decorative (`aria-hidden="true"`).
- Keyboard: everything works with Tab, Enter and Space; the focus order follows the screen; focus is visible.
- Announce changes that matter (new message, call status) with live regions.
- Text stays readable from small to *Huge* text size and in high contrast, light and dark.
- Colour contrast is at least 4.5:1 for text (WCAG 2.2 AA).
- Touch targets are at least 44 × 44 px on phones.
- Respect `prefers-reduced-motion`.
- Heavy AI work runs in a background worker so the app never freezes.

## How to test a change

Test the modes your change touches, on a phone-sized screen and a laptop:

| Mode | Check |
| --- | --- |
| Blind | Turn on a screen reader (VoiceOver, TalkBack or NVDA) and do the task without looking. Try it with "Hey Chat" too |
| Deaf | Turn the sound off. Is everything still clear? Do sign videos and captions appear? |
| Can't speak | Do the task without the microphone, using taps and typing |
| Older people | Set text size to Huge and turn on high contrast. Does anything overlap or get cut off? |
| Talk & type | Does it still feel like a normal, simple chat? |

Also run `npm test`. If your change adds a new screen or control, describe in the pull request how you tested it with a screen reader.

## Reporting an accessibility problem

Accessibility bugs are treated as serious bugs. Open an issue that says which mode you use, which device and browser, what you tried to do, and what happened. If you use assistive technology, please name it.
