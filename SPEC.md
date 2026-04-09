# Jot — Design Spec

**Vision:** A personal AI learning companion that runs entirely on local models. You add notes, it processes in background, learns your context over time, and surfaces what's relevant before you ask. No cloud, no waiting, no account.

## Permission Model (Hard Constraints)

- **Read Gmail** — YES
- **Read Calendar** — YES
- **Create calendar events** — YES (with confirmation prompt)
- **Send email** — HARD NO, never

---

## Architecture Layers

```
Layer 1 — Core CLI
  jot note / search / list / tags / summarize / insights
  + instant return, async analysis

Layer 2 — External Context
  jot context gmail --days N
  jot context calendar --week
  → Injects email/calendar data into analysis prompts

Layer 3 — Background Processing
  jot process (launchd/cron every 5min)
  + pluggable notifier interface
  → delivers action items, digests

Layer 4 — Learned Memory
  jot context (projects, people, patterns)
  → Every note makes the next one smarter

Layer 5 — Todo System
  jot todo add / list / done / delete
  → Todos linked to notes, with due dates and priorities
```

---

## Data Storage

```
~/.jot/
  notes.db           SQLite — notes, tags, action items, projects, people
  todos.db           SQLite — todos with due dates, priorities
  context.json       Learned memory (projects, people, patterns)
  user.md            User context (auto-learned sections)
  config.json        Backends, URLs, notifier config
  google-config.json Google integration settings
  credentials/       Google OAuth/service account credentials
  logs/              Agent logs
```

---

## SQLite Schema

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  raw TEXT NOT NULL,
  tags TEXT DEFAULT '[]',
  action_items TEXT DEFAULT '[]',
  linked_note_ids TEXT DEFAULT '[]',
  projects TEXT DEFAULT '[]',
  people TEXT DEFAULT '[]',
  analyzed INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  is_urgent INTEGER DEFAULT 0,
  created_at TEXT,
  analyzed_at TEXT
);

CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  due_date TEXT,
  priority TEXT DEFAULT 'medium',
  completed INTEGER DEFAULT 0,
  completed_at TEXT,
  note_id TEXT,
  created_at TEXT
);

CREATE TABLE insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insights_json TEXT NOT NULL,
  computed_at TEXT
);
```

---

## Context.json Schema

```typescript
interface UserContext {
  projects: {
    name: string;
    summary: string;
    relatedNotes: string[];
    lastUpdated: string;
  }[];
  people: {
    name: string;
    context: string;
    relatedNotes: string[];
  }[];
  priorities: string[];
  staleItems: string[];
  patterns: string[];
}
```

---

## Config.json

```json
{
  "backends": {
    "lmstudio": { "url": "http://localhost:1234/v1/chat/completions", "model": "qwen2.5-7b-instruct", "enabled": true, "apiType": "openai" },
    "ollama": { "url": "http://localhost:11434/v1/chat/completions", "model": "llama3.2", "enabled": false, "apiType": "ollama" }
  },
  "defaultBackend": "lmstudio",
  "analysis": { "extractActionItems": true, "linkRelatedNotes": true, "autoAnalyze": true },
  "notifier": "none",
  "discordWebhook": "",
  "deliveryMode": "urgent"
}
```

---

## Agent Cycle (Background Daemon)

```
Every 5 minutes (launchd/cron):
1. Analyze new notes
   - For each unanalyzed note:
     a. Read user.md + context.json into prompt
     b. Run analysis (local model)
     c. UPDATE note with tags/actions/projects/people
     d. UPDATE context.json (new projects, people, patterns)
2. Create todos from action_items
3. Sync external data (if enabled)
   - Fetch Gmail → cache for context
   - Fetch Calendar → cache for context
4. Check todo status
   - Find overdue todos → add to urgent notification
   - Find due-today todos
5. If threshold breached OR digest time:
   - Load notifier from config
   - notifier.deliver(results)
6. Mark last-processed timestamp
```

Idempotent — re-running no-ops for already-processed notes.

---

## Notifier Interface

```typescript
interface Notifier {
  deliver(result: ProcessResult): Promise<void>;
}

class DiscordNotifier implements Notifier { /* POST to webhook */ }
class TerminalNotifier implements Notifier { /* console.log */ }
class WebhookNotifier implements Notifier { /* HTTP POST */ }
```

**Delivery modes:**
- **Urgent only** — fire when action items found or stale threshold breached
- **Daily digest** — accumulate, deliver once a day at set time
- **Always** — fire every process cycle if there's output

---

## Todo System

Todos are first-class citizens:
- Created automatically from action_items extracted by AI
- Can be created manually with `jot todo add`
- Linked to source note via `note_id`
- Due dates and priorities for filtering
- `jot todo list --overdue` to see what's past due

---

## Google Integration

```bash
jot google setup <path-to-oauth-client.json>  Save Google OAuth client credentials
jot google auth                              Complete browser OAuth flow and save refresh token
jot google gmail --enable                    Enable Gmail integration
jot google calendar --enable                 Enable Calendar integration
jot context gmail --days 3                   Read recent Gmail messages
jot context calendar --week                  Read upcoming calendar events
```

---

## Implementation Status

### Completed
- [x] Core CLI: note, search, list, tags, summarize
- [x] LM Studio / Ollama integration
- [x] Async: instant return, detached background analysis
- [x] user.md created on setup, injected into prompts
- [x] Auto-learned section updated by analyzer
- [x] Gmail OAuth2 + Gmail API read integration
- [x] Calendar OAuth2 + Calendar API read integration
- [x] Todo system with DB and CLI
- [x] Agent core with background processing
- [x] Pluggable notifier interface
- [x] macOS launchd installer script

### In Progress
- [ ] Jot ask command (rich query to agent)
- [ ] Rich context injection into all prompts

### Not Yet Implemented
- Calendar write (Layer 5)
- Agent scheduling on non-macOS platforms

---

## Open Questions (resolved)

| Question | Answer |
|----------|--------|
| user.md updates | Jot auto-updates auto-learned section only |
| Context store updates | Auto-update from notes as they're analyzed |
| Delivery trigger | Config option — urgent-only default |
| Gmail auth | Google OAuth2 flow with refresh tokens |
| Context storage | SQLite + JSON file (context.json for quick reads) |
| Todo source | Created from action_items OR manually |
