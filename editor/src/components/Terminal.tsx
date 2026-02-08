import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface TerminalProps {
  slug: string
  isOpen: boolean
  onClose: () => void
  initialOutput?: string[]
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

      <div className="flex-1 overflow-auto p-4 font-mono text-sm text-gray-300">
        {initialOutput.length === 0 ? (
          <div className="text-gray-600">Waiting for pipeline output...</div>
        ) : (
          <>
            {initialOutput.map((line, idx) => (
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
