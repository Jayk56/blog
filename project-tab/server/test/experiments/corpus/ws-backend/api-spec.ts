// API response type definitions (backend canonical)

export interface UserResponse {
  userId: string
  email: string
  displayName: string
  createdAt: string
  updatedAt: string
  role: 'admin' | 'editor' | 'viewer'
}

export interface ProjectResponse {
  projectId: string
  name: string
  description: string
  ownerId: string
  teamIds: string[]
  createdAt: string
  status: 'active' | 'archived' | 'deleted'
}

export interface TaskResponse {
  taskId: string
  projectId: string
  title: string
  assigneeId: string | null
  priority: 'low' | 'medium' | 'high' | 'critical'
  dueDate: string | null
  completedAt: string | null
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  hasNext: boolean
}

export interface ErrorResponse {
  error: string
  message: string
  statusCode: number
  details?: Record<string, string[]>
}
