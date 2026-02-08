import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { fetchPost, Post } from '../lib/api'
import { useWebSocket } from '../lib/ws'
import ReferencePanel from './ReferencePanel'
import Editor from './Editor'
import AssetGallery from './AssetGallery'
import PipelineBar from './PipelineBar'

export default function Workspace() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const ws = useWebSocket()

  if (!slug) {
    navigate('/')
    return null
  }

  const loadPost = async () => {
    try {
      setLoading(true)
      const data = await fetchPost(slug)
      setPost(data)
    } catch (error) {
      console.error('Failed to load post:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPost()
  }, [slug])

  useEffect(() => {
    const unsubscribe = ws.subscribe('manifest-changed', () => {
      loadPost()
    })
    return unsubscribe
  }, [slug, ws])

  if (loading) {
    return (
      <div className="workspace">
        <div className="flex justify-center items-center flex-1">
          <div className="text-gray-400">Loading post...</div>
        </div>
      </div>
    )
  }

  if (!post) {
    return (
      <div className="workspace">
        <div className="flex justify-center items-center flex-1">
          <div className="text-gray-400">Post not found</div>
        </div>
      </div>
    )
  }

  return (
    <div className="workspace">
      <div className="flex items-center gap-4 border-b border-gray-700 bg-gray-800 px-4 py-3">
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-gray-200 transition"
        >
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-xl font-semibold text-gray-100">{post.slug}</h1>
        <span className={`stage-badge-${post.stage}`}>
          {post.stage}
        </span>
      </div>

      <div className="workspace-content">
        {leftOpen && (
          <div style={{ width: '25%' }} className="workspace-panel">
            <ReferencePanel slug={slug} />
          </div>
        )}

        <div style={{ width: leftOpen && rightOpen ? '50%' : leftOpen || rightOpen ? '75%' : '100%' }} className="workspace-panel">
          <Editor slug={slug} post={post} />
        </div>

        {rightOpen && (
          <div style={{ width: '25%' }} className="workspace-panel">
            <AssetGallery slug={slug} />
          </div>
        )}
      </div>

      <PipelineBar
        slug={slug}
        post={post}
        onPostUpdated={loadPost}
        leftOpen={leftOpen}
        onToggleLeft={() => setLeftOpen(!leftOpen)}
        rightOpen={rightOpen}
        onToggleRight={() => setRightOpen(!rightOpen)}
      />
    </div>
  )
}
