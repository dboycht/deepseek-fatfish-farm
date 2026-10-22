import { app } from 'electron'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ConfigPaths } from '@shared/types'

/**
 * 配置目录（DSH 风格）：
 *  - 默认用 Electron 的 userData；
 *  - 设置 FATFISH_HOME 可以整体搬走（便携/测试用，DSH 的 $DSH_HOME 同理）；
 *  - 配置在 config.yaml，密钥在 .credentials.yaml，两者同目录。
 */
export function configDir(): string {
  const home = process.env.FATFISH_HOME?.trim()
  return home ? resolve(home) : app.getPath('userData')
}

export function configFile(): string {
  return join(configDir(), 'config.yaml')
}

export function credentialsFile(): string {
  return join(configDir(), '.credentials.yaml')
}

/** v1 旧配置（迁移用） */
export function legacyConfigFile(): string {
  return join(configDir(), 'config.json')
}

/** v1 旧密钥文件（总在 Electron userData 下，哪怕设置了 FATFISH_HOME） */
export function legacySecretsFile(): string {
  return join(app.getPath('userData'), 'secrets.bin')
}

/** DeepSeek Harness 的凭据文件，用于「从 DSH 导入」 */
export function dshCredentialsFile(): string {
  return join(homedir(), '.dsh', '.credentials.yaml')
}

export function configPaths(): ConfigPaths {
  return {
    configDir: configDir(),
    configFile: configFile(),
    credentialsFile: credentialsFile()
  }
}
