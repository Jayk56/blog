# API Reference

## Base URL
`https://api.example.com/v1`

## Authentication
All endpoints require a Bearer token in the Authorization header.

## Endpoints

### GET /users
List all users.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| page | number | 1 | Page number |
| limit | number | 20 | Items per page |
| role | string | - | Filter by role |

**Response:** `200 OK`
```json
{
  "data": [{ "userId": "abc123", "email": "user@example.com" }],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "hasNext": true
}
```

### GET /users/:id
Get a single user by ID.

### POST /users
Create a new user.

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "displayName": "New User",
  "role": "viewer"
}
```

### PUT /users/:id
Update an existing user.

### DELETE /users/:id
Soft-delete a user.
