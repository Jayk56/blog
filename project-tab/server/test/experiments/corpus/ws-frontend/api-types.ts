// Frontend API response types

export interface UserResponse {
  user_id: string
  email: string
  display_name: string
  created_at: string
  updated_at: string
  role: 'admin' | 'editor' | 'viewer'
}

export interface ProjectResponse {
  project_id: string
  name: string
  description: string
  owner_id: string
  team_ids: string[]
  created_at: string
  status: 'active' | 'archived' | 'deleted'
}

export interface TaskResponse {
  task_id: string
  project_id: string
  title: string
  assignee_id: string | null
  priority: 'low' | 'medium' | 'high' | 'critical'
  due_date: string | null
  completed_at: string | null
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  page_size: number
  has_next: boolean
}

export interface ErrorResponse {
  error: string
  message: string
  status_code: number
  details?: Record<string, string[]>
}
