# secure-browser-mcp

English | [日本語](README.ja.md)

**Security-first browser automation MCP server.** Built on [Playwright](https://playwright.dev/) with a strict local-only policy.

## Security Features

| Feature | Detail |
|---------|--------|
| **Zero telemetry** | No data leaves your machine. No PostHog, no analytics, no cloud sync |
| **Sensitive data masking** | Credit card numbers, SSNs, and emails are auto-masked in all tool responses |
| **No external connections** | The server never phones home. Fully air-gappable |
| **No LLM dependency** | No API keys, no AI calls. Your MCP client handles reasoning; this server just drives the browser |
| **No Python required** | Pure Node.js. No Python runtime, no pip, no venv |

## Why not @playwright/mcp?

| | secure-browser-mcp | @playwright/mcp |
|---|---|---|
| Telemetry | None | None* |
| Sensitive data masking | Built-in (CC, SSN, email) | No |
| External connections | Zero | Depends on config |
| DOM element stability | `data-mcp-index` (CSS-independent) | Accessibility snapshots |
| Dependencies | Minimal (Playwright + MCP SDK) | Playwright + MCP SDK |

\* @playwright/mcp itself has no telemetry, but does not mask sensitive data in responses passed to LLMs.

## Requirements

- Node.js 18+
- Chromium (installed via `npx playwright install chromium`)

## Quick Start

### Install

```bash
git clone https://github.com/aliksir/secure-browser-mcp.git
cd secure-browser-mcp
npm install
npx playwright install chromium
npm run build
```

### Configure

Add to your Claude Code MCP settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "secure-browser": {
      "command": "node",
      "args": ["/path/to/secure-browser-mcp/dist/index.js"],
      "env": {
        "BROWSER_HEADLESS": "true"
      }
    }
  }
}
```

Set `BROWSER_HEADLESS` to `"false"` to see the browser window.

## Available Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL (supports `new_tab`) |
| `browser_get_state` | Get page state with indexed interactive elements |
| `browser_click` | Click by element index or coordinates |
| `browser_type` | Type text into an element (sensitive data auto-masked) |
| `browser_screenshot` | Take a screenshot (viewport or full page) |
| `browser_scroll` | Scroll up or down (80% of viewport) |
| `browser_go_back` | Navigate back in history |
| `browser_get_html` | Get HTML content (full page or CSS selector) |
| `browser_list_tabs` | List all open tabs |
| `browser_switch_tab` | Switch to a tab by ID |
| `browser_close_tab` | Close a tab by ID |
| `browser_list_sessions` | List active browser sessions |
| `browser_close_session` | Close a specific session |
| `browser_close_all` | Close all sessions and browsers |

## How Masking Works

When `browser_type` or `browser_get_state` processes text, patterns are automatically replaced before the response reaches your MCP client:

| Pattern | Masked as |
|---------|-----------|
| `4111 2222 3333 4444` | `****-****-****-****` |
| `123-45-6789` (SSN) | `***-**-****` |
| `user@example.com` | `<email>` |

This prevents sensitive data from being sent to LLM context windows where it could be logged or cached.

## Design Decisions

- **Zero external connections** — no telemetry, no cloud sync, no analytics. Everything stays local
- **No LLM dependency** — this server doesn't call any AI APIs. Your MCP client handles all reasoning
- **Lazy session cleanup** — sessions expire after 30 minutes of inactivity, checked on each tool call (no background timers)
- **Viewport-first element indexing** — elements currently visible in the viewport are prioritized and indexed first
- **`data-mcp-index` over CSS selectors** — injected attributes are stable across page re-renders, unlike CSS selectors that break with DOM changes

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSER_HEADLESS` | `true` | Set to `false` to show the browser window |

## License

MIT
