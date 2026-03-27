import { scrypt, randomBytes, timingSafeEqual } from "node:crypto"

const SALT_LENGTH = 16
const KEY_LENGTH = 64

/**
 * 使用 scrypt 算法哈希密码
 * @param password 明文密码
 * @returns 格式: salt:hash (hex)
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH).toString("hex")
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) return reject(err)
      resolve(`${salt}:${derivedKey.toString("hex")}`)
    })
  })
}

/**
 * 验证密码
 * @param password 明文密码
 * @param stored 存储的哈希值 (salt:hash)
 * @returns 是否匹配
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":")
  if (!salt || !hash) return false

  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) return reject(err)
      try {
        const hashBuffer = Buffer.from(hash, "hex")
        // 长度不匹配直接返回 false
        if (derivedKey.length !== hashBuffer.length) {
          resolve(false)
          return
        }
        // 使用 timingSafeEqual 防止时序攻击
        resolve(timingSafeEqual(derivedKey, hashBuffer))
      } catch {
        resolve(false)
      }
    })
  })
}
