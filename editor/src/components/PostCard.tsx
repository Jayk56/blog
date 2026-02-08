import { useNavigate } from 'react-router-dom'
import { Post } from '../lib/api'

const stageColors: Record<string, string> = {
  capture: 'stage-badge-capture',
  transcribe: 'stage-badge-transcribe',
  preprocess: 'stage-badge-preprocess',
  draft: 'stage-badge-draft',
  review: 'stage-badge-review',
  collect: 'stage-badge-collect',
  publish: 'stage-badge-publish',
}

interface PostCardProps {
  post: Post
}

export default function PostCard({ post }: PostCardProps) {
  const navigate = useNavigate()

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return dateString
    }
  }

  return (
    <div
      onClick={() => navigate(`/post/${post.slug}`)}
      className="panel p-6 hover:border-blue-500 hover:bg-gray-750 transition cursor-pointer"
    >
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-100 truncate">
          {post.title || post.slug}
        </h2>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className={stageColors[post.stage] || 'stage-badge'}>
            {post.stage}
          </span>
          <span className="text-xs text-gray-400 bg-gray-900 px-2 py-1 rounded">
            {post.category}
          </span>
        </div>

        <div className="flex justify-between text-sm text-gray-400">
          <span>{post.audioCount} audio file(s)</span>
          <span>{formatDate(post.created)}</span>
        </div>
      </div>
    </div>
  )
}
