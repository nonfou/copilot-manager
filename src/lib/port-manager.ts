const PORT_START = 14100
const PORT_END = 14999

const usedPorts = new Set<number>()

/**
 * 分配一个未使用的端口
 */
export function allocatePort(): number {
  for (let port = PORT_START; port <= PORT_END; port++) {
    if (!usedPorts.has(port)) {
      usedPorts.add(port)
      return port
    }
  }
  throw new Error("No available ports in range 14100-14999")
}

/**
 * 释放端口
 */
export function releasePort(port: number): void {
  usedPorts.delete(port)
}

/**
 * 检查端口是否被占用（TCP 连接测试）
 */
export async function isPortListening(port: number, timeout = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
      resolve(false)
    }, timeout)

    fetch(`http://localhost:${port}/`, { signal: controller.signal })
      .then(() => {
        clearTimeout(timer)
        resolve(true)
      })
      .catch(() => {
        clearTimeout(timer)
        resolve(false)
      })
  })
}
