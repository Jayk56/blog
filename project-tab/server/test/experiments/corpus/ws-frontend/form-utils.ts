// Form utility functions for the frontend

interface FormField {
  name: string
  value: string
  error?: string
  touched: boolean
}

interface FormState {
  fields: Record<string, FormField>
  isSubmitting: boolean
  isValid: boolean
}


export function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return re.test(email)
}


export function validateRequired(value: string): boolean {
  return value.trim().length > 0
}

export function validateMinLength(value: string, min: number): boolean {
  return value.length >= min
}

export function createFormState(fieldNames: string[]): FormState {
  const fields: Record<string, FormField> = {}
  for (const name of fieldNames) {
    fields[name] = { name, value: '', touched: false }
  }
  return { fields, isSubmitting: false, isValid: false }
}

export function updateField(state: FormState, name: string, value: string): FormState {
  return {
    ...state,
    fields: {
      ...state.fields,
      [name]: { ...state.fields[name], value, touched: true },
    },
  }
}


export function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = String(item[key])
    ;(acc[k] ??= []).push(item)
    return acc
  }, {} as Record<string, T[]>)
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
  return result
}

export function isEmpty(obj: Record<string, unknown>): boolean { return Object.keys(obj).length === 0 }

export function memoize<T>(fn: () => T): () => T { let cached: T | undefined; return () => cached ?? (cached = fn()) }