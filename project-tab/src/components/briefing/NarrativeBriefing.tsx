/**
 * Renders the multi-paragraph narrative briefing produced by buildBriefing().
 * Converts markdown-style bold (**text**) to <strong> and splits on
 * double-newlines into paragraphs.
 */

interface NarrativeBriefingProps {
  briefing: string
}

function renderLine(line: string, idx: number) {
  // Split on **…** markers to produce alternating text/bold segments
  const parts = line.split(/\*\*(.*?)\*\*/g)
  return (
    <span key={idx}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="text-text-primary font-semibold">
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  )
}

export default function NarrativeBriefing({ briefing }: NarrativeBriefingProps) {
  const paragraphs = briefing.split('\n\n').filter(Boolean)

  return (
    <section className="space-y-4">
      {paragraphs.map((paragraph, idx) => {
        const trimmed = paragraph.trim()

        // Render markdown-style headings as section headings
        if (trimmed.startsWith('## ')) {
          return (
            <h2
              key={idx}
              className="text-lg font-semibold text-text-primary pt-2"
            >
              {trimmed.slice(3)}
            </h2>
          )
        }

        // Numbered list items (1. ... )
        if (/^\d+\.\s/.test(trimmed)) {
          const lines = trimmed.split('\n')
          return (
            <ol key={idx} className="list-decimal list-inside space-y-1.5 text-text-secondary leading-relaxed">
              {lines.map((line, li) => (
                <li key={li}>{renderLine(line.replace(/^\d+\.\s/, ''), li)}</li>
              ))}
            </ol>
          )
        }

        // Regular paragraph — may contain multiple lines
        const lines = trimmed.split('\n')
        return (
          <p key={idx} className="text-text-secondary leading-relaxed">
            {lines.map((line, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {renderLine(line, li)}
              </span>
            ))}
          </p>
        )
      })}
    </section>
  )
}
