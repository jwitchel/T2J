'use client'

import { SWRConfig } from 'swr'
import { ReactNode } from 'react'
import { apiGet } from '@/lib/api'

export function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: apiGet,
        revalidateOnFocus: false,
      }}
    >
      {children}
    </SWRConfig>
  )
}
