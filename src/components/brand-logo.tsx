'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState, useEffect } from 'react'

interface BrandLogoProps {
  href?: string
  size?: 'sm' | 'md' | 'lg'
}

export function BrandLogo({ href = '/', size = 'md' }: BrandLogoProps) {
  const words = ['Think', 'Breathe', 'Work', 'Plan', 'Ride', 'Run', 'Smile', 'Relax', 'Center', 'Spin', 'Walk', 'Sleep', 'Stretch', 'Move', 'Laugh', 'Make', 'Build', 'Design', 'Paint', 'Sketch']
  const colors = ['#93c5fd', '#a5b4fc', '#c4b5fd', '#f9a8d4', '#fdba74', '#fcd34d', '#86efac', '#67e8f9', '#94a3b8']
  const [wordIndex, setWordIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible(false)
      setTimeout(() => {
        setWordIndex((prev) => (prev + 1) % words.length)
        setIsVisible(true)
      }, 5000)
    }, 15000)

    return () => clearInterval(interval)
  }, [words.length])

  const sizeConfig = {
    sm: { logo: 24, text: 'text-base', minWidth: '60px' },
    md: { logo: 32, text: 'text-lg', minWidth: '80px' },
    lg: { logo: 40, text: 'text-2xl', minWidth: '100px' },
  }

  const config = sizeConfig[size]

  const content = (
    <div className="flex items-center space-x-3">
      <Image
        src="/logo.png"
        alt="Time to Just Logo"
        width={config.logo}
        height={config.logo}
        className="object-contain logo-rotate"
        style={{ width: `${config.logo}px`, height: `${config.logo}px` }}
      />
      <span className={`font-semibold ${config.text} text-zinc-900 dark:text-zinc-100`}>
        Time to Just{' '}
        <span
          style={{
            display: 'inline-block',
            minWidth: config.minWidth,
            borderBottom: '2px solid currentColor',
            paddingBottom: '0',
            marginBottom: '-2px',
            verticalAlign: 'baseline',
          }}
        >
          <span
            style={{
              color: colors[wordIndex % colors.length],
              opacity: isVisible ? 1 : 0,
              transition: 'opacity 5s linear',
            }}
          >
            {words[wordIndex]}
          </span>
        </span>
      </span>
    </div>
  )

  if (href) {
    return <Link href={href}>{content}</Link>
  }

  return content
}
