/**
 * Throughput vs Quality dial — an explicit tradeoff control.
 * "I need this fast" vs "I need this right."
 */

import type { ThroughputQualityBias } from '../../types/index.js'
import { useProjectDispatch } from '../../lib/context.js'

interface QualityDialProps {
  bias: ThroughputQualityBias
}

export default function QualityDial({ bias }: QualityDialProps) {
  const dispatch = useProjectDispatch()

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    dispatch({ type: 'set-bias', bias: { value: Number(e.target.value) } })
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
        Throughput vs Quality
      </h2>

      <div className="p-4 rounded-lg bg-surface-1 border border-border space-y-3">
        <input
          type="range"
          min={0}
          max={100}
          value={bias.value}
          onChange={handleChange}
          className="w-full accent-accent"
        />
        <div className="flex justify-between text-[10px] text-text-muted uppercase tracking-wider">
          <span>Quality</span>
          <span className="text-text-secondary text-xs font-mono">{bias.value}</span>
          <span>Throughput</span>
        </div>
        <p className="text-xs text-text-muted">
          {bias.value < 30
            ? 'Focus on quality: more review gates, stricter acceptance criteria.'
            : bias.value > 70
              ? 'Focus on throughput: fewer gates, faster iteration.'
              : 'Balanced: standard review gates, moderate pace.'}
        </p>
      </div>
    </section>
  )
}
