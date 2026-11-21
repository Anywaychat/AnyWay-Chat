import { describe, expect, it } from 'vitest'
import { classify } from '../src/voiceIntents.ts'

// "Hey Chat" commands: the contact's name is replaced by {name} before matching.
describe('Hey Chat understands what blind users say', () => {
  it.each([
    ['read my messages', 'read'],
    ['what did I miss', 'unread'],
    ['any new messages?', 'unread'],
    ['call {name}', 'call'],
    ['video call {name}', 'videoCall'],
    ['pick up', 'answer'],
    ['hang up', 'end'],
    ['mute my mic', 'mute'],
    ['who is online', 'online'],
    ['is {name} online', 'isOnline'],
    ['list my chats', 'list'],
    ['speak slower', 'slower'],
    ['stop talking', 'stopTalking'],
    ['what time is it', 'time'],
    ['log me out', 'logout'],
    ['what can I say', 'help'],
    ['open settings', 'profile'],
    ['face to face', 'go'],
  ])('"%s" -> %s', (said, intent) => {
    expect(classify(said)?.intent).toBe(intent)
  })

  it('keeps the message after "tell {name}"', () => {
    const m = classify("tell {name} I'm on my way")
    expect(m?.intent).toBe('send')
    expect(m?.rest).toBe('i am on my way')
  })

  it('copes with filler words and contractions', () => {
    expect(classify('hey um could you please read my messages')?.intent).toBe('read')
    expect(classify("what's the time")?.intent).toBe('time')
  })

  it('copes with a slightly misheard word', () => {
    expect(classify('read my messeges')?.intent).toBe('read')
  })

  it('returns nothing for silence', () => {
    expect(classify('')).toBeNull()
    expect(classify('   ')).toBeNull()
  })
})
