/**
 * Severity badge — small colored pill showing severity level.
 * Used across the Decision Queue, Activity Feed, and Map workspace.
 */

import type { Severity } from '../../types/index.js'

interface SeverityBadgeProps {
  severity: Severity
}

const styles: Record<Severity, string> = {
  critical: 'bg-danger/15 text-danger border-danger/30',
  high: 'bg-warning/15 text-warning border-warning/30',
  medium: 'bg-info/15 text-info border-info/30',
  low: 'bg-surface-2 text-text-muted border-border',
  info: 'bg-surface-2 text-text-muted border-border',
}

export default function SeverityBadge({ severity }: SeverityBadgeProps) {
  if (severity === 'info') return null

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0 text-[10px] font-medium rounded border ${styles[severity]}`}
    >
      {severity}
    </span>
  )
}
