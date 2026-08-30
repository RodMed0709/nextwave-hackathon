'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import SplitFlapText from '@/components/ui/split-flap-text'

const DEMO_CLIENT_ID = 'mueblerias-berrios'

export function DonaldAccess() {
  const router = useRouter()
  const [clientId, setClientId] = useState(DEMO_CLIENT_ID)
  const [accessCode, setAccessCode] = useState('donald-ready')
  const [error, setError] = useState('')
  const [isEntering, setIsEntering] = useState(false)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedClientId = clientId.trim().toLowerCase()

    if (!normalizedClientId) {
      setError('CLIENT NOT FOUND')
      return
    }

    if (!accessCode.trim()) {
      setError('INVALID ACCESS CODE')
      return
    }

    if (normalizedClientId !== DEMO_CLIENT_ID) {
      setError('CLIENT NOT FOUND')
      return
    }

    setError('')
    setIsEntering(true)
    window.setTimeout(() => {
      // Straight to the run: the pitch skips the /start screen now.
      router.push('/runs/berrios-op4471-v2')
    }, 460)
  }

  return (
    <main className={`donald-access-page${isEntering ? ' entering' : ''}`}>
      <section className="donald-access-shell" aria-label="Donald dashboard access">
        <div className="donald-access-brand-lockup">
          <Image
            priority
            alt="Nauta"
            className="donald-access-nauta-logo"
            height={86}
            src="/nauta-logo-white.svg"
            width={360}
          />
          <div className="donald-access-plus" aria-hidden="true">+</div>
          <Image
            priority
            alt="Donald"
            className="donald-access-donald-logo"
            height={84}
            src="/donald-logo-access.png"
            width={300}
          />
        </div>

        <div className="donald-access-flap" aria-label="Donald access status">
          <SplitFlapText
            words={[
              'SYSTEM READY',
              'NAUTA ONLINE',
              'DONALD READY',
              'OPERATIONAL BRAIN LIVE',
            ]}
            flipDuration={0.12}
            stagger={0.05}
            cycleDelay={1800}
            charset="alphanumeric"
            flipsPerChar={8}
            tileColor="#111827"
            textColor="#F6F4EC"
            tileRadius={6}
            gap={4}
            fontSize="clamp(15px, 3.3vw, 34px)"
            loop
            padTo={22}
          />
        </div>

        <form className="donald-access-form" onSubmit={handleSubmit}>
          <label>
            <span>Client ID</span>
            <input
              autoComplete="username"
              inputMode="text"
              onChange={event => {
                setClientId(event.target.value)
                setError('')
              }}
              placeholder="mueblerias-berrios"
              type="text"
              value={clientId}
            />
          </label>

          <label>
            <span>Access Code</span>
            <input
              autoComplete="current-password"
              onChange={event => {
                setAccessCode(event.target.value)
                setError('')
              }}
              placeholder="Enter access code"
              type="password"
              value={accessCode}
            />
          </label>

          <button disabled={isEntering} type="submit">
            Enter Dashboard
          </button>

          <div className="donald-access-error" aria-live="polite">
            {error}
          </div>
        </form>
      </section>
    </main>
  )
}
