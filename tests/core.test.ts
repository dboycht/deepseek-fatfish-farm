import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scoreCards, tokenize } from '../src/shared/recall'
import { flavorFromSeed, levelFromExp, moodWord, personaFromSeed } from '../src/shared/persona'
import { readGzJSON, readJSON, writeGzJSON, writeJSON } from '../src/main/util/fsx'
import type { MemoryCard } from '../src/shared/types'

const now = Date.UTC(2026, 9, 22, 12, 0, 0)
const DAY = 86_400_000

function card(patch: Partial<MemoryCard> = {}): MemoryCard {
  return {
    id: 'c1',
    t: now - 3 * DAY,
    kind: 'event',
    text: 'User sent a photo of a bowl of white rice at night.',
    tags: ['rice', 'photo', '白米饭'],
    src: ['m1'],
    salience: 6,
    hit: 0,
    ...patch
  }
}

test('tokenize 中英混排：英文按词、中文按二元组，并去重', () => {
  const t = tokenize('白米饭 rice RICE 好吃')
  assert.ok(t.includes('rice'))
  assert.ok(t.includes('白米'))
  assert.ok(t.includes('米饭'))
  assert.ok(t.includes('好吃'))
  assert.equal(t.filter((x) => x === 'rice').length, 1)
  assert.equal(tokenize('').length, 0)
})

test('检索：相关的中文/英文记忆排在前面', () => {
  const cards = [
    card({ id: 'rice' }),
    card({
      id: 'code',
      text: 'User debugged a Python KeyError in the evening.',
      tags: ['python', 'code', 'bug'],
      t: now - 1 * DAY
    }),
    card({ id: 'coffee', text: 'User loves iced americanos.', tags: ['coffee', 'pref'] })
  ]
  const scored = scoreCards(cards, '上次那张白米饭的照片', { now }).sort((a, b) => b.score - a.score)
  assert.equal(scored[0].card.id, 'rice')
  assert.ok(scored[0].rel > 0.5, `rel 应该足够高，实际 ${scored[0].rel}`)
  assert.ok(scored[0].score > scored[1].score + 0.2, '应该明显领先，而不是险胜')
})

test('检索：长句里的噪声词不会稀释相关记忆', () => {
  const cards = [card({ id: 'rice' }), card({ id: 'other', text: 'User likes cats.', tags: ['cat'] })]
  const longQuery = '今天真的好累啊，写着写着突然想起你上次给我看的那张白米饭的照片，有点饿了'
  const scored = scoreCards(cards, longQuery, { now }).sort((a, b) => b.score - a.score)
  assert.equal(scored[0].card.id, 'rice')
  assert.ok(scored[0].rel > 0.8, `长句归一化后仍应接近 1，实际 ${scored[0].rel}`)
})

test('检索：图片线索会加权，钉选会加权', () => {
  const query = '那张图'
  const plain = card({ id: 'p', img: undefined, hit: 0 })
  const withImg = card({ id: 'i', img: ['media1'], hit: 0 })
  const pinned = card({ id: 'pin', pin: true, hit: 0 })
  const scored = scoreCards([plain, withImg, pinned], query, { now }).sort((a, b) => b.score - a.score)
  const byId = Object.fromEntries(scored.map((s) => [s.card.id, s.score]))
  assert.ok(byId.i > byId.p, '有图的卡片应该更高')
  assert.ok(byId.pin > byId.p, '钉选卡片应该更高')
})

test('检索：同样相关时，新记忆优先', () => {
  const older = card({ id: 'old', t: now - 200 * DAY })
  const newer = card({ id: 'new', t: now - 1 * DAY })
  const scored = scoreCards([older, newer], 'white rice', { now }).sort((a, b) => b.score - a.score)
  assert.equal(scored[0].card.id, 'new')
})

test('检索：完全无关的记忆相关度为 0', () => {
  const cards = [card({ id: 'rice' })]
  const scored = scoreCards(cards, '量子色动力学', { now })
  assert.equal(scored[0].rel, 0)
})

test('性格与风味：同一种子稳定、不同种子不同', () => {
  const a1 = flavorFromSeed(12345, '小肥')
  const a2 = flavorFromSeed(12345, '小肥')
  assert.deepEqual(a1, a2)
  const b = flavorFromSeed(99999, '小肥')
  assert.notDeepEqual(a1, b)
  const p = personaFromSeed(12345)
  for (const v of Object.values(p)) {
    assert.ok(v >= 28 && v <= 90, `性格值应在 28..90，实际 ${v}`)
  }
})

test('等级曲线单调递增，0 经验是 1 级', () => {
  assert.equal(levelFromExp(0), 1)
  let last = 0
  for (let exp = 0; exp < 5000; exp += 137) {
    const lv = levelFromExp(exp)
    assert.ok(lv >= last)
    last = lv
  }
  assert.ok(levelFromExp(100_000) > 10)
})

test('状态词：饿优先于心情', () => {
  assert.equal(moodWord(90, 85), '饿得咕咕叫')
  assert.equal(moodWord(10, 10), '蔫蔫的')
  assert.equal(moodWord(90, 10), '尾巴摇得飞快')
})

test('落盘：gzip 往返一致，且重复内容压缩率足够低', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fatfish-test-'))
  try {
    const value = {
      v: 1,
      cards: Array.from({ length: 40 }, (_, i) =>
        card({
          id: `c${i}`,
          text: 'User sent a photo of a bowl of white rice at night and felt happy.',
          tags: ['rice', 'photo', 'night']
        })
      )
    }
    const gz = join(dir, 'cards.json.gz')
    await writeGzJSON(gz, value)
    const back = await readGzJSON(gz, { v: 0, cards: [] })
    assert.deepEqual(back, value)

    const { statSync } = await import('node:fs')
    const rawBytes = Buffer.byteLength(JSON.stringify(value))
    const gzBytes = statSync(gz).size
    assert.ok(gzBytes < rawBytes * 0.4, `压缩后应小于原体积 40%，实际 ${gzBytes}/${rawBytes}`)

    const plain = join(dir, 'state.json')
    await writeJSON(plain, { ok: true })
    assert.deepEqual(await readJSON(plain, null), { ok: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
