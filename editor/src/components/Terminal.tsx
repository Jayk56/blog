import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useWebSocket } from '../lib/ws'

interface TerminalProps {
  slug: string
  isOpen: boolean
  onClose: () => void
}

export default function Terminal({ slug, isOpen, onClose }: TerminalProps) {
  const [output, setOutput] = useState<string[]>([])
  const scrollEndRef = useRef<HTMLDivElement>(null)
  const ws = useWebSocket()

  useEffect(() => {
    const unsubscribe = ws.subscribe('pipeline-output', (event) => {
      setOutput((prev) => [...prev, event.line])
    })
    return unsubscribe
  }, [slug])

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [output])

  if (!isOpen) return null

  return (
    <div className="border-t border-gray-700 bg-gray-950 flex flex-col h-64">
      <div className="flex justify-between items-center px-4 py-2 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-gray-200">Terminal</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setOutput([])}
            className="text-gray-400 hover:text-gray-200 text-xs px-2 py-1 hover:bg-gray-800 rounded transition"
          >
            Clear
          </button>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 font-mono text-sm text-gray-300">
        {output.length === 0 ? (
          <div className="text-gray-600">Waiting for pipeline output...</div>
        ) : (
          <>
            {output.map((line, idx) => (
              <div key={idx} className="text-gray-400">
                {line}
              </div>
            ))}
            <div ref={scrollEndRef} />
          </>
        )}
      </div>
    </div>
  )
}
