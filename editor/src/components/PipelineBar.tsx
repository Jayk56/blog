import { useState, useEffect, useRef } from 'react'
import { ChevronUp, ChevronDown, Play, RefreshCw } from 'lucide-react'
import { runPipeline, fetchJobStatus, Post } from '../lib/api'
import { subscribe as wsSubscribe } from '../lib/ws'
import Terminal from './Terminal'

const STAGES = [
  { key: 'capture', label: 'Capture', tip: 'Record voice memos' },
  { key: 'transcribe', label: 'Transcribe', tip: 'Audio to text via ElevenLabs' },
  { key: 'preprocess', label: 'Preprocess', tip: 'Generate outline from transcript' },
  { key: 'draft', label: 'Draft', tip: 'Write the blog post' },
  { key: 'review', label: 'Review', tip: 'Review and refine the draft' },
  { key: 'collect', label: 'Collect', tip: 'Gather screenshots and embeds' },
  { key: 'publish', label: 'Publish', tip: 'Build Hugo page bundle' },
]

interface PipelineBarProps {
  slug: string
  post: Post
  onPostUpdated: () => void
  leftOpen: boolean
  onToggleLeft: () => void
  rightOpen: boolean
  onToggleRight: () => void
}

export default function PipelineBar({
  slug,
  post,
  onPostUpdated,
  leftOpen,
  onToggleLeft,
  rightOpen,
  onToggleRight,
}: PipelineBarProps) {
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [runningJob, setRunningJob] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<Record<string, any>>({})
  const pipelineOutputRef = useRef<string[]>([])
  const [pipelineOutput, setPipelineOutput] = useState<string[]>([])
  const onPostUpdatedRef = useRef(onPostUpdated)
  onPostUpdatedRef.current = onPostUpdated

  const currentStageIndex = STAGES.findIndex(s => s.key === post.stage)

  const handleRunPipeline = async (action: string) => {
    try {
      pipelineOutputRef.current = []
      setPipelineOutput([])
      setTerminalOpen(true)
      const job = await runPipeline(slug, action)
      setRunningJob(job.jobId)

      // Poll job status
      const checkStatus = async () => {
        try {
          const status = await fetchJobStatus(job.jobId)
          setJobStatus((prev) => ({ ...prev, [job.jobId]: status }))

          if (status.status === 'completed' || status.status === 'failed') {
            setRunningJob(null)
            onPostUpdated()
          } else {
            setTimeout(checkStatus, 500)
          }
        } catch (error) {
          console.error('Failed to check job status:', error)
        }
      }

      checkStatus()
    } catch (error) {
      console.error('Failed to run pipeline:', error)
      setRunningJob(null)
    }
  }

  const getNextAction = () => {
    if (currentStageIndex >= 0 && currentStageIndex < STAGES.length - 1) {
      return STAGES[currentStageIndex + 1]
    }
    return null
  }

  const nextAction = getNextAction()

  useEffect(() => {
    const unsubOutput = wsSubscribe('pipeline-output', (event) => {
      if (event.slug !== slug) return
      pipelineOutputRef.current = [...pipelineOutputRef.current, event.line]
      setPipelineOutput([...pipelineOutputRef.current])
    })
    const unsubComplete = wsSubscribe('pipeline-complete', (event) => {
      if (event.slug !== slug) return
      setRunningJob(null)
      onPostUpdatedRef.current()
    })
    return () => {
      unsubOutput()
      unsubComplete()
    }
  }, [slug])

  return (
    <>
      <div className="border-t border-gray-700 bg-gray-800 flex items-center h-16">
        <div className="flex-1 px-4 py-3 flex items-center gap-2">
          <span className="text-xs text-gray-400">Progress:</span>

          <div className="flex gap-1">
            {STAGES.map((stage, idx) => (
              <div key={stage.key} className="flex items-center group relative">
                <button
                  className={`w-6 h-6 rounded-full text-xs font-medium transition ${
                    idx < currentStageIndex
                      ? 'bg-green-600 text-white'
                      : idx === currentStageIndex
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {idx + 1}
                </button>
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-950 border border-gray-700 rounded text-xs text-gray-200 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                  <span className="font-medium">{stage.label}</span>
                  <span className="text-gray-400 ml-1">— {stage.tip}</span>
                </div>
                {idx < STAGES.length - 1 && (
                  <div
                    className={`w-2 h-0.5 mx-1 ${
                      idx < currentStageIndex
                        ? 'bg-green-600'
                        : 'bg-gray-700'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 px-4">
          <button
            onClick={onToggleLeft}
            className="text-gray-400 hover:text-gray-200 transition p-1 hover:bg-gray-700 rounded"
            title={leftOpen ? 'Hide reference panel' : 'Show reference panel'}
          >
            {leftOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          <button
            onClick={onToggleRight}
            className="text-gray-400 hover:text-gray-200 transition p-1 hover:bg-gray-700 rounded"
            title={rightOpen ? 'Hide assets panel' : 'Show assets panel'}
          >
            {rightOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          <button
            onClick={() => setTerminalOpen(!terminalOpen)}
            className={`px-3 py-1 text-sm rounded transition ${
              terminalOpen
                ? 'bg-gray-700 text-gray-200'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Terminal
          </button>

          {post.stage === 'review' && (
            <button
              onClick={() => handleRunPipeline('review')}
              disabled={runningJob !== null}
              className={`btn-sm flex items-center gap-2 border border-blue-500 text-blue-400 hover:bg-blue-500/10 rounded transition ${
                runningJob ? 'opacity-75 cursor-not-allowed' : ''
              }`}
              title="Re-run the review agent on the updated draft"
            >
              {runningJob ? (
                <>
                  <div className="animate-spin">
                    <RefreshCw size={16} />
                  </div>
                  Reviewing...
                </>
              ) : (
                <>
                  <RefreshCw size={16} />
                  Re-review
                </>
              )}
            </button>
          )}

          {nextAction && (
            <button
              onClick={() => handleRunPipeline(nextAction.key)}
              disabled={runningJob !== null}
              className={`btn-primary btn-sm flex items-center gap-2 ${
                runningJob ? 'opacity-75 cursor-not-allowed' : ''
              }`}
            >
              {runningJob ? (
                <>
                  <div className="animate-spin">
                    <Play size={16} />
                  </div>
                  Running...
                </>
              ) : (
                <>
                  <Play size={16} />
                  {nextAction.label}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <Terminal slug={slug} isOpen={terminalOpen} onClose={() => setTerminalOpen(false)} initialOutput={pipelineOutput} />
    </>
  )
}
