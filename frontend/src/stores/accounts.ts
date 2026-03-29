import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Account, UsageData, ModelsResponse } from '../types/api'
import { useApi } from '../composables/useApi'

const CACHE_TTL = 5 * 60 * 1000

interface CacheEntry<T> {
  data: T
  fetchedAt: number
}

export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref<Account[]>([])
  const usageCache = ref(new Map<string, CacheEntry<UsageData>>())
  const modelsCache = ref(new Map<string, CacheEntry<ModelsResponse>>())

  async function fetchAccounts() {
    const api = useApi()
    accounts.value = await api.get<Account[]>('/accounts')
  }

  async function getUsage(id: string, forceRefresh = false): Promise<UsageData> {
    const api = useApi()
    const cached = usageCache.value.get(id)
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return cached.data
    }
    const suffix = forceRefresh ? '?refresh=true' : ''
    const data = await api.get<UsageData>(`/accounts/${id}/usage${suffix}`)
    usageCache.value.set(id, { data, fetchedAt: Date.now() })
    return data
  }

  async function getModels(id: string, forceRefresh = false): Promise<ModelsResponse> {
    const api = useApi()
    const cached = modelsCache.value.get(id)
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return cached.data
    }
    const suffix = forceRefresh ? '?refresh=true' : ''
    const data = await api.get<ModelsResponse>(`/accounts/${id}/models${suffix}`)
    modelsCache.value.set(id, { data, fetchedAt: Date.now() })
    return data
  }

  function invalidateCache(id: string) {
    usageCache.value.delete(id)
    modelsCache.value.delete(id)
  }

  return { accounts, fetchAccounts, getUsage, getModels, invalidateCache }
})
