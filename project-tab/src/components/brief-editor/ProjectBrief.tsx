/**
 * Project brief section — displays goals and high-level description.
 */

import type { Project } from '../../types/index.js'

interface ProjectBriefProps {
  project: Project
}

export default function ProjectBrief({ project }: ProjectBriefProps) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
        Project Brief
      </h2>

      <div className="p-4 rounded-lg bg-surface-1 border border-border space-y-4">
        <div>
          <h3 className="text-base font-semibold text-text-primary mb-1">
            Description
          </h3>
          <p className="text-sm text-text-primary">
            {project.description}
          </p>
        </div>

        <div>
          <h3 className="text-base font-semibold text-text-primary mb-2">
            Goals
          </h3>
          <ul className="space-y-1.5">
            {project.goals.map((goal, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-text-primary"
              >
                <span className="text-accent mt-0.5 flex-shrink-0">--</span>
                <span>{goal}</span>
              </li>
            ))}
          </ul>
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
