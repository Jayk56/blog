/**
 * Map workspace — two sub-views: Coherence Map and Knowledge Map.
 *
 * "Why is something off?" — the diagnostic workspace.
 */

import { useState } from 'react'
import { useProjectState } from '../../lib/context.js'
import CoherenceMap from './CoherenceMap.js'
import KnowledgeMap from './KnowledgeMap.js'
import MapDetailPanel, { type Selection } from './MapDetailPanel.js'

type Tab = 'coherence' | 'knowledge'

export default function MapWorkspace() {
  const state = useProjectState()
  const [activeTab, setActiveTab] = useState<Tab>('coherence')
  const [selection, setSelection] = useState<Selection | null>(null)

  if (!state.project) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        No project loaded
      </div>
    )
  }

  return (
    <div className="flex h-full -m-6">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {/* Tab bar */}
        <div className="flex border-b border-border px-4">
          {(['coherence', 'knowledge'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSelection(null) }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
              }`}
            >
              {tab === 'coherence' ? 'Coherence' : 'Knowledge'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-5">
          {activeTab === 'coherence' ? (
            <CoherenceMap
              onSelectIssue={(issue) => setSelection({ kind: 'issue', data: issue })}
              onSelectWorkstream={(ws) => setSelection({ kind: 'workstream', data: ws })}
            />
          ) : (
            <KnowledgeMap
              onSelectArtifact={(a) => setSelection({ kind: 'artifact', data: a })}
            />
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selection && (
        <MapDetailPanel
          selection={selection}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  )
}
