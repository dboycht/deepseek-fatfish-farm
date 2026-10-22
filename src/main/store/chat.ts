import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { readGzJSON, writeGzJSON } from '../util/fsx'
import { id } from '../util/ids'
import { chatsDir, listChatMetas, writeChatMetas } from './fish'
import type { ChatFile, ChatMessage, ChatMeta } from '@shared/types'

function chatFile(root: string, fishId: string, chatId: string): string {
  return join(chatsDir(root, fishId), `${chatId}.json.gz`)
}

export function newMessage(role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: id(12), role, t: Date.now(), text, ...extra }
}

export async function createChat(root: string, fishId: string, title = '新的对话'): Promise<ChatFile> {
  const chat: ChatFile = {
    id: id(12),
    title: title.slice(0, 28),
    created: Date.now(),
    updated: Date.now(),
    count: 0,
    msgs: []
  }
  await writeGzJSON(chatFile(root, fishId, chat.id), chat)
  await upsertMeta(root, fishId, chat)
  return chat
}

export async function readChat(root: string, fishId: string, chatId: string): Promise<ChatFile | null> {
  const chat = await readGzJSON<ChatFile | null>(chatFile(root, fishId, chatId), null)
  if (!chat) return null
  chat.msgs ??= []
  return chat
}

export async function saveChat(root: string, fishId: string, chat: ChatFile): Promise<void> {
  chat.count = chat.msgs.length
  chat.updated = Date.now()
  await writeGzJSON(chatFile(root, fishId, chat.id), chat)
  await upsertMeta(root, fishId, chat)
}

async function upsertMeta(root: string, fishId: string, chat: ChatFile): Promise<void> {
  const metas = await listChatMetas(root, fishId)
  const meta: ChatMeta = {
    id: chat.id,
    title: chat.title,
    created: chat.created,
    updated: chat.updated,
    count: chat.count
  }
  const idx = metas.findIndex((m) => m.id === chat.id)
  if (idx >= 0) metas[idx] = meta
  else metas.push(meta)
  metas.sort((a, b) => b.updated - a.updated)
  await writeChatMetas(root, fishId, metas)
}

export async function appendMessage(
  root: string,
  fishId: string,
  chatId: string,
  msg: ChatMessage
): Promise<ChatFile | null> {
  const chat = (await readChat(root, fishId, chatId)) ?? (await createChat(root, fishId))
  chat.msgs.push(msg)
  // 以第一条用户消息自动命名会话
  if (chat.msgs.filter((m) => m.role === 'u').length === 1 && msg.role === 'u' && /^新的对话$/.test(chat.title)) {
    chat.title = msg.text.replace(/\s+/g, ' ').slice(0, 18) || '发了张图'
  }
  await saveChat(root, fishId, chat)
  return chat
}

export async function patchMessage(
  root: string,
  fishId: string,
  chatId: string,
  msgId: string,
  patch: Partial<ChatMessage>
): Promise<ChatMessage | null> {
  const chat = await readChat(root, fishId, chatId)
  if (!chat) return null
  const msg = chat.msgs.find((m) => m.id === msgId)
  if (!msg) return null
  Object.assign(msg, patch)
  await saveChat(root, fishId, chat)
  return msg
}

export async function renameChat(root: string, fishId: string, chatId: string, title: string): Promise<void> {
  const chat = await readChat(root, fishId, chatId)
  if (!chat) return
  chat.title = title.slice(0, 28)
  await saveChat(root, fishId, chat)
}

export async function deleteChat(root: string, fishId: string, chatId: string): Promise<void> {
  try {
    await fs.rm(chatFile(root, fishId, chatId), { force: true })
  } catch {
    /* 文件本来就不在 */
  }
  const metas = (await listChatMetas(root, fishId)).filter((m) => m.id !== chatId)
  await writeChatMetas(root, fishId, metas)
}

/** 取最近 n 条（用于拼上下文） */
export function tail(chat: ChatFile, n: number): ChatMessage[] {
  return chat.msgs.slice(-n)
}
