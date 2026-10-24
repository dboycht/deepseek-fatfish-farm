/**
 * 生成一份演示鱼塘（只用于开发期截图与自测，不随软件分发）。
 * 直接按落盘格式写文件：fish.json / chats/*.json.gz / memory/cards.json.gz / media/*
 */
import { createHash } from 'node:crypto'
import { deflateSync, gzipSync } from 'node:zlib'
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/* ----------------------------- 极简 PNG 编码器 ----------------------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function png(width, height, pixel) {
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y)
      const o = y * stride + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** 画一张「深夜的白米饭」演示图 */
function ricePhoto(w = 720, h = 480) {
  return png(w, h, (x, y) => {
    const u = x / w
    const v = y / h
    // 桌面渐变
    let r = Math.round(18 + 30 * v)
    let g = Math.round(40 + 60 * v)
    let b = Math.round(80 + 90 * v)
    // 碗
    const cx = 0.5 * w
    const cy = 0.62 * h
    const dx = (x - cx) / (0.34 * w)
    const dy = (y - cy) / (0.22 * h)
    const inBowl = dx * dx + dy * dy < 1
    if (inBowl) {
      const top = y < cy - 0.05 * h
      if (top) {
        // 米饭
        const speck = ((x * 37 + y * 91) % 23) / 23
        r = 250 - speck * 14
        g = 246 - speck * 12
        b = 232 - speck * 18
      } else {
        r = 44
        g = 86
        b = 150
      }
    }
    // 暖色灯光
    const lamp = Math.max(0, 1 - Math.hypot(x - 0.72 * w, y - 0.16 * h) / (0.42 * w))
    r = Math.min(255, r + lamp * 90)
    g = Math.min(255, g + lamp * 70)
    b = Math.min(255, b + lamp * 30)
    // 高光条纹
    if (((x + y) % 97) < 2) {
      r = Math.min(255, r + 30)
      g = Math.min(255, g + 30)
      b = Math.min(255, b + 30)
    }
    return [r, g, b, 255]
  })
}

/* --------------------------------- 鱼塘数据 -------------------------------- */

function gz(path, value) {
  writeFileSync(path, gzipSync(Buffer.from(JSON.stringify(value), 'utf8'), { level: 9 }))
}

const baseRoot = (process.env.FATFISH_DEMO_BASE || tmpdir()).trim()
mkdirSync(baseRoot, { recursive: true })
const base = mkdtempSync(join(baseRoot, 'fatfish-demo-'))
const userData = join(base, 'userData')
const pond = join(base, 'pond')
mkdirSync(userData, { recursive: true })
mkdirSync(pond, { recursive: true })

const now = Date.now()
const day = 86_400_000

const fishA = 'xiaofei000001'
const fishB = 'jingjing00002'
const chatA = 'chatmain0001'
const chatA2 = 'chatwork0001'

function profile(id, name, hue, seed, tagline, stats) {
  return {
    v: 1,
    id,
    name,
    tagline,
    created: now - 26 * day,
    updated: now,
    hue,
    seed,
    flavor: {
      phrase: '嚼嚼嚼……',
      food: '温泉蛋拌饭',
      quirk: '会把 token 排成一排再吃',
      nick: '本鱼'
    },
    persona: { appetite: 88, clingy: 64, tsundere: 71, mischief: 58, laziness: 62, sleepy: 47 },
    persona_: undefined,
    stats: { mood: 78, hunger: 52, tokens: 12840, meals: 9, chats: 2, memories: 5, level: 3, exp: 214, lastSeen: now - 3600_000, ...stats }
  }
}

function writeFish(id, prof, chats, cards, media) {
  const dir = join(pond, id)
  mkdirSync(join(dir, 'chats'), { recursive: true })
  mkdirSync(join(dir, 'memory'), { recursive: true })
  mkdirSync(join(dir, 'media'), { recursive: true })
  writeFileSync(join(dir, 'fish.json'), JSON.stringify(prof, null, 2), 'utf8')
  writeFileSync(
    join(dir, 'chats', 'index.json'),
    JSON.stringify({
      chats: chats.map((c) => ({ id: c.id, title: c.title, created: c.created, updated: c.updated, count: c.msgs.length }))
    }),
    'utf8'
  )
  for (const c of chats) gz(join(dir, 'chats', `${c.id}.json.gz`), c)
  gz(join(dir, 'memory', 'cards.json.gz'), { v: 1, cards })
  writeFileSync(
    join(dir, 'memory', 'state.json'),
    JSON.stringify({ chats: { [chats[0].id]: { upTo: chats[0].msgs[chats[0].msgs.length - 1].id, n: chats[0].msgs.length } }, lastDistill: now - 7200_000 }),
    'utf8'
  )
  const items = []
  for (const m of media) {
    writeFileSync(join(dir, 'media', m.src), m.buf)
    items.push({
      id: m.id,
      name: m.name,
      ext: 'png',
      bytes: m.buf.length,
      w: m.w,
      h: m.h,
      thumb: m.src,
      src: m.src,
      kind: 'pic',
      created: now - 4 * day,
      caption: m.caption,
      captionAt: now - 4 * day
    })
  }
  gz(join(dir, 'media', 'index.json.gz'), { items })
}

const photo = ricePhoto()
const mediaId = 'medrice00001'
const photo2 = ricePhoto(480, 480)

const cards = [
  {
    id: 'card000001',
    t: now - 4 * day,
    kind: 'event',
    text: 'User sent a photo of a bowl of white rice at night, said they were pulling an all-nighter on a physics experiment report.',
    tags: ['rice', 'photo', 'physics', 'late-night', '白米饭'],
    src: ['msgA00000003'],
    img: [mediaId],
    salience: 8,
    hit: 2,
    last: now - day
  },
  {
    id: 'card000002',
    t: now - 12 * day,
    kind: 'person',
    text: 'User is a student working on physics experiments; often stays up late and forgets to eat.',
    tags: ['user', 'physics', 'student', 'habit'],
    src: ['msgA00000002'],
    salience: 7,
    hit: 1
  },
  {
    id: 'card000003',
    t: now - 9 * day,
    kind: 'pref',
    text: 'User loves iced americanos and hates cilantro; promised to bring the fish a bowl of rice someday.',
    tags: ['coffee', 'food', 'promise'],
    src: ['msgA00000004'],
    salience: 6,
    hit: 0
  },
  {
    id: 'card000004',
    t: now - 19 * day,
    kind: 'promise',
    text: 'User said they will come back on the weekend to finish the data analysis together.',
    tags: ['weekend', 'plan', 'analysis'],
    src: ['msgA00000005'],
    salience: 5,
    hit: 0
  },
  {
    id: 'card000005',
    t: now - 2 * day,
    kind: 'mood',
    text: 'User sounded tired but cheered up after the fish ate a token; they laughed for the first time that day.',
    tags: ['mood', 'tired', 'laugh'],
    src: ['msgA00000006'],
    salience: 6,
    hit: 1
  }
]

const chatMain = {
  id: chatA,
  title: '深夜的白米饭',
  created: now - 4 * day,
  updated: now - 3600_000,
  count: 6,
  msgs: [
    { id: 'msgA00000001', role: 'a', t: now - 4 * day, text: '（从水草里探出头）你来啦。今天要不要早点睡？', sticker: 'joy' },
    { id: 'msgA00000002', role: 'u', t: now - 4 * day + 60000, text: '还在赶物理实验报告，估计要通宵了' },
    {
      id: 'msgA00000003',
      role: 'u',
      t: now - 4 * day + 120000,
      text: '给你看看我的宵夜',
      imgs: [mediaId]
    },
    {
      id: 'msgA00000004',
      role: 'a',
      t: now - 4 * day + 180000,
      text: '哦——白米饭！<cite id="M1"/> 你上次也是半夜吃这个，说是在赶实验报告。嚼嚼嚼……你多吃点，别只喝咖啡。',
      cite: ['card000001'],
      reason:
        '用户发了一张白米饭的照片。现在是深夜，他之前提过在赶物理实验报告，还说过爱喝冰美式。要不要提醒他别只喝咖啡……唔，这样说应该不会像客服。',
      tok: { i: 1832, o: 96 },
      sticker: 'rice'
    },
    { id: 'msgA00000005', role: 'u', t: now - 3 * day, text: '周末我再来把数据分析做完，顺便给你带饭' },
    {
      id: 'msgA00000006',
      role: 'a',
      t: now - 3 * day + 40000,
      text: '真的吗？那我要留着肚子。<cite id="M2"/> 你上次说的周末计划我还记着呢，别又鸽我。',
      cite: ['card000004'],
      tok: { i: 1620, o: 74 },
      sticker: 'shy'
    }
  ]
}

const chatWork = {
  id: chatA2,
  title: '帮我看看这段代码',
  created: now - 2 * day,
  updated: now - 2 * day,
  count: 2,
  msgs: [
    { id: 'msgB00000001', role: 'u', t: now - 2 * day, text: '这段 Python 为什么一直报 KeyError？' },
    {
      id: 'msgB00000002',
      role: 'a',
      t: now - 2 * day + 30000,
      text: '因为你在 pop 之后又去取那个 key 了。改成先 get 再 pop，或者用 defaultdict。……唔，我讲清楚了吗？',
      reason: '用户问代码问题。这次要认真一点，不能只想着吃饭。KeyError 的常见原因是取不存在的键……',
      tok: { i: 980, o: 120 }
    }
  ]
}

const chatB = {
  id: 'chatb00000001',
  title: '新来的鲸鲸',
  created: now - 2 * day,
  updated: now - 2 * day,
  count: 1,
  msgs: [{ id: 'msgC00000001', role: 'a', t: now - 2 * day, text: '（小心翼翼地游过来）你好……我是新来的。', sticker: 'shy' }]
}

writeFish(
  fishA,
  profile(fishA, '小肥', 205, 482913, '一只住在鱼塘里、见饭眼开的蓝色大肥鱼', {}),
  [chatMain, chatWork],
  cards,
  [
    { id: mediaId, name: '宵夜-白米饭.png', src: `${mediaId}.png`, buf: photo, w: 720, h: 480, caption: 'A warm bowl of white rice on a blue table at night, lit by a desk lamp.' },
    { id: 'medrice00002', name: '夜里的桌子.png', src: 'medrice00002.png', buf: photo2, w: 480, h: 480, caption: 'A close-up of steamed rice with a spoon beside it.' }
  ]
)

writeFish(
  fishB,
  profile(fishB, '鲸鲸', 226, 771204, '刚搬来、还不太敢说话的鲸鱼娘', {
    mood: 64,
    hunger: 22,
    tokens: 320,
    meals: 1,
    chats: 1,
    memories: 0,
    level: 1,
    exp: 24,
    lastSeen: now - 2 * day
  }),
  [chatB],
  [],
  []
)

writeFileSync(
  join(userData, 'config.json'),
  JSON.stringify(
    {
      v: 1,
      pondRoot: pond,
      onboarded: true,
      provider: {
        mode: 'mock',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        temperature: 1.1,
        maxTokens: 1600,
        reasoning: true,
        timeoutMs: 180000,
        vision: { enabled: false, baseUrl: 'https://api.deepseek.com', model: '' },
        image: { enabled: false, baseUrl: '', model: '', size: '1024x1024' }
      },
      memory: { auto: true, every: 6, maxCards: 400, recall: 6, allowDraw: false },
      ui: { theme: 'abyss', showReasoning: true, fontSize: 15, animate: true },
      plugins: { disabled: [] }
    },
    null,
    2
  ),
  'utf8'
)

const digest = createHash('sha1').update(base).digest('hex').slice(0, 8)

// 把示例贴纸包也放进演示配置目录，方便截图里看到「用户贴纸包」
try {
  const sample = join(resolve(import.meta.dirname, '..'), 'examples', 'sticker-pack')
  if (existsSync(sample)) {
    const dest = join(userData, 'stickers', 'fatfish-sample-pack')
    mkdirSync(join(userData, 'stickers'), { recursive: true })
    cpSync(sample, dest, { recursive: true })
  }
} catch {
  /* 示例包不存在不影响演示 */
}

console.log(JSON.stringify({ base, userData, pond, digest }))
