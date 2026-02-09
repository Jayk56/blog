import { useEffect, useRef, useMemo } from 'react'
import { X } from 'lucide-react'

interface TerminalProps {
  slug: string
  isOpen: boolean
  onClose: () => void
  initialOutput?: string[]
}

// ANSI color code → Tailwind class mapping
// Covers the codes used by pipeline scripts: red, green, yellow, blue, bold, reset
const ANSI_CLASSES: Record<string, string> = {
  '0':    '',                // reset
  '1':    'font-bold',       // bold
  '0;31': 'text-red-400',    // red
  '0;32': 'text-green-400',  // green
  '1;33': 'text-yellow-300', // yellow (bold)
  '0;34': 'text-blue-400',   // blue
}

interface AnsiSpan {
  text: string
  className: string
}

function parseAnsi(line: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  // Match ANSI escape sequences: ESC[ ... m
  const regex = /\x1b\[([0-9;]*)m/g
  let lastIndex = 0
  let currentClass = ''
  let match

  while ((match = regex.exec(line)) !== null) {
    // Push text before this escape sequence
    if (match.index > lastIndex) {
      spans.push({ text: line.slice(lastIndex, match.index), className: currentClass })
    }
    // Update style based on the code
    const code = match[1]
    if (code === '0' || code === '') {
      currentClass = ''
    } else {
      const mapped = ANSI_CLASSES[code]
      if (mapped !== undefined) {
        currentClass = mapped
      }
    }
    lastIndex = regex.lastIndex
  }

  // Push remaining text
  if (lastIndex < line.length) {
    spans.push({ text: line.slice(lastIndex), className: currentClass })
  }

  // If no escape codes were found, return the whole line
  if (spans.length === 0) {
    spans.push({ text: line, className: '' })
  }

  return spans
}

function TerminalLine({ line }: { line: string }) {
  const spans = useMemo(() => parseAnsi(line), [line])

  if (spans.length === 1 && !spans[0].className) {
    return <div className="text-gray-300 leading-relaxed">{spans[0].text}</div>
  }

  return (
    <div className="text-gray-300 leading-relaxed">
      {spans.map((span, i) =>
        span.className ? (
          <span key={i} className={span.className}>{span.text}</span>
        ) : (
          <span key={i}>{span.text}</span>
        )
      )}
    </div>
  )
}

export default function Terminal({ slug, isOpen, onClose, initialOutput = [] }: TerminalProps) {
  const scrollEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [initialOutput])

  if (!isOpen) return null

  return (
    <div className="border-t border-gray-700 bg-gray-950 flex flex-col h-64">
      <div className="flex justify-between items-center px-4 py-2 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-gray-200">Terminal</h3>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 font-mono text-sm">
        {initialOutput.length === 0 ? (
          <div className="text-gray-600">Waiting for pipeline output...</div>
        ) : (
          <>
            {initialOutput.map((line, idx) => (
              <TerminalLine key={idx} line={line} />
            ))}
            <div ref={scrollEndRef} />
          </>
        )}
      </div>
    </div>
  )
}
