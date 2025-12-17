'use client'

import { useEffect, useRef } from 'react'

export function useWebSocket(path: string = '/ws') {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const reconnectAttemptsRef = useRef(0)
  const isConnecting = useRef(false)

  useEffect(() => {
    let mounted = true
    const connectionTimeout: NodeJS.Timeout[] = []

    const connect = () => {
      if (!mounted || isConnecting.current) return
      isConnecting.current = true

      try {
        // Use the same host but with ws:// protocol
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const host = process.env.NEXT_PUBLIC_API_URL!.replace(/^https?:\/\//, '')
        const wsUrl = `${protocol}//${host}${path}`

        console.log('Attempting WebSocket connection to:', wsUrl)

        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          console.log('WebSocket connected successfully')
          isConnecting.current = false
          reconnectAttemptsRef.current = 0
        }

        ws.onmessage = (event) => {
          try {
            JSON.parse(event.data)
            // Message handling is done in the component that uses this hook
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error)
          }
        }

        ws.onerror = () => {
          console.warn(
            'WebSocket error occurred. This is often due to authentication requirements.'
          )
          isConnecting.current = false
        }

        ws.onclose = (event) => {
          console.log('WebSocket disconnected:', event.code, event.reason)
          isConnecting.current = false
          wsRef.current = null

          // Don't reconnect if component is unmounting or connection was closed normally
          if (!mounted || event.code === 1000) {
            return
          }

          // Reconnect with exponential backoff (but not for certain error codes)
          if (event.code !== 1006 && event.code !== 1008 && reconnectAttemptsRef.current < 3) {
            const delay = Math.min(5000 * Math.pow(2, reconnectAttemptsRef.current), 30000)
            reconnectAttemptsRef.current++

            console.log(
              `Will attempt reconnection in ${delay}ms (attempt ${reconnectAttemptsRef.current})`
            )
            reconnectTimeoutRef.current = setTimeout(() => {
              if (mounted) {
                connect()
              }
            }, delay)
          } else if (event.code === 1006) {
            console.log(
              'WebSocket closed due to abnormal closure (often CORS or authentication issues)'
            )
          } else if (event.code === 1008) {
            console.log('WebSocket closed due to authentication error')
          }
        }
      } catch (error) {
        console.error('Failed to create WebSocket:', error)
      }
    }

    // Add a small delay to avoid immediate connection in StrictMode
    const timeout = setTimeout(() => {
      if (mounted) {
        connect()
      }
    }, 100)
    connectionTimeout.push(timeout)

    return () => {
      mounted = false
      connectionTimeout.forEach(clearTimeout)
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        // Only close if the WebSocket is open or connecting
        // This prevents the "WebSocket is closed before the connection is established" error
        if (
          wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING
        ) {
          wsRef.current.close(1000, 'Component unmounting')
        }
        wsRef.current = null
      }
      isConnecting.current = false
    }
  }, [path])

  // Return the WebSocket instance
  // Note: This will be null initially and will update when connected
  return wsRef.current
}
