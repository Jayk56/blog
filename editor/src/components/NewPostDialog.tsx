import { useState } from 'react'
import { X } from 'lucide-react'
import { createPost } from '../lib/api'

interface NewPostDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
}

export default function NewPostDialog({
  isOpen,
  onClose,
  onCreated,
}: NewPostDialogProps) {
  const [slug, setSlug] = useState('')
  const [category, setCategory] = useState('learned')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const validateSlug = (value: string) => {
    return /^[a-z0-9-]*$/.test(value) && !value.startsWith('-') && !value.endsWith('-')
  }

  const handleCreate = async () => {
    setError('')

    if (!slug.trim()) {
      setError('Slug is required')
      return
    }

    if (!validateSlug(slug)) {
      setError('Slug must contain only lowercase letters, numbers, and hyphens')
      return
    }

    try {
      setLoading(true)
      await createPost(slug, category)
      setSlug('')
      setCategory('learned')
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create post')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="panel p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-100">New Post</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition"
          >
            <X size={24} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Slug
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-post-title"
              className="input-base"
              disabled={loading}
            />
            <p className="text-xs text-gray-400 mt-1">
              Lowercase letters, numbers, and hyphens only
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="select-base"
              disabled={loading}
            >
              <option value="found">Found</option>
              <option value="learned">Learned</option>
              <option value="built">Built</option>
            </select>
          </div>

          {error && (
            <div className="p-3 bg-red-900 border border-red-700 rounded text-red-200 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              className="btn-secondary flex-1"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              className="btn-primary flex-1"
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
