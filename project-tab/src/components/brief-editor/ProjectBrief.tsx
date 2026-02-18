/**
 * Project brief section — displays goals and high-level description.
 * Supports inline editing of both description and goals.
 */

import { useState, useRef, useEffect } from 'react'
import { Pencil, Check, X, Plus, Trash2 } from 'lucide-react'
import { useProjectDispatch, useProjectState, useApi } from '../../lib/context.js'
import type { Project } from '../../types/index.js'

interface ProjectBriefProps {
  project: Project
}

export default function ProjectBrief({ project }: ProjectBriefProps) {
  const dispatch = useProjectDispatch()
  const state = useProjectState()
  const isHistorical = state.viewingTick !== null
  const api = useApi()

  // ── Description editing state ──────────────────────────────────
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState(project.description)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editingDescription && descriptionRef.current) {
      descriptionRef.current.focus()
      descriptionRef.current.select()
    }
  }, [editingDescription])

  function startEditDescription() {
    setDescriptionDraft(project.description)
    setEditingDescription(true)
  }

  function saveDescription() {
    const trimmed = descriptionDraft.trim()
    if (trimmed) {
      dispatch({ type: 'update-description', description: trimmed })
      api?.updateProject({ description: trimmed }).catch(console.error)
    }
    setEditingDescription(false)
  }

  function cancelEditDescription() {
    setEditingDescription(false)
    setDescriptionDraft(project.description)
  }

  // ── Goals editing state ────────────────────────────────────────
  const [editingGoalIndex, setEditingGoalIndex] = useState<number | null>(null)
  const [goalDraft, setGoalDraft] = useState('')
  const [addingGoal, setAddingGoal] = useState(false)
  const [newGoalDraft, setNewGoalDraft] = useState('')
  const goalInputRef = useRef<HTMLInputElement>(null)
  const newGoalInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingGoalIndex !== null && goalInputRef.current) {
      goalInputRef.current.focus()
      goalInputRef.current.select()
    }
  }, [editingGoalIndex])

  useEffect(() => {
    if (addingGoal && newGoalInputRef.current) {
      newGoalInputRef.current.focus()
    }
  }, [addingGoal])

  function startEditGoal(index: number) {
    setGoalDraft(project.goals[index])
    setEditingGoalIndex(index)
  }

  function saveGoal(index: number) {
    const trimmed = goalDraft.trim()
    if (trimmed) {
      const newGoals = [...project.goals]
      newGoals[index] = trimmed
      dispatch({ type: 'update-goals', goals: newGoals })
      api?.updateProject({ goals: newGoals }).catch(console.error)
    }
    setEditingGoalIndex(null)
    setGoalDraft('')
  }

  function cancelEditGoal() {
    setEditingGoalIndex(null)
    setGoalDraft('')
  }

  function removeGoal(index: number) {
    const newGoals = project.goals.filter((_, i) => i !== index)
    dispatch({ type: 'update-goals', goals: newGoals })
    api?.updateProject({ goals: newGoals }).catch(console.error)

    // Adjust editing index after removal
    if (editingGoalIndex !== null) {
      if (index === editingGoalIndex) {
        // Deleted the item being edited — cancel edit
        setEditingGoalIndex(null)
        setGoalDraft('')
      } else if (index < editingGoalIndex) {
        // Deleted an item before the edited one — shift index down
        setEditingGoalIndex(editingGoalIndex - 1)
      }
    }
  }

  function startAddGoal() {
    setNewGoalDraft('')
    setAddingGoal(true)
  }

  function saveNewGoal() {
    const trimmed = newGoalDraft.trim()
    if (trimmed) {
      const newGoals = [...project.goals, trimmed]
      dispatch({ type: 'update-goals', goals: newGoals })
      api?.updateProject({ goals: newGoals }).catch(console.error)
    }
    setAddingGoal(false)
    setNewGoalDraft('')
  }

  function cancelAddGoal() {
    setAddingGoal(false)
    setNewGoalDraft('')
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
        Project Brief
      </h2>

      <div className="p-4 rounded-lg bg-surface-1 border border-border space-y-4">
        {/* ── Description ──────────────────────────────────────── */}
        <div>
          <h3 className="text-base font-semibold text-text-primary mb-1">
            Description
          </h3>
          {editingDescription ? (
            <div className="space-y-2">
              <textarea
                ref={descriptionRef}
                value={descriptionDraft}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancelEditDescription()
                  if (e.key === 'Enter' && e.metaKey) saveDescription()
                }}
                rows={3}
                className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
              />
              <div className="flex gap-1">
                <button
                  onClick={saveDescription}
                  disabled={!descriptionDraft.trim() || isHistorical}
                  className="p-1 rounded text-success hover:bg-surface-2 transition-colors disabled:opacity-40"
                  title="Save"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={cancelEditDescription}
                  className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors"
                  title="Cancel"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : (
            <p
              className={`text-sm text-text-primary rounded px-1 py-0.5 -mx-1 transition-colors group ${
                isHistorical ? 'cursor-default' : 'cursor-pointer hover:bg-surface-2'
              }`}
              onClick={isHistorical ? undefined : startEditDescription}
              title={isHistorical ? undefined : 'Click to edit'}
            >
              {project.description}
              {!isHistorical && (
                <Pencil
                  size={12}
                  className="inline-block ml-2 opacity-0 group-hover:opacity-60 transition-opacity text-text-muted"
                />
              )}
            </p>
          )}
        </div>

        {/* ── Goals ────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-base font-semibold text-text-primary">
              Goals
            </h3>
            <button
              onClick={startAddGoal}
              disabled={isHistorical}
              className="flex items-center gap-1 text-xs text-accent hover:text-accent-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={12} />
              Add
            </button>
          </div>
          <ul className="space-y-1.5">
            {project.goals.map((goal, i) => (
              <li key={i}>
                {editingGoalIndex === i ? (
                  <div className="flex items-center gap-2">
                    <span className="text-accent mt-0.5 flex-shrink-0">--</span>
                    <input
                      ref={goalInputRef}
                      type="text"
                      value={goalDraft}
                      onChange={(e) => setGoalDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveGoal(i)
                        if (e.key === 'Escape') cancelEditGoal()
                      }}
                      className="flex-1 px-2 py-1 text-sm bg-surface-2 border border-border rounded-md text-text-primary focus:outline-none focus:border-accent"
                    />
                    <button
                      onClick={() => saveGoal(i)}
                      disabled={!goalDraft.trim()}
                      className="p-1 rounded text-success hover:bg-surface-2 transition-colors disabled:opacity-40"
                      title="Save"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={cancelEditGoal}
                      className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors"
                      title="Cancel"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-sm text-text-primary group">
                    <span className="text-accent mt-0.5 flex-shrink-0">--</span>
                    <span className="flex-1">{goal}</span>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={() => startEditGoal(i)}
                        disabled={isHistorical}
                        className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Edit goal"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => removeGoal(i)}
                        disabled={isHistorical}
                        className="p-1 rounded text-text-muted hover:text-danger hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Remove goal"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {addingGoal && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-accent flex-shrink-0">--</span>
              <input
                ref={newGoalInputRef}
                type="text"
                value={newGoalDraft}
                onChange={(e) => setNewGoalDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveNewGoal()
                  if (e.key === 'Escape') cancelAddGoal()
                }}
                placeholder="Enter new goal..."
                className="flex-1 px-2 py-1 text-sm bg-surface-2 border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
              <button
                onClick={saveNewGoal}
                disabled={!newGoalDraft.trim()}
                className="p-1 rounded text-success hover:bg-surface-2 transition-colors disabled:opacity-40"
                title="Save"
              >
                <Check size={14} />
              </button>
              <button
                onClick={cancelAddGoal}
                className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors"
                title="Cancel"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs text-text-muted pt-2 border-t border-border">
          <span>Phase: <span className="text-text-secondary">{project.phase}</span></span>
          <span>Mode: <span className="text-text-secondary">{project.controlMode}</span></span>
          <span>Risk: <span className="text-text-secondary">{project.riskProfile.level}</span></span>
          <span>Persona: <span className="text-text-secondary">{project.persona}</span></span>
        </div>
      </div>
    </section>
  )
}
