// API utility functions

interface FetchOptions extends RequestInit {
  requireAuth?: boolean
}

export async function apiFetch(endpoint: string, options: FetchOptions = {}): Promise<Response> {
  const { requireAuth = true, ...fetchOptions } = options

  const response = await fetch(endpoint, {
    ...fetchOptions,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    },
  })

  if (requireAuth && response.status === 401) {
    try {
      const cloned = response.clone()
      const data = await cloned.json()
      // Do not redirect on provider auth issues; let caller handle reauth UX
      if (
        data &&
        (data.error === 'OAUTH_REAUTH_REQUIRED' || data.error === 'INVALID_CREDENTIALS')
      ) {
        return response
      }
    } catch {
      // ignore parse error; fall through to redirect
    }
    // For all other 401s, redirect to signin
    window.location.href = '/signin'
  }

  return response
}

export async function apiGet<T = unknown>(endpoint: string): Promise<T> {
  const response = await apiFetch(endpoint)

  if (!response.ok) {
    const bodyText = await response.text()
    let code: string | undefined
    let message: string | undefined
    try {
      const data = JSON.parse(bodyText)
      code = data.error
      message = data.message || data.error
    } catch {
      // not JSON; fall through with raw text
    }
    const err = new Error(message || bodyText || `API error: ${response.status}`) as Error & {
      code?: string
      status: number
    }
    if (code) err.code = code
    err.status = response.status
    throw err
  }

  return response.json()
}

export async function apiPost<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
  const response = await apiFetch(endpoint, {
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined,
  })

  if (!response.ok) {
    const bodyText = await response.text()
    let code: string | undefined
    let message: string | undefined
    try {
      const data = JSON.parse(bodyText)
      code = data.error
      message = data.message || data.error
    } catch {
      // not JSON
    }
    const err = new Error(message || bodyText || `API error: ${response.status}`) as Error & {
      code?: string
      status: number
    }
    if (code) err.code = code
    err.status = response.status
    throw err
  }

  return response.json()
}
