import { useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { readFile, writeFile, postMetadata, Post } from '../lib/api'
import { useWebSocket } from '../lib/ws'

export interface EditorHandle {
  insertAtCursor: (text: string) => boolean
}

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
  review: (slug: string) => `output/draft/${slug}/draft.md`,
};

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor({ slug, post }, ref) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(true)
  const [wordCount, setWordCount] = useState(0)
  const cmRef = useRef<ReactCodeMirrorRef>(null)
  const savingTimeoutRef = useRef<NodeJS.Timeout>()
  const justSavedPathRef = useRef<string | null>(null)
  const justSavedTimerRef = useRef<NodeJS.Timeout>()
  const dirtyRef = useRef(false)
  const contentRef = useRef('')
  const editRevisionRef = useRef(0)
  const sessionStartRef = useRef<string | null>(null)
  const sessionSaveCountRef = useRef(0)
  const sessionWordCountStartRef = useRef(0)
  const ws = useWebSocket()

  useImperativeHandle(ref, () => ({
    insertAtCursor(text: string) {
      const view = cmRef.current?.view
      if (!view) return false
      const pos = view.state.selection.main.head
      view.dispatch({
        changes: { from: pos, insert: text },
        selection: { anchor: pos + text.length },
      })
      view.focus()
      return true
    },
  }))

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

      // Track editing session metadata
      sessionSaveCountRef.current += 1
      if (sessionSaveCountRef.current % 5 === 0 && sessionStartRef.current) {
        const words = text.trim().split(/\s+/).filter(Boolean).length
        postMetadata(saveSlug, {
          editing: {
            sessions: [{
              started_at: sessionStartRef.current,
              last_save_at: new Date().toISOString(),
              save_count: sessionSaveCountRef.current,
              stage: post.stage,
              word_count_start: sessionWordCountStartRef.current,
              word_count_end: words,
            }],
          },
        }).catch(err => console.error('Failed to post editing metadata:', err))
      }
    } catch (error) {
      console.error('Failed to save content:', error)
    } finally {
      setSaving(false)
    }
  }, [post.stage])

  const updateContent = useCallback((text: string, startSession = false) => {
    setContent(text)
    contentRef.current = text
    setWordCount(text.trim().split(/\s+/).filter(Boolean).length)
    dirtyRef.current = false
    setSaved(true)
    if (startSession) {
      sessionStartRef.current = new Date().toISOString()
      sessionSaveCountRef.current = 0
      sessionWordCountStartRef.current = text.trim().split(/\s+/).filter(Boolean).length
    }
  }, [])

  const loadContent = useCallback(async ({ cancelPendingSave = true, showLoading = false } = {}) => {
    if (cancelPendingSave && savingTimeoutRef.current) {
      clearTimeout(savingTimeoutRef.current)
      savingTimeoutRef.current = undefined
    }
    try {
      if (showLoading) setLoading(true)
      const path = getEditorPath()
      let text = ''
      if (path) {
        const data = await readFile(slug, path)
        text = data || getTomlTemplate()
      }
      updateContent(text, true)
    } catch (error) {
      console.error('Failed to load editor content:', error)
      updateContent('')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [slug, getEditorPath, updateContent])

  const handleChange = useCallback((value: string) => {
    setContent(value)
    contentRef.current = value
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
    loadContent({ showLoading: true })
  }, [loadContent])

  // Subscribe to file-changed events (separate from save timer cleanup)
  useEffect(() => {
    const unsubscribe = ws.subscribe('file-changed', async (event) => {
      const editorPath = getEditorPath()
      if (event.slug === slug && event.path === editorPath) {
        // Skip echo from our own save (fast path to avoid unnecessary fetch)
        if (justSavedPathRef.current === event.path) {
          justSavedPathRef.current = null
          if (justSavedTimerRef.current) clearTimeout(justSavedTimerRef.current)
          return
        }
        // Don't overwrite unsaved or in-flight user edits with external changes
        if (dirtyRef.current || savingTimeoutRef.current) return
        // Fetch and compare content — skip update if identical (catches late echoes)
        try {
          const serverText = await readFile(slug, editorPath!)
          if (serverText === contentRef.current) return
          updateContent(serverText || getTomlTemplate())
        } catch (error) {
          console.error('Failed to reload editor content:', error)
        }
      }
    })
    return () => {
      unsubscribe()
    }
  }, [slug, post.stage, ws, getEditorPath, updateContent])

  // Clean up timers and flush session metadata on unmount
  useEffect(() => {
    return () => {
      if (savingTimeoutRef.current) {
        clearTimeout(savingTimeoutRef.current)
      }
      if (justSavedTimerRef.current) {
        clearTimeout(justSavedTimerRef.current)
      }
      // Flush final session metadata
      if (sessionStartRef.current && sessionSaveCountRef.current > 0) {
        const words = contentRef.current.trim().split(/\s+/).filter(Boolean).length
        postMetadata(slug, {
          editing: {
            sessions: [{
              started_at: sessionStartRef.current,
              last_save_at: new Date().toISOString(),
              save_count: sessionSaveCountRef.current,
              stage: post.stage,
              word_count_start: sessionWordCountStartRef.current,
              word_count_end: words,
            }],
          },
        }).catch(() => {}) // fire and forget on unmount
      }
    }
  }, [slug, post.stage])

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
        ref={cmRef}
        value={content}
        onChange={handleChange}
        extensions={[markdown(), EditorView.lineWrapping]}
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
})

export default Editor
