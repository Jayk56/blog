import type { TrustCalibrationConfig } from './trust-engine'

/** Named calibration profile presets. */
export type CalibrationProfileName = 'conservative' | 'balanced' | 'permissive'

/** A calibration profile bundles a config override with display metadata. */
export interface CalibrationProfile {
  name: CalibrationProfileName
  displayName: string
  description: string
  config: Partial<TrustCalibrationConfig>
}

const PROFILES: Record<CalibrationProfileName, CalibrationProfile> = {
  conservative: {
    name: 'conservative',
    displayName: 'Conservative',
    description: 'Lower ceilings, faster decay, risk-weighted trust gains. Best for high-stakes or early-stage projects where caution is paramount.',
    config: {
      initialScore: 30,
      ceilingScore: 60,
      decayCeiling: 25,
      decayRatePerTick: 0.02,
      riskWeightingEnabled: true,
      riskWeightMap: { trivial: 0.3, small: 0.5, medium: 1.0, large: 2.0, unknown: 1.0 },
    },
  },
  balanced: {
    name: 'balanced',
    displayName: 'Balanced',
    description: 'Default settings — moderate trust growth, standard decay, no risk weighting. Suitable for most projects.',
    config: {},
  },
  permissive: {
    name: 'permissive',
    displayName: 'Permissive',
    description: 'Higher initial trust, full ceiling, slower decay. Best for trusted teams or low-risk exploratory work.',
    config: {
      initialScore: 70,
      ceilingScore: 100,
      decayCeiling: 60,
      decayRatePerTick: 0.005,
      floorScore: 30,
    },
  },
}

/** Get a specific calibration profile by name. */
export function getProfile(name: CalibrationProfileName): CalibrationProfile {
  return PROFILES[name]
}

/** List all available calibration profiles. */
export function listProfiles(): CalibrationProfile[] {
  return Object.values(PROFILES)
}

/** Type guard for CalibrationProfileName. */
export function isCalibrationProfileName(value: string): value is CalibrationProfileName {
  return value === 'conservative' || value === 'balanced' || value === 'permissive'
}
