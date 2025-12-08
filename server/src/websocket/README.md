# Unified WebSocket Server

Real-time streaming of logs and job events to authenticated users.

## Endpoint

`ws://localhost:3002/ws`

## Authentication

The WebSocket server uses the same better-auth session authentication as the REST API. Clients must have a valid session cookie to connect.

## Client Message Types

### `ping`
Send a ping to check connection health.
```json
{ "type": "ping" }
```
Response: `{ "type": "pong" }`

### `clear-logs`
Clear all logs for the authenticated user.
```json
{ "type": "clear-logs" }
```
Response: `{ "type": "logs-cleared" }`

### `subscribe`
Subscribe to a specific channel.
```json
{ "type": "subscribe", "channel": "jobs" }
```

### `unsubscribe`
Unsubscribe from a channel.
```json
{ "type": "unsubscribe", "channel": "jobs" }
```

## Server Message Types

### `initial-logs`
Sent immediately after connection with the last 100 logs.
```json
{
  "type": "initial-logs",
  "logs": [/* array of RealTimeLogEntry */],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `log`
Real-time log entry as operations occur.
```json
{
  "type": "log",
  "log": {
    "id": "uuid",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "userId": "user-id",
    "emailAccountId": "email-account-id",
    "level": "info",
    "command": "FETCH",
    "data": {
      "raw": "...",
      "parsed": {},
      "response": "...",
      "duration": 150,
      "error": null
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `job-event`
Job state change notification.
```json
{
  "type": "job-event",
  "channel": "jobs",
  "data": {
    "jobId": "job-123",
    "status": "completed",
    "...": "..."
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `logs-cleared`
Notification that logs have been cleared.
```json
{ "type": "logs-cleared", "timestamp": "2024-01-01T00:00:00.000Z" }
```

### `error`
Error message for invalid requests.
```json
{
  "type": "error",
  "error": "Error message"
}
```

## Implementation Details

- Uses the `ws` package for WebSocket support
- Integrates with Express HTTP server
- Authenticates using better-auth sessions
- Maintains per-user connection pools
- Implements ping/pong for connection health monitoring
- Supports channel-based subscriptions (defaults to 'all')
- Gracefully handles server shutdown

## Usage Example

```typescript
const ws = new WebSocket('ws://localhost:3002/ws', {
  headers: {
    cookie: document.cookie // Pass session cookie
  }
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  if (message.type === 'log') {
    console.log('New log:', message.log);
  } else if (message.type === 'job-event') {
    console.log('Job event:', message.data);
  }
});
```
