import { useEffect, useState, useRef } from 'react'
import { readFile, writeFile } from '../lib/api'
import { useWebSocket } from '../lib/ws'

interface ReferencePanelProps {
  slug: string
  stage?: string
}

type TabType = 'outline' | 'transcript' | 'notes' | 'review'

export default function ReferencePanel({ slug, stage }: ReferencePanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('outline')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesSaved, setNotesSaved] = useState(true)
  const saveTimeoutRef = useRef<NodeJS.Timeout>()
  const justSavedRef = useRef(false)
  const ws = useWebSocket()

  const tabFiles: Record<TabType, string> = {
    outline: `output/outline/${slug}/outline.md`,
    transcript: `output/transcribe/${slug}/transcript.md`,
    notes: `audio-notes/${slug}/notes.md`,
    review: `output/review/${slug}/review.md`,
  }

  // Show the review tab when the post is at review stage or later
  const reviewStages = ['review', 'collect', 'publish']
  const showReviewTab = stage ? reviewStages.includes(stage) : false

  // Auto-switch to review tab when entering review stage
  useEffect(() => {
    if (showReviewTab && activeTab === 'outline') {
      setActiveTab('review')
    }
  }, [showReviewTab])

  const loadContent = async () => {
    try {
      setLoading(true)
      const data = await readFile(slug, tabFiles[activeTab])
      setContent(data || '')
    } catch (error) {
      console.error('Failed to load reference content:', error)
      setContent('')
    } finally {
      setLoading(false)
    }
  }

  const saveNotes = async (text: string) => {
    try {
      setNotesSaving(true)
      setNotesSaved(false)
      justSavedRef.current = true
      await writeFile(slug, tabFiles['notes'], text)
      setNotesSaved(true)
      // Keep the guard up briefly so chokidar's file-changed event is ignored
      setTimeout(() => { justSavedRef.current = false }, 2000)
    } catch (error) {
      console.error('Failed to save notes:', error)
    } finally {
      setNotesSaving(false)
    }
  }

  const handleNotesChange = (value: string) => {
    setContent(value)
    setNotesSaved(false)

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveNotes(value)
    }, 1000)
  }

  useEffect(() => {
    loadContent()
  }, [activeTab, slug])

  useEffect(() => {
    const unsubscribe = ws.subscribe('file-changed', (event) => {
      if (event.slug === slug && event.path === tabFiles[activeTab]) {
        // Skip reload if this is our own save bouncing back via chokidar
        if (activeTab === 'notes' && justSavedRef.current) return
        loadContent()
      }
    })
    return unsubscribe
  }, [slug, activeTab])

  // Cleanup save timeout on unmount only (separate from WS effect
  // so re-renders don't cancel the debounce timer)
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const getEmptyMessage = () => {
    switch (activeTab) {
      case 'outline':
        return 'No outline yet. Run the preprocess stage to generate it.'
      case 'transcript':
        return 'No transcript yet. Run the transcribe stage to generate it.'
      case 'notes':
        return 'No notes yet. Start typing to add notes.'
      case 'review':
        return 'No review yet. Run the review agent to generate feedback.'
    }
  }

  const availableTabs: TabType[] = showReviewTab
    ? ['review', 'outline', 'transcript', 'notes']
    : ['outline', 'transcript', 'notes']

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-gray-700">
        {availableTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition ${
              activeTab === tab
                ? 'text-blue-400 border-blue-500'
                : 'text-gray-400 border-transparent hover:text-gray-300'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto flex flex-col">
        {loading ? (
          <div className="text-gray-400 text-sm p-4">Loading...</div>
        ) : activeTab === 'notes' ? (
          <>
            <textarea
              value={content}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Start typing notes here..."
              className="flex-1 w-full bg-transparent text-gray-300 text-sm font-mono p-4 resize-none outline-none placeholder-gray-600"
            />
            <div className="border-t border-gray-700 px-4 py-1.5 text-xs text-gray-400 flex justify-end">
              {notesSaving && <span className="text-blue-400">Saving...</span>}
              {notesSaved && !notesSaving && content && <span className="text-green-400">Saved</span>}
              {!notesSaved && !notesSaving && <span className="text-yellow-400">Unsaved</span>}
            </div>
          </>
        ) : content ? (
          <div className="text-gray-300 text-sm whitespace-pre-wrap font-mono p-4">
            {content}
          </div>
        ) : (
          <div className="text-gray-500 text-sm italic p-4">{getEmptyMessage()}</div>
        )}
      </div>
    </div>
  )
}
