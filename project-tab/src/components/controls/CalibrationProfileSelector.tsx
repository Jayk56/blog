/**
 * CalibrationProfileSelector — lets the human pick a trust calibration preset.
 *
 * Three profiles (Conservative / Balanced / Permissive) with descriptions.
 * Selection POSTs to /api/trust/profile/:name to reconfigure the TrustEngine.
 */

import { useState, useEffect } from 'react'
import { useProjectState, useApi } from '../../lib/context.js'

interface ProfileInfo {
  name: string
  displayName: string
  description: string
  active: boolean
  config: Record<string, unknown>
}

interface ProfilesResponse {
  profiles: ProfileInfo[]
  activeProfile: string
}

export default function CalibrationProfileSelector() {
  const state = useProjectState()
  const isHistorical = state.viewingTick !== null
  const api = useApi()

  const [activeProfile, setActiveProfile] = useState<string>('balanced')
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!api) return
    fetch(`${(api as any)._baseUrl ?? 'http://localhost:3001/api'}/trust/profiles`)
      .then(res => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.json()
      })
      .then((data: ProfilesResponse) => {
        setProfiles(data.profiles)
        setActiveProfile(data.activeProfile)
      })
      .catch(() => {
        // Fallback: use static profile list when backend is unavailable
        setProfiles([
          { name: 'conservative', displayName: 'Conservative', description: 'Lower ceilings, faster decay, risk-weighted trust gains. Best for high-stakes or early-stage projects.', active: false, config: {} },
          { name: 'balanced', displayName: 'Balanced', description: 'Default settings — moderate trust growth, standard decay. Suitable for most projects.', active: true, config: {} },
          { name: 'permissive', displayName: 'Permissive', description: 'Higher initial trust, full ceiling, slower decay. Best for trusted teams or exploratory work.', active: false, config: {} },
        ])
      })
  }, [api])

  const handleSelect = async (name: string) => {
    if (name === activeProfile || loading || isHistorical) return
    setLoading(true)
    const previous = activeProfile
    setActiveProfile(name)
    try {
      const baseUrl = (api as any)?._baseUrl ?? 'http://localhost:3001/api'
      const res = await fetch(`${baseUrl}/trust/profile/${encodeURIComponent(name)}`, { method: 'POST' })
      if (!res.ok) {
        setActiveProfile(previous)
      }
    } catch {
      setActiveProfile(previous)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
        Trust Calibration
      </h2>

      {isHistorical && (
        <p className="text-[11px] text-text-muted">Viewing historical state — actions disabled</p>
      )}

      <div className="space-y-2">
        {profiles.map((profile) => {
          const isActive = profile.name === activeProfile
          return (
            <button
              key={profile.name}
              onClick={() => handleSelect(profile.name)}
              disabled={isHistorical || loading}
              className={`w-full text-left p-3 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                isActive
                  ? 'bg-accent/10 border-accent/30 text-text-primary'
                  : 'bg-surface-1 border-border hover:border-border-light text-text-secondary'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${isActive ? 'text-accent' : ''}`}>
                  {profile.displayName}
                </span>
                {isActive && (
                  <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded">
                    active
                  </span>
                )}
              </div>
              <div className="text-xs text-text-muted mt-0.5">{profile.description}</div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
