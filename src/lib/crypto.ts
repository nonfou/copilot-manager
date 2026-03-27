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
 * 格式: sk-ant-api03- + 40字节 base64url（与 Claude API Key 格式一致，兼容 Claude Code 等客户端）
 */
export function generateApiKey(): string {
  const bytes = randomBytes(40)
  // base64url: 去掉 +/= 改为 -_，避免 URL/Header 中需要转义
  return `sk-ant-api03-${bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")}`
}
