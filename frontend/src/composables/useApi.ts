import { router } from '../router'

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
  })
  if (res.status === 401) {
    router.push({ name: 'Login' })
    throw new ApiError('Not authenticated', 401)
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(err.error || res.statusText, res.status)
  }
  return res.json()
}

export function useApi() {
  return {
    get<T>(path: string) {
      return request<T>(path)
    },
    post<T>(path: string, body?: unknown) {
      return request<T>(path, {
        method: 'POST',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    },
    put<T>(path: string, body: unknown) {
      return request<T>(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    },
    delete<T>(path: string) {
      return request<T>(path, { method: 'DELETE' })
    },
  }
}
