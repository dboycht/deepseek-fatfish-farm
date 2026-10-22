/**
 * 稻田日记 —— 内置示例插件（CommonJS）
 *
 * 插件只要导出一个 activate(api) 就能长在软件上：
 *   api.registerCommand({ id, title, run(payload) })   注册命令（会出现在「插件」面板里）
 *   api.getFish(fishId)                                读肥鱼档案
 *   api.addStats(fishId, { tokens, mood, hunger, exp }) 给它加属性
 *   api.listMemories(fishId)                           读压缩记忆卡片
 *   api.emit(type, payload)                            往界面推事件
 *   api.config()                                       读应用配置
 *   api.log(...)                                       打日志（主进程控制台）
 *
 * 有 panel 的插件会被渲染进程用 iframe 打开（协议 fatfish-plugin://<id>/<entry>），
 * 面板里用 postMessage({type:'farm:invoke', command, payload}) 就能调到这里的命令。
 */

module.exports.activate = (api) => {
  api.log('稻田日记已上线')

  api.registerCommand({
    id: 'report',
    title: '报个数',
    run: async (payload) => {
      const fishId = payload && payload.fishId
      if (!fishId) return '还没选鱼呢'
      const fish = await api.getFish(fishId)
      if (!fish) return '找不到这只肥鱼'
      const s = fish.stats
      return `${fish.name} 一共吃掉 ${s.tokens} 个 token、${s.meals} 碗白米饭，心情 ${Math.round(s.mood)}，饿度 ${Math.round(s.hunger)}。`
    }
  })

  api.registerCommand({
    id: 'bonus',
    title: '偷偷加餐',
    run: async (payload) => {
      const fishId = payload && payload.fishId
      if (!fishId) return '还没选鱼呢'
      const gain = 40 + Math.floor(Math.random() * 60)
      const fish = await api.addStats(fishId, { tokens: gain, mood: 4, hunger: -8, exp: 3 })
      if (!fish) return '加餐失败，它好像不在鱼塘里'
      api.emit('fed', { fishId, gain })
      return `偷偷塞了 ${gain} 个 token 给它，现在心情 ${Math.round(fish.stats.mood)}。`
    }
  })

  api.registerCommand({
    id: 'memory-sample',
    title: '抽一条记忆',
    run: async (payload) => {
      const fishId = payload && payload.fishId
      if (!fishId) return '还没选鱼呢'
      const cards = await api.listMemories(fishId)
      if (!cards.length) return '它现在脑子空空的，先跟它聊几句吧'
      const c = cards[Math.floor(Math.random() * cards.length)]
      return `它想起了：${c.text}`
    }
  })

  api.registerCommand({
    id: 'hungry-list',
    title: '谁最饿',
    run: async () => {
      const cfg = await api.config()
      return `鱼塘在 ${cfg.pondRoot}；当前记忆策略：每 ${cfg.memory.every} 条消息蒸馏一次，卡片上限 ${cfg.memory.maxCards}。`
    }
  })
}
