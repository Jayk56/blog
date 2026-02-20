/**
 * Constraints section of the Brief Editor.
 *
 * Lists active project constraints with the ability to add, edit, and remove.
 * Constraints are injected into agent context -- they're the "specification
 * of intent" that replaces process standardization.
 *
 * Also displays data-driven constraint suggestions inferred from audit log
 * patterns, which the human can accept or dismiss.
 */

import { useState, useRef, useEffect } from 'react'
import { Plus, Pencil, Check, X, Trash2, Lightbulb } from 'lucide-react'
import { useProjectDispatch, useProjectState, useApi } from '../../lib/context.js'
import type { ConstraintSuggestionResponse } from '../../services/api-client.js'

interface ConstraintsSectionProps {
  constraints: string[]
}

const confidenceBadge: Record<string, { label: string; className: string }> = {
  high: { label: 'High', className: 'bg-success/20 text-success' },
  medium: { label: 'Med', className: 'bg-warning/20 text-warning' },
  low: { label: 'Low', className: 'bg-text-muted/20 text-text-muted' },
}

export default function ConstraintsSection({ constraints }: ConstraintsSectionProps) {
  const dispatch = useProjectDispatch()
  const state = useProjectState()
  const isHistorical = state.viewingTick !== null
  const api = useApi()
  const [newConstraint, setNewConstraint] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  // ── Inline editing state ───────────────────────────────────────
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  // ── Suggestion state ───────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<ConstraintSuggestionResponse[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)

  useEffect(() => {
    if (editingIndex !== null && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingIndex])

  // Fetch suggestions on mount
  useEffect(() => {
    if (!api || isHistorical) return
    setSuggestionsLoading(true)
    api.suggestConstraints()
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false))
  }, [api, isHistorical])

  function handleAdd() {
    const trimmed = newConstraint.trim()
    if (!trimmed) return
    dispatch({ type: 'inject-context', context: trimmed })
    api?.updateProject({ constraints: [...constraints, trimmed] }).catch(console.error)
    setNewConstraint('')
    setIsAdding(false)
  }

  function startEdit(index: number) {
    setEditDraft(constraints[index])
    setEditingIndex(index)
  }

  function saveEdit(index: number) {
    const trimmed = editDraft.trim()
    if (trimmed) {
      dispatch({ type: 'edit-constraint', index, value: trimmed })
      const updated = [...constraints]
      updated[index] = trimmed
      api?.updateProject({ constraints: updated }).catch(console.error)
    }
    setEditingIndex(null)
    setEditDraft('')
  }

  function cancelEdit() {
    setEditingIndex(null)
    setEditDraft('')
  }

  function removeConstraint(index: number) {
    dispatch({ type: 'remove-constraint', index })
    const updated = constraints.filter((_, i) => i !== index)
    api?.updateProject({ constraints: updated }).catch(console.error)

    // Adjust editing index after removal
    if (editingIndex !== null) {
      if (index === editingIndex) {
        // Deleted the item being edited — cancel edit
        setEditingIndex(null)
        setEditDraft('')
      } else if (index < editingIndex) {
        // Deleted an item before the edited one — shift index down
        setEditingIndex(editingIndex - 1)
      }
    }
  }

  function acceptSuggestion(suggestion: ConstraintSuggestionResponse) {
    dispatch({ type: 'inject-context', context: suggestion.text })
    api?.updateProject({ constraints: [...constraints, suggestion.text] }).catch(console.error)
    api?.submitConstraintFeedback(suggestion.id, true, suggestion.text).catch(console.error)
    setSuggestions(prev => prev.filter(s => s.id !== suggestion.id))
  }

  function dismissSuggestion(suggestion: ConstraintSuggestionResponse) {
    api?.submitConstraintFeedback(suggestion.id, false).catch(console.error)
    setSuggestions(prev => prev.filter(s => s.id !== suggestion.id))
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
          Constraints
        </h2>
        <button
          onClick={() => setIsAdding(!isAdding)}
          disabled={isHistorical}
          className="flex items-center gap-1 text-xs text-accent hover:text-accent-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      <div className="space-y-2">
        {constraints.map((constraint, i) => (
          <div
            key={i}
            className="flex items-start gap-3 p-3 rounded-lg bg-surface-1 border border-border text-sm group"
          >
            {editingIndex === i ? (
              <>
                <span className="text-warning flex-shrink-0 mt-0.5">!</span>
                <input
                  ref={editInputRef}
                  type="text"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(i)
                    if (e.key === 'Escape') cancelEdit()
                  }}
                  className="flex-1 px-2 py-0.5 text-sm bg-surface-2 border border-border rounded-md text-text-primary focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => saveEdit(i)}
                  disabled={!editDraft.trim()}
                  className="p-1 rounded text-success hover:bg-surface-2 transition-colors disabled:opacity-40 flex-shrink-0"
                  title="Save"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={cancelEdit}
                  className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors flex-shrink-0"
                  title="Cancel"
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <span className="text-warning flex-shrink-0 mt-0.5">!</span>
                <span className="text-text-primary flex-1">{constraint}</span>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={() => startEdit(i)}
                    disabled={isHistorical}
                    className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Edit constraint"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => removeConstraint(i)}
                    disabled={isHistorical}
                    className="p-1 rounded text-text-muted hover:text-danger hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Remove constraint"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </>
            )}
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

      {/* ── Suggested Constraints ────────────────────────────────── */}
      {!isHistorical && suggestions.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="flex items-center gap-1.5">
            <Lightbulb size={12} className="text-warning" />
            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
              Suggested constraints
            </span>
          </div>

          {suggestions.map((suggestion) => {
            const badge = confidenceBadge[suggestion.confidence]
            return (
              <div
                key={suggestion.id}
                className="p-3 rounded-lg bg-surface-1 border border-border/60 border-dashed text-sm space-y-2"
              >
                <div className="flex items-start gap-2">
                  <span className="text-accent flex-shrink-0 mt-0.5">?</span>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-text-primary">{suggestion.text}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted">{suggestion.reasoning}</p>
                  </div>
                </div>
                <div className="flex gap-2 pl-5">
                  <button
                    onClick={() => acceptSuggestion(suggestion)}
                    className="px-2.5 py-1 text-xs bg-accent text-white rounded hover:bg-accent-muted transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => dismissSuggestion(suggestion)}
                    className="px-2.5 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!isHistorical && suggestionsLoading && (
        <p className="text-xs text-text-muted">Loading suggestions...</p>
      )}
    </section>
  )
}
