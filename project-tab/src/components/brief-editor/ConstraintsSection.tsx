/**
 * Constraints section of the Brief Editor.
 *
 * Lists active project constraints with the ability to add new ones.
 * Constraints are injected into agent context — they're the "specification
 * of intent" that replaces process standardization.
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useProjectDispatch } from '../../lib/context.js'

interface ConstraintsSectionProps {
  constraints: string[]
}

export default function ConstraintsSection({ constraints }: ConstraintsSectionProps) {
  const dispatch = useProjectDispatch()
  const [newConstraint, setNewConstraint] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  function handleAdd() {
    const trimmed = newConstraint.trim()
    if (!trimmed) return
    dispatch({ type: 'inject-context', context: trimmed })
    setNewConstraint('')
    setIsAdding(false)
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
          Constraints
        </h2>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-1 text-xs text-accent hover:text-accent-muted transition-colors"
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      <div className="space-y-2">
        {constraints.map((constraint, i) => (
          <div
            key={i}
            className="flex items-start gap-3 p-3 rounded-lg bg-surface-1 border border-border text-sm"
          >
            <span className="text-warning flex-shrink-0 mt-0.5">!</span>
            <span className="text-text-primary">{constraint}</span>
          </div>
        ))}

        {constraints.length === 0 && !isAdding && (
          <p className="text-sm text-text-muted">
            No constraints defined. Add constraints to guide agent behavior.
          </p>
        )}
      </div>

      {isAdding && (
        <div className="flex gap-2">
          <input
            type="text"
            value={newConstraint}
            onChange={(e) => setNewConstraint(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="e.g., Use date-fns for all date operations"
            className="flex-1 px-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            autoFocus
          />
          <button
            onClick={handleAdd}
            disabled={!newConstraint.trim()}
            className="px-3 py-2 text-sm bg-accent text-white rounded-md hover:bg-accent-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
          <button
            onClick={() => { setIsAdding(false); setNewConstraint('') }}
            className="px-3 py-2 text-sm text-text-muted hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  )
}
