# Code Examples

## Form Validation

Here's a common pattern for validating user input:

```typescript

export function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return re.test(email)
}


// Usage:
const isValid = validateEmail('user@example.com') // true
const isInvalid = validateEmail('not-an-email')    // false
```

## Error Handling

Always wrap async operations in try-catch:

```typescript
async function fetchData(url: string) {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } catch (error) {
    console.error('Fetch failed:', error)
    throw error
  }
}
```
