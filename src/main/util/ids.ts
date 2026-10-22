import { randomBytes } from 'node:crypto'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** 短 id：默认 10 字符，够用且省体积 */
export function id(len = 10): string {
  const buf = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[buf[i] % ALPHABET.length]
  return out
}

export function nowId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${id(4)}`
}
