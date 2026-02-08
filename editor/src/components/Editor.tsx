import { useEffect, useState, useRef, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { readFile, writeFile, Post } from '../lib/api'
import { useWebSocket } from '../lib/ws'

interface EditorProps {
  slug: string
  post: Post
}

function getTomlTemplate() {
  return `+++
title = ''
date = ${new Date().toISOString()}
draft = true
tags = []
+++

`;
}

const editorPaths: Record<string, (slug: string) => string> = {
  draft: (slug: string) => `output/draft/${slug}/draft.md`,
  review: (slug: string) => `output/review/${slug}/review.md`,
};

export default function Editor({ slug, post }: EditorProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(true)
  const [wordCount, setWordCount] = useState(0)
  const savingTimeoutRef = useRef<NodeJS.Timeout>()
  const justSavedPathRef = useRef<string | null>(null)
  const justSavedTimerRef = useRef<NodeJS.Timeout>()
  const dirtyRef = useRef(false)
  const editRevisionRef = useRef(0)
  const ws = useWebSocket()

  const getEditorPath = useCallback(() => {
    const pathFn = editorPaths[post.stage as keyof typeof editorPaths]
    return pathFn ? pathFn(slug) : null
  }, [slug, post.stage])

  const canEdit = ['draft', 'review'].includes(post.stage)

  // Save content to a specific path (captured at schedule time to prevent cross-post writes)
  const doSave = useCallback(async (text: string, savePath: string, saveSlug: string, revision: number) => {
    try {
      setSaving(true)
      setSaved(false)
      await writeFile(saveSlug, savePath, text)
      // Only clear dirty if no newer edits occurred during the save
      if (editRevisionRef.current === revision) {
        dirtyRef.current = false
        setSaved(true)
      }
      // Prevent the file watcher from reloading content we just saved
      justSavedPathRef.current = savePath
      if (justSavedTimerRef.current) clearTimeout(justSavedTimerRef.current)
      justSavedTimerRef.current = setTimeout(() => { justSavedPathRef.current = null }, 2000)
    } catch (error) {
      console.error('Failed to save content:', error)
    } finally {
      setSaving(false)
    }
  }, [])

  const loadContent = useCallback(async (cancelPendingSave = true) => {
    if (cancelPendingSave && savingTimeoutRef.current) {
      clearTimeout(savingTimeoutRef.current)
      savingTimeoutRef.current = undefined
    }
    try {
      setLoading(true)
      const path = getEditorPath()
      let text = ''
      if (path) {
        const data = await readFile(slug, path)
        text = data || getTomlTemplate()
      }
      setContent(text)
      setWordCount(text.trim().split(/\s+/).filter(Boolean).length)
      dirtyRef.current = false
      setSaved(true)
    } catch (error) {
      console.error('Failed to load editor content:', error)
      setContent('')
      setWordCount(0)
    } finally {
      setLoading(false)
    }
  }, [slug, getEditorPath])

  const handleChange = useCallback((value: string) => {
    setContent(value)
    dirtyRef.current = true
    editRevisionRef.current += 1
    setSaved(false)

    // Calculate word count
    const words = value.trim().split(/\s+/).filter(Boolean).length
    setWordCount(words)

    // Capture save target and revision at schedule time
    const savePath = getEditorPath()
    if (!savePath || !canEdit) return
    const revision = editRevisionRef.current

    // Debounced save
    if (savingTimeoutRef.current) {
      clearTimeout(savingTimeoutRef.current)
    }
    savingTimeoutRef.current = setTimeout(() => {
      savingTimeoutRef.current = undefined
      doSave(value, savePath, slug, revision)
    }, 1000)
  }, [getEditorPath, canEdit, slug, doSave])

  // Load content when slug or stage changes; cancel any pending save for the old post
  useEffect(() => {
    if (savingTimeoutRef.current) {
      clearTimeout(savingTimeoutRef.current)
      savingTimeoutRef.current = undefined
    }
    loadContent()
  }, [loadContent])

  // Subscribe to file-changed events (separate from save timer cleanup)
  useEffect(() => {
    const unsubscribe = ws.subscribe('file-changed', (event) => {
      if (event.slug === slug && event.path === getEditorPath()) {
        // Skip echo from our own save
        if (justSavedPathRef.current === event.path) {
          justSavedPathRef.current = null
          if (justSavedTimerRef.current) clearTimeout(justSavedTimerRef.current)
          return
        }
        // Don't overwrite unsaved or in-flight user edits with external changes
        if (dirtyRef.current || savingTimeoutRef.current) return
        loadContent(false)
      }
    })
    return () => {
      unsubscribe()
    }
  }, [slug, post.stage, ws, getEditorPath, loadContent])

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (savingTimeoutRef.current) {
        clearTimeout(savingTimeoutRef.current)
      }
      if (justSavedTimerRef.current) {
        clearTimeout(justSavedTimerRef.current)
      }
    }
  }, [])

  const readingTime = Math.ceil(wordCount / 200)

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="text-gray-400">Loading editor...</div>
      </div>
    )
  }

  if (!canEdit) {
    return (
      <div className="flex flex-col justify-center items-center h-full p-8 text-center">
        <div className="text-gray-400">
          <p className="mb-4">Advance to draft stage to start writing</p>
          <p className="text-sm">Current stage: {post.stage}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <CodeMirror
        value={content}
        onChange={handleChange}
        extensions={[markdown()]}
        theme="dark"
        className="flex-1 cm-editor-wrapper"
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          foldGutter: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          highlightSelectionMatches: true,
          searchKeymap: true,
        }}
      />

      <div className="border-t border-gray-700 bg-gray-800 px-4 py-2 text-xs text-gray-400 flex justify-between items-center">
        <div className="flex gap-6">
          <span>{wordCount} words</span>
          <span>{readingTime} min read</span>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-blue-400">Saving...</span>}
          {saved && !saving && <span className="text-green-400">Saved</span>}
          {!saved && !saving && <span className="text-yellow-400">Unsaved</span>}
        </div>
      </div>
    </div>
  )
}
