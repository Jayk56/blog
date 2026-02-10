import { NavLink, Route, Routes } from 'react-router-dom'
import {
  BookOpen,
  GitGraph,
  Inbox,
  Map,
  Settings,
} from 'lucide-react'
import VitalStrip from './spine/VitalStrip'
import BriefingWorkspace from './briefing/BriefingWorkspace.js'
import BriefEditorWorkspace from './brief-editor/BriefEditorWorkspace.js'
import QueueWorkspace from './queue/QueueWorkspace.js'
import ControlsWorkspace from './controls/ControlsWorkspace.js'
import MapWorkspace from './map/MapWorkspace.js'

const navItems = [
  { to: '/', icon: BookOpen, label: 'Briefing', end: true },
  { to: '/queue', icon: Inbox, label: 'Queue' },
  { to: '/map', icon: Map, label: 'Map' },
  { to: '/brief', icon: GitGraph, label: 'Brief' },
  { to: '/controls', icon: Settings, label: 'Controls' },
] as const

export default function Shell() {
  return (
    <div className="min-h-screen flex flex-col">
      <VitalStrip />

      <div className="flex flex-1 overflow-hidden">
        <nav className="w-14 flex-shrink-0 bg-surface-1 border-r border-border flex flex-col items-center py-3 gap-1">
          {navItems.map(({ to, icon: Icon, label, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest}
              className={({ isActive }) =>
                `w-10 h-12 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'
                }`
              }
              title={label}
            >
              <Icon size={16} />
              <span className="text-[9px] leading-none">{label}</span>
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route index element={<BriefingWorkspace />} />
            <Route path="queue" element={<QueueWorkspace />} />
            <Route path="map" element={<MapWorkspace />} />
            <Route path="brief" element={<BriefEditorWorkspace />} />
            <Route path="controls" element={<ControlsWorkspace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
