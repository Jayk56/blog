import type { EventEnvelope, GuardrailEvent, Severity } from './types'

/** Workspace identifiers used by frontend tabs. */
export type Workspace = 'briefing' | 'queue' | 'map' | 'controls'

/** Classified event with primary and secondary workspace targets. */
export interface ClassifiedEvent {
  workspace: Workspace
  secondaryWorkspaces: Workspace[]
  envelope: EventEnvelope
}

const SEVERITY_ORDER: Record<Severity, number> = {
  warning: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
}

/**
 * EventClassifier routes envelopes to primary and secondary workspaces.
 */
export class EventClassifier {
  /** Classifies an event into workspace targets for UI delivery. */
  classify(envelope: EventEnvelope): ClassifiedEvent {
    const event = envelope.event

    switch (event.type) {
      case 'status':
        return { workspace: 'briefing', secondaryWorkspaces: [], envelope }

      case 'decision':
        if (event.subtype === 'option') {
          return { workspace: 'queue', secondaryWorkspaces: ['briefing'], envelope }
        }
        return { workspace: 'queue', secondaryWorkspaces: ['controls'], envelope }

      case 'artifact':
        return { workspace: 'map', secondaryWorkspaces: ['briefing'], envelope }

      case 'coherence':
        return {
          workspace: 'map',
          secondaryWorkspaces: this.isHighSeverity(event.severity) ? ['queue'] : [],
          envelope
        }

      case 'tool_call':
        return { workspace: 'controls', secondaryWorkspaces: [], envelope }

      case 'completion':
        return { workspace: 'briefing', secondaryWorkspaces: ['controls'], envelope }

      case 'error':
        return {
          workspace: 'controls',
          secondaryWorkspaces: this.isHighSeverity(event.severity) ? ['briefing'] : [],
          envelope
        }

      case 'delegation':
        return { workspace: 'controls', secondaryWorkspaces: ['briefing'], envelope }

      case 'guardrail':
        return {
          workspace: 'controls',
          secondaryWorkspaces: this.isGuardrailBlock(event) ? ['queue'] : [],
          envelope
        }

      case 'lifecycle':
        return { workspace: 'controls', secondaryWorkspaces: ['briefing'], envelope }

      case 'progress':
        return { workspace: 'briefing', secondaryWorkspaces: [], envelope }

      case 'raw_provider':
        return { workspace: 'controls', secondaryWorkspaces: [], envelope }

      default:
        return { workspace: 'controls', secondaryWorkspaces: [], envelope }
    }
  }

  private isHighSeverity(severity: Severity): boolean {
    return SEVERITY_ORDER[severity] >= SEVERITY_ORDER.high
  }

  private isGuardrailBlock(event: GuardrailEvent): boolean {
    return event.tripped
  }
}
