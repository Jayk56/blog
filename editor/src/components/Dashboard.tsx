import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { fetchPosts, Post } from '../lib/api'
import { useWebSocket } from '../lib/ws'
import PostCard from './PostCard'
import NewPostDialog from './NewPostDialog'

export default function Dashboard() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const ws = useWebSocket()

  const loadPosts = async () => {
    try {
      setLoading(true)
      const data = await fetchPosts()
      setPosts(data)
    } catch (error) {
      console.error('Failed to load posts:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPosts()
  }, [])

  useEffect(() => {
    const unsubscribe = ws.subscribe('manifest-changed', () => {
      loadPosts()
    })
    return unsubscribe
  }, [ws])

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-gray-100">Blog Posts</h1>
          <button
            onClick={() => setShowNewDialog(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={20} />
            New Post
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-gray-400">Loading posts...</div>
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="text-gray-400 text-lg mb-2">
              No posts yet. Record a voice memo to get started!
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        )}
      </div>

      <NewPostDialog
        isOpen={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        onCreated={() => {
          setShowNewDialog(false)
          loadPosts()
        }}
      />
    </div>
  )
}
