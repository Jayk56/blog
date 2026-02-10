/**
 * Checkpoints section of the Brief Editor.
 *
 * Toggleable checkpoint gates that pause agent execution until human review.
 * More checkpoints in orchestrator mode, fewer in ecosystem mode.
 */

import type { Checkpoint } from '../../types/index.js'
import { useProjectDispatch } from '../../lib/context.js'

interface CheckpointsSectionProps {
  checkpoints: Checkpoint[]
}

export default function CheckpointsSection({ checkpoints }: CheckpointsSectionProps) {
  const dispatch = useProjectDispatch()

  function handleToggle(checkpointId: string, enabled: boolean) {
    dispatch({ type: 'toggle-checkpoint', checkpointId, enabled })
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
        Checkpoints
      </h2>

      <div className="space-y-2">
        {checkpoints.map((cp) => (
          <div
            key={cp.id}
            className="flex items-center justify-between p-3 rounded-lg bg-surface-1 border border-border"
          >
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleToggle(cp.id, !cp.enabled)}
                className={`w-8 h-5 rounded-full transition-colors relative flex-shrink-0 ${
                  cp.enabled ? 'bg-accent' : 'bg-surface-3'
                }`}
                title={cp.enabled ? 'Disable checkpoint' : 'Enable checkpoint'}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    cp.enabled ? 'left-3.5' : 'left-0.5'
                  }`}
                />
              </button>
              <div>
                <div className={`text-sm font-medium ${cp.enabled ? 'text-text-primary' : 'text-text-muted'}`}>
                  {cp.name}
                </div>
                <div className="text-xs text-text-muted">
                  {cp.description}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
