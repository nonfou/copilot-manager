import { randomBytes } from "node:crypto"

/**
 * 生成带前缀的随机 ID
 * 例：generateId("acc") => "acc_a1b2c3d4e5f6"
 */
export function generateId(prefix: string): string {
  const bytes = randomBytes(8)
  const hex = bytes.toString("hex")
  return `${prefix}_${hex}`
}

/**
 * 生成 API Key
 * 格式: cm- + 48 位 hex（共 51 字符）
 */
export function generateApiKey(): string {
  const bytes = randomBytes(24)
  return `cm-${bytes.toString("hex")}`
}
