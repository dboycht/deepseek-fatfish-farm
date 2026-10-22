import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scoreCards, tokenize } from '../src/shared/recall'
import { flavorFromSeed, levelFromExp, moodWord, personaFromSeed } from '../src/shared/persona'
import { buildMessages, parseStickerToken } from '../src/main/llm/prompt'
import {
  extractStickerDirectives,
  normalizeWishKey,
  stickerSrc,
  validateStickerManifest
} from '../src/shared/stickers'
import type { ChatMessage, FishProfile } from '../src/shared/types'
import {
  defaultConfig,
  migrateV1,
  modelForRoute,
  normalizeConfig,
  providerForRoute,
  sanitizeRef
} from '../src/shared/config'
import {
  decodeCredentialValue,
  encodeCredentialValue,
  isCredentialRef,
  parseCredentialDocument,
  resolveCredentialFromSources,
  serializeCredentialDocument
} from '../src/main/credentials-file'
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

/* ------------------------------------------------------------------ *
 * 配置 v2 / 凭据（DSH 风格）
 * ------------------------------------------------------------------ */

test('配置 v2：默认值完整，坏值会被夹紧', () => {
  const def = defaultConfig('/pond')
  assert.equal(def.v, 2)
  assert.ok(def.providers.length >= 1)
  assert.equal(def.routes.text.providerId, def.providers[0].id)
  assert.equal(def.mode, 'api')

  const cfg = normalizeConfig(
    {
      providers: [{ id: 'X Y', name: '', baseUrl: 'https://a.example/v1/', apiKeyEnv: 'bad ref!' }],
      routes: { text: { providerId: 'nope', temperature: 9, maxTokens: 99999, timeoutMs: 1 } },
      memory: { every: 999, recall: 999 },
      mode: 'what'
    },
    '/fallback'
  )
  assert.equal(cfg.providers[0].id, 'x-y')
  assert.equal(cfg.providers[0].baseUrl, 'https://a.example/v1')
  assert.ok(isCredentialRef(cfg.providers[0].apiKeyEnv))
  assert.equal(cfg.routes.text.providerId, cfg.providers[0].id)
  assert.ok(cfg.routes.text.temperature <= 2)
  assert.ok(cfg.routes.text.maxTokens <= 8192)
  assert.ok(cfg.routes.text.timeoutMs >= 10_000)
  assert.ok(cfg.memory.every <= 40)
  assert.ok(cfg.memory.recall <= 20)
  assert.equal(cfg.mode, 'api')
  assert.equal(cfg.pondRoot, '/fallback')
})

test('v1 → v2 迁移：同 URL 复用 provider，独立视觉密钥另建', () => {
  const legacy = {
    pondRoot: '/p',
    onboarded: true,
    provider: {
      mode: 'api' as const,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      temperature: 1.2,
      maxTokens: 2000,
      vision: { enabled: true, baseUrl: 'https://vision.example/v1', model: 'vl-1' },
      image: { enabled: true, baseUrl: 'https://api.deepseek.com', model: 'img-1', size: '512x512' }
    }
  }
  const res = migrateV1(legacy, { text: 'sk-text', vision: 'sk-vision', image: 'sk-image' }, '/fallback')
  assert.equal(res.config.pondRoot, '/p')
  assert.equal(res.config.onboarded, true)
  assert.equal(res.config.providers.length, 3)
  assert.equal(res.credentials.DEEPSEEK_API_KEY, 'sk-text')
  assert.equal(res.credentials.VISION_API_KEY, 'sk-vision')
  assert.equal(res.credentials.IMAGE_API_KEY, 'sk-image')
  assert.equal(res.config.routes.vision.enabled, true)
  assert.equal(res.config.routes.vision.providerId, 'vision')
  assert.equal(res.config.routes.image.providerId, 'image')
  assert.equal(res.config.routes.text.model, 'deepseek-chat')
})

test('v1 → v2 迁移：同 URL 同密钥时复用，不重复建 provider', () => {
  const legacy = {
    provider: {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      vision: { enabled: true, model: 'deepseek-vl' },
      image: { enabled: true, model: 'deepseek-image' }
    }
  }
  const res = migrateV1(legacy, { text: 'sk-same' }, '/fallback')
  assert.equal(res.config.providers.length, 1)
  assert.equal(res.config.routes.vision.providerId, res.config.providers[0].id)
  assert.equal(res.config.routes.image.providerId, res.config.providers[0].id)
  assert.equal(res.credentials.DEEPSEEK_API_KEY, 'sk-same')
})

test('凭据文件：解析/序列化保持 DSH 形状，坏引用被忽略', () => {
  const text = `version: 1
refs:
  DEEPSEEK_API_KEY: sk-abc
  BAD-REF: x
  lower_key: y
records: []
`
  const doc = parseCredentialDocument(text)
  assert.deepEqual(Object.keys(doc.refs), ['DEEPSEEK_API_KEY'])
  assert.equal(doc.refs.DEEPSEEK_API_KEY, 'sk-abc')
  assert.equal(doc.version, 1)

  const out = serializeCredentialDocument(doc)
  assert.match(out, /refs:/)
  assert.match(out, /DEEPSEEK_API_KEY/)
  assert.match(out, /records:/)
  assert.deepEqual(parseCredentialDocument(out), doc)
})

test('凭据解析：refs 优先于环境变量，缺失时 undefined', () => {
  assert.deepEqual(resolveCredentialFromSources('store-key', { K: 'env-key' }, 'K'), {
    value: 'store-key',
    source: 'store'
  })
  assert.deepEqual(resolveCredentialFromSources(null, { K: 'env-key' }, 'K'), {
    value: 'env-key',
    source: 'env'
  })
  assert.equal(resolveCredentialFromSources('', {}, 'K'), undefined)
})

test('凭据编解码：加密/明文回退都能还原，引用名可规范化', () => {
  const enc = encodeCredentialValue('sk-test', (v) => Buffer.from(`x${v}`).toString('base64'))
  assert.ok(enc.startsWith('enc:v1:'))
  const dec = decodeCredentialValue(enc, (c) => {
    const s = Buffer.from(c, 'base64').toString('utf8')
    return s.startsWith('x') ? s.slice(1) : null
  })
  assert.equal(dec, 'sk-test')

  const raw = encodeCredentialValue('sk-plain', () => null)
  assert.ok(raw.startsWith('raw:v1:'))
  assert.equal(decodeCredentialValue(raw, () => null), 'sk-plain')

  assert.equal(sanitizeRef('my key!', 'FALLBACK'), 'MY_KEY')
  assert.equal(sanitizeRef('9lives', 'FALLBACK'), 'KEY_9LIVES')
  assert.equal(sanitizeRef('', 'FALLBACK'), 'FALLBACK')
})

test('路由：provider 丢失时回退第一个，模型丢失时回退 provider 首个模型', () => {
  const cfg = normalizeConfig(
    {
      providers: [
        { id: 'a', baseUrl: 'https://a', apiKeyEnv: 'A_KEY', models: ['a-1'] },
        { id: 'b', baseUrl: 'https://b', apiKeyEnv: 'B_KEY', models: ['b-1'] }
      ],
      routes: { text: { providerId: 'a', model: '' } }
    },
    '/p'
  )
  assert.equal(modelForRoute(cfg, 'text'), 'a-1')
  cfg.routes.text.providerId = 'missing'
  assert.equal(providerForRoute(cfg, 'text')?.id, 'a')
  cfg.routes.text.model = 'a-2'
  assert.equal(modelForRoute(cfg, 'text'), 'a-2')
})

test('贴纸 token：双层与模型偶发的单层方括号都能识别', () => {
  assert.equal(parseStickerToken('好耶 [[fish:joy]]'), 'joy')
  assert.equal(parseStickerToken('好耶 [fish:shy]'), 'shy')
  assert.equal(parseStickerToken('[fish:not-a-sticker]'), null)
  assert.equal(parseStickerToken('没有贴纸'), null)
})

test('贴纸指令：可用/缺失/未知分类，正文被清理', () => {
  const known = new Set(['joy', 'hungry'])
  const d = extractStickerDirectives(
    '好耶 [[sticker:joy]] 和 [fish:hungry] 还有 [[sticker:need:pout]] 和 [[sticker:wtf]]',
    known
  )
  assert.equal(d.sticker, 'joy')
  assert.deepEqual(d.needs, ['pout'])
  assert.deepEqual(d.unknown, ['wtf'])
  assert.ok(!/sticker|fish:/i.test(d.cleaned))
  assert.equal(extractStickerDirectives('只有 [sticker:need:委屈]', known).needs[0], '委屈')
})

test('贴纸需求 key 会被规范化', () => {
  assert.equal(normalizeWishKey('  Pout!!  '), 'pout')
  assert.equal(normalizeWishKey('委屈到变形'), '委屈到变形')
  assert.equal(normalizeWishKey('   '), '')
})

test('贴纸 manifest：合法包通过，冲突/越界/坏 id 被拒', () => {
  const good = validateStickerManifest(
    {
      id: 'my-pack',
      name: '我的贴纸',
      items: [{ id: 'pout', label: '鼓嘴', file: 'pout.png' }]
    },
    new Set(['joy'])
  )
  assert.equal(good.ok, true)
  assert.equal(good.manifest?.items[0].id, 'pout')

  const bad = validateStickerManifest(
    {
      id: 'my-pack',
      name: '坏包',
      items: [{ id: 'joy', label: '冲突', file: '../pout.png' }]
    },
    new Set(['joy'])
  )
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some((e) => e.includes('冲突')))
  assert.ok(bad.errors.some((e) => e.includes('..')))

  const noItems = validateStickerManifest({ id: 'x-pack', name: '空', items: [] }, new Set())
  assert.equal(noItems.ok, false)
})

test('贴纸 URL 会做编码', () => {
  assert.equal(stickerSrc('my-pack', 'a b/萌.png'), 'fatfish-sticker://my-pack/a%20b/%E8%90%8C.png')
})

test('提示词：当前用户消息不会在历史里出现两次', () => {
  const profile: FishProfile = {
    v: 1,
    id: 'fish-1',
    name: '小肥',
    tagline: '测试鱼',
    created: 0,
    updated: 0,
    hue: 205,
    seed: 1,
    flavor: { phrase: '嚼嚼嚼', food: '白米饭', quirk: '数气泡', nick: '本鱼' },
    persona: { appetite: 60, clingy: 50, tsundere: 50, mischief: 50, laziness: 50, sleepy: 50 },
    stats: { mood: 70, hunger: 30, tokens: 0, meals: 0, chats: 0, memories: 0, level: 1, exp: 0, lastSeen: 0 }
  }
  const history: ChatMessage[] = [
    { id: 'u0', role: 'u', t: 1, text: '之前的话' },
    { id: 'a0', role: 'a', t: 2, text: '之前的回复' },
    // 模拟 bug 场景：当前用户消息已经落盘，又在 currentText 里传入一次
    { id: 'u1', role: 'u', t: 3, text: '现在好像还没什么，你是谁' }
  ]
  const out = buildMessages({
    profile,
    config: defaultConfig('/pond'),
    history,
    currentText: '现在好像还没什么，你是谁',
    currentUserMsgId: 'u1',
    currentImages: [],
    hits: [],
    now: new Date('2026-10-22T12:00:00Z'),
    visionEnabled: false,
    captionOf: () => undefined,
    drawEnabled: false
  })
  const userTexts = out
    .filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n')
  const occurrences = userTexts.split('现在好像还没什么，你是谁').length - 1
  assert.equal(occurrences, 1, '当前用户消息只能出现一次')
  assert.ok(out.some((m) => m.role === 'assistant' && String(m.content).includes('之前的回复')))
})
