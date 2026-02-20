import type { ActionKind } from './events'

/** Resolution for option-style decisions. */
export interface OptionDecisionResolution {
  type: 'option'
  chosenOptionId: string
  rationale: string
  actionKind: ActionKind
}

/** Resolution for tool approval decisions. */
export interface ToolApprovalResolution {
  type: 'tool_approval'
  action: 'approve' | 'reject' | 'modify'
  modifiedArgs?: Record<string, unknown>
  alwaysApprove?: boolean
  rationale?: string
  actionKind: ActionKind
  /** True when the system auto-resolved this decision (e.g. ecosystem/adaptive mode). */
  autoResolved?: boolean
}

/** Canonical resolution union used by backend APIs and plugin calls. */
export type Resolution = OptionDecisionResolution | ToolApprovalResolution

/** Compatibility shape from the design doc's transport examples. */
export interface LegacyResolution {
  resolutionType: 'approve' | 'reject' | 'modify' | 'choose_option'
  chosenOptionId?: string
  modifiedArgs?: Record<string, unknown>
  alwaysApprove?: boolean
  rationale: string
  actionKind: ActionKind
}
