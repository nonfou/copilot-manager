import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import consola from "consola"

const ALGORITHM = "aes-256-gcm"
const ENC_PREFIX = "enc:"

let encryptionKey: Buffer | null = null

/**
 * 初始化加密密钥，从 ENCRYPTION_KEY 环境变量读取 64 位 hex 字符串（32 字节）
 * 若未设置则发出警告并以明文模式运行；若格式错误则退出进程。
 */
export function initEncryption(): void {
  const keyHex = process.env.ENCRYPTION_KEY
  if (!keyHex) {
    consola.error("ENCRYPTION_KEY 未设置 — 拒绝启动以防止敏感数据明文存储。")
    consola.error("请在 .env 中设置 ENCRYPTION_KEY=<64 位 hex 字符串>（可用 openssl rand -hex 32 生成）。")
    process.exit(1)
  }
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    consola.error("ENCRYPTION_KEY 必须是 64 个十六进制字符（32 字节）")
    process.exit(1)
  }
  encryptionKey = Buffer.from(keyHex, "hex")
  consola.info("静态加密已启用（AES-256-GCM）")
}

/**
 * 加密字符串，返回格式：enc:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 * 若未设置 ENCRYPTION_KEY 或值已加密则原样返回。
 */
export function encrypt(plaintext: string): string {
  if (!encryptionKey || plaintext.startsWith(ENC_PREFIX)) return plaintext
  const iv = randomBytes(12) // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${ENC_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`
}

/**
 * 解密字符串，支持：
 * - 已加密值（enc:... 前缀）→ 解密
 * - 明文（无前缀）→ 原样返回（向后兼容）
 */
export function decrypt(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value
  if (!encryptionKey) {
    consola.error("发现加密数据但 ENCRYPTION_KEY 未设置，无法解密，请在 .env 中配置密钥。")
    return value
  }
  const parts = value.slice(ENC_PREFIX.length).split(":")
  if (parts.length !== 3) {
    consola.warn("加密值格式不合法，返回原始值")
    return value
  }
  const [ivHex, tagHex, ctHex] = parts
  try {
    const decipher = createDecipheriv(ALGORITHM, encryptionKey, Buffer.from(ivHex, "hex"))
    decipher.setAuthTag(Buffer.from(tagHex, "hex"))
    return Buffer.concat([
      decipher.update(Buffer.from(ctHex, "hex")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    consola.error("解密失败 — 密钥错误或数据损坏")
    return value
  }
}
