import type { FishProfile, RecallHit } from '@shared/types'

/**
 * 本地排练模式：不联网也能体验完整的聊天 / 记忆引用 / 贴纸链路。
 * 用于第一次打开软件、演示截图，以及断网时陪聊。
 */

export interface MockInput {
  profile: FishProfile
  text: string
  hasImages: boolean
  hits: RecallHit[]
  forceSticker?: boolean
}

export interface MockOutput {
  text: string
  reason: string
  sticker?: string
}

type Intent = 'greet' | 'night' | 'food' | 'praise' | 'sad' | 'thanks' | 'question' | 'image' | 'chat'

function detect(text: string, hasImages: boolean): Intent {
  const t = text.toLowerCase()
  if (hasImages) return 'image'
  if (/(晚安|睡了|困了|睡觉)/.test(t)) return 'night'
  if (/(早|你好|在吗|hi|hello|嗨)/.test(t)) return 'greet'
  if (/(吃|饭|饿|夜宵|奶茶|token)/.test(t)) return 'food'
  if (/(可爱|喜欢你|好棒|厉害|乖|摸摸|贴贴)/.test(t)) return 'praise'
  if (/(难过|累|烦|emo|崩溃|想哭|不开心|压力)/.test(t)) return 'sad'
  if (/(谢谢|感谢|thx|thanks)/.test(t)) return 'thanks'
  if (/[?？]|(吗|怎么|为什么|如何|能不能)/.test(t)) return 'question'
  return 'chat'
}

const REPLIES: Record<Intent, string[]> = {
  greet: ['唔……你来啦。{phrase}', '在的在的，刚在数气泡。你那边怎么样？', '（从水草里探出头）嗯？找我干嘛呀。'],
  night: ['这么晚还不睡……那我陪你一会儿，就一会儿哦。', '呼……我也有点困了，说话可能冒泡泡。{phrase}'],
  food: ['白米饭！哪里有白米饭！（尾巴砰地拍了一下水）', '说到吃的我可就不困了。你要不要也去吃点东西？', '嚼嚼嚼……你的 token 闻起来好香。'],
  praise: ['才、才没有很开心呢……（尾巴在摇）', '哼，你夸我我也不会多干活的。（然后干得飞快）', '唔……你这样说，我会当真的。'],
  sad: ['……嗯。我不吵你，就在这儿游着。', '（安静地贴在缸壁上）要不要先喝口水？', '不用急着好起来，慢慢来也行。'],
  thanks: ['不用谢啦，反正我也只是……顺便帮一下。{phrase}', '嗯，下次记得给我带白米饭。'],
  question: ['这个嘛……让我想想。（吐了两个泡）', '唔，我理一下。你先别急，我慢慢说。'],
  image: ['（凑近看）哦——我看到了。{phrase}', '这张图我收进记忆里了，以后你说起我就能想起来。'],
  chat: ['嗯嗯，我在听。{phrase}', '然后呢？后来怎么样了？', '唔……我记下了。（偷偷把这条塞进记忆里）']
}

const STICKER_BY_INTENT: Partial<Record<Intent, string>> = {
  food: 'rice',
  praise: 'shy',
  sad: 'cry',
  night: 'sleepy',
  thanks: 'joy',
  image: 'joy'
}

function fill(template: string, profile: FishProfile): string {
  return template
    .replace(/\{phrase\}/g, profile.flavor.phrase)
    .replace(/\{food\}/g, profile.flavor.food)
    .replace(/\{nick\}/g, profile.flavor.nick)
}

export function mockReply(input: MockInput): MockOutput {
  const { profile, text, hasImages, hits } = input
  const intent = detect(text, hasImages)
  const pool = REPLIES[intent]
  const base = fill(pool[Math.floor(Math.random() * pool.length)], profile)

  const lines = [base]
  if (hits.length) {
    const h = hits[0]
    const tags = h.card.tags.slice(0, 2).join('、')
    lines.push(
      h.card.img?.length
        ? `说起来，你之前发过一张图${tags ? `（跟「${tags}」有关）` : ''}，我还留着呢。<cite id="${h.anchor}"/>`
        : `对了，你以前提过「${tags || h.card.kind}」这件事来着。<cite id="${h.anchor}"/>`
    )
  }
  if (profile.stats.hunger > 70) lines.push('（肚子咕噜了一声）……有白米饭吗？就一勺。')

  return {
    text: lines.join(' '),
    reason:
      '（排练模式：这句话是本地编的，没有调用任何接口。）' +
      '让我想想怎么回才不像客服……唔，就这么说吧，反正我很可爱。',
    sticker: STICKER_BY_INTENT[intent]
  }
}
