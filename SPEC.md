# Jot — Design Spec

**Vision:** A personal AI learning companion that runs entirely on local models. You add notes, it processes in background, learns your context over time, and surfaces what's relevant before you ask. No cloud, no waiting, no account.

## Permission Model (Hard Constraints)

- **Read Gmail** — YES
- **Read Calendar** — YES
- **Create calendar events** — YES (with confirmation prompt)
- **Send email** — HARD NO, never

---

## Core Design Principles

1. **Zero-config startup** — runs out of the box with Google credentials, no manual setup
2. **Zero management** — the agent handles all its own data. You never run migration scripts, clear sessions, or manage memory. Everything happens automatically in the background.
3. **Continuous learning** — agent reads notes passively, builds mental model of user over time
4. **Proactive assistance** — surfaces relevant info, doesn't wait to be asked
5. **Privacy first** — all data stored locally, no external services beyond Google APIs
6. **Agent-native** — not a "summarize my inbox" tool. Jot has memories, tracks goals, understands context, and actively helps achieve objectives. It reasons about the user's world continuously.

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
  user.md            User context (two-section: profile + auto-learned)
  sessions/
    default.json    Session history for chat/ask carryover
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

## Phase 1: Session Storage + Carryover

**Goal:** `jot ask` remembers the conversation. Multi-turn context without a running REPL.

### Session File Structure

```
~/.jot/sessions/
  default.json    ← current/primary session
  work.json       ← optional named sessions
```

```typescript
interface Session {
  id: string;
  name: string;
  messages: SessionMessage[];
  created_at: string;
  last_updated: string;
}

interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}
```

### Behavior

- **On every `jot ask` call:**
  1. Load `~/.jot/sessions/default.json` (create if missing)
  2. Append `{role: 'user', content: question, timestamp}` to messages
  3. Inject last 8 messages into the prompt (system + user alternation)
  4. Append `{role: 'assistant', content: answer, timestamp}` after response
  5. Trim to max 20 messages total (configurable)
  6. **Archive trimmed messages** to `sessions/archive/default.jsonl` (newline-delimited JSON, append-only)
  7. Save session file

- **Named sessions:** `jot ask --session work` — loads/writes `~/.jot/sessions/work.json`

### Automated Maintenance

Session storage is fully automatic — no user-facing management commands:

- Old messages trimmed from active session and archived to `sessions/archive/` automatically
- Session context persists across `jot ask` calls without any explicit management
- Sessions never need to be "cleared" — old context naturally fades as the conversation evolves

### Prompt Injection

Conversation history injected into `getAskSystemPrompt()` context block:

```
## Conversation History
[user]: what's my status?
[assistant]: You have 3 active projects: PAW, research, and candidacy prep...
[user]: what about research?
[assistant]: ...
```

Last 8 messages max (configurable via `session.maxHistory` in config.json).

### Surfaced Items Tracking

**Per-session** (Phase 1): The session tracks what it's already surfaced to avoid repetition within a session:

```typescript
interface Session {
  // ... above
  surfaced: {
    overdue_todos: string[];  // IDs already notified this session
    stale_projects: string[]; // projects already flagged this session
    patterns: string[];       // patterns already mentioned
  };
}
```

**Persistent** (Phase 3): A global surfaced tracker survives session clears:

```
~/.jot/surfaced.json
```

```typescript
interface GlobalSurfacedTracker {
  overdue_todos: string[];     // IDs, cleared when resolved
  stale_projects: {
    [name: string]: string;    // project name → last_surface_date (ISO)
  };
  patterns: string[];          // pattern names, never auto-repeats
  stale_threshold_days: number; // default: 14
  recheck_after_days: number;  // default: 7
}
```

---

## Phase 2: Interactive Chat REPL

**Goal:** `jot chat` — persistent REPL that accumulates context across a session.

- Built on top of Phase 1 session storage
- Interactive readline loop: `jot chat` enters conversation mode
- Ctrl+C or `exit` to end session
- Each turn appends to session, saves on exit
- Optionally: `--model` flag to switch backend mid-session
- Optionally: `--system` flag to inject custom system prompt

---

## Phase 3: Proactive Daemon Enhancements

**Goal:** The daemon doesn't just react — it reasons about patterns and surfaces proactively.

### Surfaced Tracking (Persistent)

```typescript
// ~/.jot/surfaced.json
interface SurfacedTracker {
  overdue_todos: string[];     // IDs, cleared when resolved
  stale_projects: string[];     // project names, re-checks after 7 days
  patterns: string[];          // pattern names, never auto-repeats
  last_surfaces: {
    [key: string]: string;      // item → last_surface_date
  };
}
```

- `stale threshold` in days (default: 14) — project untouched → flag once per surface period
- `surfaced` entries cleared when the item is resolved or updated
- Daemon references surfaced tracker before including an item in notification

### Proactive Rules

1. **Stale projects:** If project.lastUpdated > 14 days ago → surface once, then wait 7 days before surfacing again
2. **Overdue todos:** Surface once per session (don't spam every cycle)
3. **Pattern detection:** Surface once per session, never again without user prompt
4. **New insights:** If analyzer finds a new pattern → surface in next notification

---

## Phase 4: user.md Migration

**Goal:** Migrate existing `user.md` to two-section format. Must not lose existing content.

### Pre-existing user.md Format

The current `createUserFile()` creates a single-section format:

```markdown
# User Context

## High Priority
- 

## Projects
- 

## People
- 

## Ongoing
- 

## Notes
- 

## Patterns
- 

Last updated: 2026-04-09
```

### Initialization

On first run, agent creates `~/.jot/user.md` in the two-section format directly. No migration needed — agent never writes in the old format.

### Two-Section Format

```markdown
# Rafe's Profile
Name: Rafe
Role: UMich CSE MS student
Goals: PhD, make money, build best agentic system
Commitments: [your stuff here]

# Auto-learned (Jot maintains this)

People: Dr. Chen (advisor, 2026-04-06)
Projects: Jot (personal note assistant, 2026-04-09)
Priorities: PAW auth flow (2026-04-09)
```

### Migration

`jot migrate user-md` — one-time migration:
- Reads existing `~/.jot/user.md`
- Extracts non-placeholder content into `# Auto-learned`
- Wraps skeleton placeholders under `# Rafe's Profile`
- Writes new format, backs up original as `user.md.bak`

### Auto-Update Rules

- High confidence (>0.8): apply patch silently to `# Auto-learned`
- Low confidence (<0.8): ask first — "I noticed you mentioned 'X', should I add it?"
- Never auto-write to `# Rafe's Profile` — suggestions only, user approves
- Approval signals train the model over time

### Patch Format

Analyzer returns patch alongside tags/actions:

```json
{
  "tags": ["meeting", "advisor"],
  "actions": [{"content": "email Dr. Chen", "priority": "high"}],
  "userPatch": {
    "add_people": ["Dr. Smith"],
    "add_projects": ["candidacy exam prep"],
    "add_priorities": ["prepare candidacy talk"]
  }
}
```

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
