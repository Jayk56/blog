/**
 * Decision list — left panel of the Decision Queue workspace.
 * Shows pending decisions sorted by attention priority with
 * filtering, batch selection, and a collapsible filter bar.
 */

import { AlertTriangle, Clock, Target, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { DecisionItem, Severity } from '../../types/index.js'

/** Filter state lifted from QueueWorkspace. */
export interface QueueFilters {
  severities: Set<Severity>
  subtype: 'all' | 'option' | 'tool_approval'
  showResolved: boolean
}

interface Props {
  decisions: DecisionItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  currentTick: number
  filters: QueueFilters
  onFiltersChange: (filters: QueueFilters) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelectAll: (ids: string[]) => void
}

const severityColor: Record<Severity, string> = {
  critical: 'bg-danger text-white',
  high: 'bg-warning/80 text-surface-0',
  medium: 'bg-info/60 text-white',
  low: 'bg-surface-3 text-text-secondary',
  info: 'bg-surface-2 text-text-muted',
}

const severityChipActive: Record<Severity, string> = {
  critical: 'bg-danger/20 text-danger border-danger/40',
  high: 'bg-warning/20 text-warning border-warning/40',
  medium: 'bg-info/20 text-info border-info/40',
  low: 'bg-surface-3/60 text-text-secondary border-border-light',
  info: 'bg-surface-2/60 text-text-muted border-border',
}

const severityChipInactive = 'bg-transparent text-text-muted/50 border-border/50'

const FILTER_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

export function applyFilters(decisions: DecisionItem[], filters: QueueFilters): DecisionItem[] {
  return decisions.filter((d) => {
    // Resolved filter
    if (!filters.showResolved && d.resolved) return false

    // Severity filter
    if (!filters.severities.has(d.severity)) return false

    // Subtype filter
    if (filters.subtype !== 'all') {
      const effectiveSubtype = d.subtype ?? 'option'
      if (effectiveSubtype !== filters.subtype) return false
    }

    return true
  })
}

export default function DecisionList({
  decisions,
  selectedId,
  onSelect,
  currentTick,
  filters,
  onFiltersChange,
  selectedIds,
  onToggleSelect,
  onSelectAll,
}: Props) {
  const [filtersExpanded, setFiltersExpanded] = useState(false)

  const filtered = applyFilters(decisions, filters)
    .sort((a, b) => {
      // Sort unresolved before resolved, then by attention score
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1
      return b.attentionScore - a.attentionScore
    })

  const pendingCount = filtered.filter((d) => !d.resolved).length
  const visibleIds = filtered.map((d) => d.id)
  const allVisibleSelected = filtered.length > 0 && filtered.every((d) => selectedIds.has(d.id))

  function handleToggleSeverity(sev: Severity) {
    const next = new Set(filters.severities)
    if (next.has(sev)) {
      next.delete(sev)
    } else {
      next.add(sev)
    }
    onFiltersChange({ ...filters, severities: next })
  }

  function handleSubtypeChange(subtype: QueueFilters['subtype']) {
    onFiltersChange({ ...filters, subtype })
  }

  function handleShowResolvedChange(show: boolean) {
    onFiltersChange({ ...filters, showResolved: show })
  }

  function handleSelectAllToggle() {
    if (allVisibleSelected) {
      // Deselect all visible
      onSelectAll([])
    } else {
      onSelectAll(visibleIds)
    }
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col">
        {/* Header */}
        <div className="px-3 py-2 border-b border-border text-xs text-text-muted">
          0 matching decisions
        </div>

        {/* Filter bar (always accessible) */}
        <FilterBar
          expanded={filtersExpanded}
          onToggle={() => setFiltersExpanded(!filtersExpanded)}
          filters={filters}
          onToggleSeverity={handleToggleSeverity}
          onSubtypeChange={handleSubtypeChange}
          onShowResolvedChange={handleShowResolvedChange}
        />

        <div className="p-6 text-center text-text-muted">
          <p className="text-lg mb-2">No matching decisions</p>
          <p className="text-xs">
            Try adjusting your filters
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Header with select-all */}
      <div className="px-3 py-2 border-b border-border text-xs text-text-muted flex items-center gap-2">
        <label className="flex items-center gap-1.5 cursor-pointer" title="Select all visible decisions">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={handleSelectAllToggle}
            className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
            aria-label="Select all visible decisions"
          />
        </label>
        <span>
          {pendingCount} pending &middot; sorted by priority
        </span>
      </div>

      {/* Filter bar */}
      <FilterBar
        expanded={filtersExpanded}
        onToggle={() => setFiltersExpanded(!filtersExpanded)}
        filters={filters}
        onToggleSeverity={handleToggleSeverity}
        onSubtypeChange={handleSubtypeChange}
        onShowResolvedChange={handleShowResolvedChange}
      />

      {/* Decision items */}
      {filtered.map((d) => {
        const isOverdue = d.dueByTick !== null && d.dueByTick <= currentTick
        const isSelected = d.id === selectedId
        const isChecked = selectedIds.has(d.id)

        return (
          <div
            key={d.id}
            className={`flex items-start border-b border-border transition-colors ${
              isSelected
                ? 'bg-accent/10 border-l-2 border-l-accent'
                : 'hover:bg-surface-2 border-l-2 border-l-transparent'
            } ${d.resolved ? 'opacity-50' : ''}`}
          >
            {/* Checkbox */}
            <label className="flex items-center pl-3 pt-3.5 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggleSelect(d.id)}
                className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                aria-label={`Select decision: ${d.title}`}
              />
            </label>

            {/* Decision content */}
            <button
              onClick={() => onSelect(d.id)}
              className="flex-1 text-left px-2 py-3"
            >
              {/* Title + severity badge */}
              <div className="flex items-start gap-2 mb-1.5">
                <span
                  className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${severityColor[d.severity]}`}
                >
                  {d.severity}
                </span>
                <span className="text-sm text-text-primary line-clamp-2 leading-tight">
                  {d.title}
                </span>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-3 text-[11px] text-text-muted">
                {/* Subtype badge for tool_approval */}
                {(d.subtype === 'tool_approval') && (
                  <span className="px-1 py-0.5 rounded bg-accent/10 text-accent text-[9px] font-medium uppercase">
                    tool
                  </span>
                )}

                {/* Confidence */}
                <span className="flex items-center gap-1">
                  <div className="w-12 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full"
                      style={{ width: `${d.confidence * 100}%` }}
                    />
                  </div>
                  {Math.round(d.confidence * 100)}%
                </span>

                {/* Blast radius */}
                <span className="flex items-center gap-0.5" title={`Blast radius: ${d.blastRadius.magnitude}`}>
                  <Target size={10} />
                  {d.blastRadius.magnitude}
                </span>

                {/* Due / overdue */}
                {d.dueByTick !== null && (
                  <span
                    className={`flex items-center gap-0.5 ${isOverdue ? 'text-danger font-medium' : ''}`}
                  >
                    {isOverdue ? <AlertTriangle size={10} /> : <Clock size={10} />}
                    {isOverdue ? 'overdue' : `T${d.dueByTick}`}
                  </span>
                )}

                {/* Attention score */}
                <span className="ml-auto tabular-nums" title="Attention priority score (0-100)">
                  <span className="text-text-muted font-normal">pri </span>{d.attentionScore}
                </span>
              </div>
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ── Filter bar component ──────────────────────────────────────────

interface FilterBarProps {
  expanded: boolean
  onToggle: () => void
  filters: QueueFilters
  onToggleSeverity: (sev: Severity) => void
  onSubtypeChange: (subtype: QueueFilters['subtype']) => void
  onShowResolvedChange: (show: boolean) => void
}

function FilterBar({
  expanded,
  onToggle,
  filters,
  onToggleSeverity,
  onSubtypeChange,
  onShowResolvedChange,
}: FilterBarProps) {
  return (
    <div className="border-b border-border">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-text-muted hover:text-text-secondary transition-colors"
        aria-label="Toggle filters"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Filters
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 space-y-2.5">
          {/* Severity chips */}
          <div>
            <span className="text-[10px] uppercase text-text-muted block mb-1">Severity</span>
            <div className="flex flex-wrap gap-1">
              {FILTER_SEVERITIES.map((sev) => {
                const active = filters.severities.has(sev)
                return (
                  <button
                    key={sev}
                    onClick={() => onToggleSeverity(sev)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase border transition-colors ${
                      active ? severityChipActive[sev] : severityChipInactive
                    }`}
                    aria-pressed={active}
                    aria-label={`Filter by ${sev} severity`}
                  >
                    {sev}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Type dropdown */}
          <div>
            <span className="text-[10px] uppercase text-text-muted block mb-1">Type</span>
            <select
              value={filters.subtype}
              onChange={(e) => onSubtypeChange(e.target.value as QueueFilters['subtype'])}
              className="w-full px-2 py-1 bg-surface-2 border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent/50"
              aria-label="Filter by decision type"
            >
              <option value="all">All</option>
              <option value="option">Option</option>
              <option value="tool_approval">Tool Approval</option>
            </select>
          </div>

          {/* Show resolved toggle */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.showResolved}
                onChange={(e) => onShowResolvedChange(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                aria-label="Show resolved decisions"
              />
              <span className="text-[11px] text-text-muted">Show resolved</span>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
