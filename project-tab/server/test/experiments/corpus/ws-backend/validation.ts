// Backend validation module

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateRequired(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') {
    return `${field} is required`
  }
  return null
}

export function validateMinLength(value: string, min: number, field: string): string | null {
  if (value.length < min) {
    return `${field} must be at least ${min} characters`
  }
  return null
}

export function validateMaxLength(value: string, max: number, field: string): string | null {
  if (value.length > max) {
    return `${field} must be at most ${max} characters`
  }
  return null
}

export function validateEmail(email: string): string | null {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!re.test(email)) {
    return 'Invalid email address'
  }
  return null
}

export function validateRange(value: number, min: number, max: number, field: string): string | null {
  if (value < min || value > max) {
    return `${field} must be between ${min} and ${max}`
  }
  return null
}
