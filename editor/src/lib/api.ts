export interface Post {
  slug: string
  stage: string
  category: string
  created: string
  lastModified?: string
  audioCount: number
  title?: string
  tags?: string[]
  content?: {
    outline?: string
    transcript?: string
    draft?: string
    review?: string
    notes?: string
  }
}

export interface PipelineJob {
  jobId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress?: number
  error?: string
}

const API_BASE = '/api'

export async function fetchPosts(): Promise<Post[]> {
  const response = await fetch(`${API_BASE}/posts`)
  if (!response.ok) throw new Error('Failed to fetch posts')
  return response.json()
}

export async function fetchPost(slug: string): Promise<Post> {
  const response = await fetch(`${API_BASE}/posts/${slug}`)
  if (!response.ok) throw new Error(`Failed to fetch post: ${slug}`)
  return response.json()
}

export async function createPost(
  slug: string,
  category: string
): Promise<Post> {
  const response = await fetch(`${API_BASE}/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, category }),
  })
  if (!response.ok) throw new Error('Failed to create post')
  return response.json()
}

export async function readFile(slug: string, path: string): Promise<string> {
  const response = await fetch(
    `${API_BASE}/posts/${slug}/file?path=${encodeURIComponent(path)}`
  )
  if (!response.ok) {
    if (response.status === 404) return ''
    throw new Error(`Failed to read file: ${path}`)
  }
  return response.text()
}

export async function writeFile(
  slug: string,
  path: string,
  content: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/posts/${slug}/file?path=${encodeURIComponent(path)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: content,
    }
  )
  if (!response.ok) throw new Error(`Failed to write file: ${path}`)
}

export async function runPipeline(
  slug: string,
  action: string
): Promise<PipelineJob> {
  const response = await fetch(
    `${API_BASE}/posts/${slug}/pipeline/${action}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }
  )
  if (!response.ok) throw new Error(`Failed to run pipeline: ${action}`)
  return response.json()
}

export async function fetchJobStatus(jobId: string): Promise<PipelineJob> {
  const response = await fetch(`${API_BASE}/pipeline/jobs/${jobId}`)
  if (!response.ok) throw new Error(`Failed to fetch job status: ${jobId}`)
  return response.json()
}
