/**
 * Review pattern analysis — the "mirror" in the Controls workspace.
 *
 * Shows the human their own review behavior so they can calibrate
 * how much oversight to apply.
 *
 * "You review 95% of code outputs but only 40% of documentation outputs.
 * Your documentation error rate is still low. You could probably review
 * 20% and maintain quality."
 */

import type { ReviewPattern } from '../../types/index.js'

interface ReviewPatternsProps {
  patterns: ReviewPattern[]
}

export default function ReviewPatterns({ patterns }: ReviewPatternsProps) {
  if (patterns.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
          Review Patterns
        </h2>
        <p className="text-sm text-text-muted p-3 rounded-lg bg-surface-1 border border-border">
          Insufficient data to analyze review patterns.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
        Review Patterns
      </h2>

      <div className="space-y-2">
        {patterns.map((pattern) => (
          <div
            key={pattern.artifactKind}
            className="p-3 rounded-lg bg-surface-1 border border-border space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-primary capitalize">
                {pattern.artifactKind}
              </span>
              <span className="text-xs text-text-muted">
                reviewing {pattern.reviewRate}%
              </span>
            </div>

            {/* Bar visualization */}
            <div className="flex gap-1 h-1.5">
              <div
                className="bg-accent rounded-full"
                style={{ width: `${pattern.reviewRate}%` }}
                title={`Review rate: ${pattern.reviewRate}%`}
              />
              <div
                className="bg-surface-3 rounded-full flex-1"
              />
            </div>

            {/* Stats row */}
            <div className="flex gap-4 text-[10px] text-text-muted">
              <span>
                Rework: <span className={pattern.reworkRate > 15 ? 'text-warning' : 'text-text-secondary'}>{pattern.reworkRate}%</span>
              </span>
              <span>
                Miss: <span className={pattern.missRate > 5 ? 'text-danger' : 'text-text-secondary'}>{pattern.missRate}%</span>
              </span>
              <span>
                Suggested: <span className="text-info">{pattern.suggestedReviewRate}%</span>
              </span>
            </div>

            {/* System suggestion */}
            <p className="text-xs text-text-muted italic">{pattern.suggestion}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
