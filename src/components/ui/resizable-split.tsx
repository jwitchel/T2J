'use client'

import { useState, useRef, useEffect, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ResizableSplitProps {
  topContent: ReactNode
  bottomContent: ReactNode
  defaultTopHeight?: number
  minTopHeight?: number
  minBottomHeight?: number
  className?: string
}

export function ResizableSplit({
  topContent,
  bottomContent,
  defaultTopHeight = 60,
  minTopHeight = 100,
  minBottomHeight = 100,
  className,
}: ResizableSplitProps) {
  const [topHeight, setTopHeight] = useState(defaultTopHeight)
  const [isResizing, setIsResizing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const startYRef = useRef(0)
  const startHeightRef = useRef(0)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return

      const containerRect = containerRef.current.getBoundingClientRect()
      const containerHeight = containerRect.height
      const deltaY = e.clientY - startYRef.current
      const newTopHeight = startHeightRef.current + deltaY

      // Calculate percentages with constraints
      const topPercent = (newTopHeight / containerHeight) * 100
      const bottomHeight = containerHeight - newTopHeight

      // Check minimum heights
      if (newTopHeight >= minTopHeight && bottomHeight >= minBottomHeight) {
        setTopHeight(topPercent)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, minTopHeight, minBottomHeight])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return

    startYRef.current = e.clientY
    const containerRect = containerRef.current.getBoundingClientRect()
    startHeightRef.current = (topHeight / 100) * containerRect.height
    setIsResizing(true)
  }

  return (
    <div ref={containerRef} className={cn('flex h-full flex-col', className)}>
      {/* Top Panel */}
      <div style={{ height: `${topHeight}%` }} className="min-h-0">
        {topContent}
      </div>

      {/* Resize Handle */}
      <div
        className={cn(
          'group relative h-2 flex-shrink-0 cursor-ns-resize',
          'before:absolute before:inset-x-0 before:-top-1 before:-bottom-1',
          'hover:before:bg-indigo-500/10'
        )}
        onMouseDown={handleMouseDown}
      >
        <div
          className={cn(
            'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'h-1 w-12 rounded-full',
            'bg-zinc-300 dark:bg-zinc-600',
            'transition-colors group-hover:bg-indigo-500',
            isResizing && 'bg-indigo-500'
          )}
        />
      </div>

      {/* Bottom Panel */}
      <div className="min-h-0 flex-1">{bottomContent}</div>
    </div>
  )
}
