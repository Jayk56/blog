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
  const ws = useWebSocket()

  const getEditorPath = useCallback(() => {
    const pathFn = editorPaths[post.stage as keyof typeof editorPaths]
    return pathFn ? pathFn(slug) : null
  }, [slug, post.stage])

  const canEdit = ['draft', 'review'].includes(post.stage)

  const loadContent = async () => {
    try {
      setLoading(true)
      const path = getEditorPath()
      if (!path) {
        setContent('')
      } else {
        const data = await readFile(slug, path)
        setContent(data || getTomlTemplate())
      }
    } catch (error) {
      console.error('Failed to load editor content:', error)
      setContent('')
    } finally {
      setLoading(false)
    }
  }

  const saveContent = async (text: string) => {
    const path = getEditorPath()
    if (!path || !canEdit) return

    try {
      setSaving(true)
      setSaved(false)
      await writeFile(slug, path, text)
      setSaved(true)
    } catch (error) {
      console.error('Failed to save content:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (value: string) => {
    setContent(value)
    setSaved(false)

    // Calculate word count (rough estimate)
    const words = value.trim().split(/\s+/).length
    setWordCount(Math.max(0, words - 10)) // Subtract approximate front matter words

    // Debounced save
    if (savingTimeoutRef.current) {
      clearTimeout(savingTimeoutRef.current)
    }
    savingTimeoutRef.current = setTimeout(() => {
      saveContent(value)
    }, 1000)
  }

  useEffect(() => {
    loadContent()
  }, [slug, post.stage])

  useEffect(() => {
    const unsubscribe = ws.subscribe('file-changed', (event) => {
      if (event.slug === slug && event.path === getEditorPath()) {
        loadContent()
      }
    })
    return () => {
      if (savingTimeoutRef.current) {
        clearTimeout(savingTimeoutRef.current)
      }
      unsubscribe()
    }
  }, [slug, post.stage, ws, getEditorPath])

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
