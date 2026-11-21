import type { Mode } from './state'

/** "Things to try": what someone trying AnyWay for the first time (a judge, a teacher) should do in each way of talking. */
export type Step = { key: string; title: string; how: string; to?: string; pair?: boolean }

/** Three things that show off each way of talking, for someone trying AnyWay for the first time (a judge, a teacher). */
export const STEPS: Record<Mode, Step[]> = {
  deaf: [
    { key: 'sign', title: 'Sign a message', how: 'Open Arjun’s chat, raise your hands and sign HELLO. He is blind, so AnyWay reads your signs to him.', to: '/chat/demoarjun' },
    { key: 'watch', title: 'See words as signs', how: 'Every message you get plays in Indian Sign Language. Open Meera’s chat.', to: '/chat/demomeera' },
    { key: 'call', title: 'Call yourself from your phone', how: 'Talk on the phone and read live captions here.', pair: true },
  ],
  blind: [
    { key: 'hear', title: 'Hear a message', how: 'Open Priya’s chat. AnyWay reads it aloud and says how it was made: Priya signed it.', to: '/chat/demopriya' },
    { key: 'talk', title: 'Send by talking', how: 'Say “Hey Chat, tell Meera I’m on my way”. Or press Space, then speak.' },
    { key: 'call', title: 'Call yourself from your phone', how: 'Hear the other side and answer by voice.', pair: true },
  ],
  speech: [
    { key: 'tap', title: 'Tap to talk', how: 'Open Priya’s chat and tap a picture phrase. AnyWay says it out loud and sends it.', to: '/chat/demopriya' },
    { key: 'go', title: 'Talk face to face', how: 'One phone between two people: it speaks your taps and writes out what they say.', to: '/go' },
    { key: 'call', title: 'Call yourself from your phone', how: 'Your taps are spoken in the call.', pair: true },
  ],
  standard: [
    { key: 'signed', title: 'See how Priya signed', how: 'Her message shows the signs she made. Reply, and she sees your words as signs.', to: '/chat/demopriya' },
    { key: 'blind', title: 'Message Arjun', how: 'He is blind: AnyWay reads your message to him and types out his spoken reply.', to: '/chat/demoarjun' },
    { key: 'call', title: 'Call yourself from your phone', how: 'Choose “deaf” on the phone and watch your words arrive as captions and signs.', pair: true },
  ],
}
export const SHORT: Record<Mode, string> = { deaf: 'Deaf', blind: 'Blind', speech: 'Can’t speak', standard: 'Talk & type' }
export const AS: Record<Mode, string> = { deaf: 'a deaf person who signs', blind: 'a blind person', speech: 'someone who can’t speak', standard: 'someone who talks and types' }
