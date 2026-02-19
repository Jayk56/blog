# Security Guide

## Authentication

### OAuth 2.0 vs JWT Tokens

After evaluating both approaches, we recommend **JWT tokens with short expiry** for API authentication:

**JWT Advantages:**
- Stateless verification reduces database load
- Built-in expiry mechanism
- Standard claims (iss, sub, aud, exp) provide rich metadata
- Easy to implement with existing libraries

**OAuth 2.0 Considerations:**
- More complex setup with authorization server
- Better for third-party integrations
- Provides refresh token flow for long-lived sessions
- Required for SSO with external identity providers

**Our Recommendation:** Use JWT for service-to-service auth and internal APIs. Use OAuth 2.0 with PKCE for user-facing authentication that requires SSO.

### Token Best Practices
- Access token expiry: 15 minutes
- Refresh token expiry: 7 days
- Rotate refresh tokens on each use
- Store tokens in httpOnly cookies (not localStorage)

## Authorization
- RBAC with three roles: admin, editor, viewer
- Resource-level permissions for sensitive operations
- Audit logging for all permission changes
