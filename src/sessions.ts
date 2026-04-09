import fs from 'fs';
import path from 'path';
import os from 'os';
import { getAskSystemPrompt } from './prompting.js';
import { getActiveBackend } from './config.js';

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface SurfacedItems {
  overdue_todos: string[];
  stale_projects: string[];
  patterns: string[];
}

export interface Session {
  id: string;
  name: string;
  messages: SessionMessage[];
  created_at: string;
  last_updated: string;
  surfaced: SurfacedItems;
}

export interface GlobalSurfacedTracker {
  overdue_todos: string[];
  stale_projects: Record<string, string>;
  patterns: string[];
  stale_threshold_days: number;
  recheck_after_days: number;
}

export const MAX_HISTORY = 8;
const MAX_SESSION_MESSAGES = 20;

function getSessionsDir(): string {
  return path.join(os.homedir(), '.jot', 'sessions');
}

function getArchiveDir(): string {
  return path.join(getSessionsDir(), 'archive');
}

function getSurfacedPath(): string {
  return path.join(os.homedir(), '.jot', 'surfaced.json');
}

function ensureSessionsDir(): void {
  const dirs = [getSessionsDir(), getArchiveDir()];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function loadSession(name: string = 'default'): Session {
  ensureSessionsDir();
  const sessionPath = path.join(getSessionsDir(), `${name}.json`);

  if (fs.existsSync(sessionPath)) {
    try {
      const raw = fs.readFileSync(sessionPath, 'utf-8');
      const parsed = JSON.parse(raw) as Session;
      return {
        ...parsed,
        surfaced: {
          overdue_todos: parsed.surfaced?.overdue_todos || [],
          stale_projects: parsed.surfaced?.stale_projects || [],
          patterns: parsed.surfaced?.patterns || []
        }
      };
    } catch {
      // corrupted — start fresh
    }
  }

  return {
    id: Math.random().toString(36).substring(2, 18),
    name,
    messages: [],
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    surfaced: {
      overdue_todos: [],
      stale_projects: [],
      patterns: []
    }
  };
}

export function saveSession(session: Session): void {
  ensureSessionsDir();
  session.last_updated = new Date().toISOString();
  const sessionPath = path.join(getSessionsDir(), `${session.name}.json`);
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

export function appendToSession(
  session: Session,
  role: 'user' | 'assistant',
  content: string
): void {
  session.messages.push({
    role,
    content,
    timestamp: new Date().toISOString()
  });

  const history = getRecentMessages(session);
  session.messages = history;

  trimAndArchive(session);
  saveSession(session);
}

export function getRecentMessages(session: Session, count: number = MAX_HISTORY): SessionMessage[] {
  const recent = session.messages.slice(-count);
  return recent;
}

export function buildSessionContext(session: Session): string {
  const recent = getRecentMessages(session, MAX_HISTORY);
  if (recent.length === 0) {
    return '';
  }

  const lines: string[] = ['\n## Conversation History'];
  for (const msg of recent) {
    const label = msg.role === 'user' ? '[you]' : '[Jot]';
    lines.push(`${label} ${msg.content}`);
  }
  return lines.join('\n');
}

function trimAndArchive(session: Session): void {
  if (session.messages.length <= MAX_SESSION_MESSAGES) {
    return;
  }

  const trimmed = session.messages.slice(-MAX_SESSION_MESSAGES);
  const overflow = session.messages.slice(0, session.messages.length - MAX_SESSION_MESSAGES);

  if (overflow.length > 0) {
    const archivePath = path.join(getArchiveDir(), `${session.name}.jsonl`);
    const lines = overflow.map(m => JSON.stringify(m)).join('\n') + '\n';
    fs.appendFileSync(archivePath, lines);
  }

  session.messages = trimmed;
}

export function loadGlobalSurfaced(): GlobalSurfacedTracker {
  const p = getSurfacedPath();
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as GlobalSurfacedTracker;
    } catch {
      // corrupted
    }
  }
  return {
    overdue_todos: [],
    stale_projects: {},
    patterns: [],
    stale_threshold_days: 14,
    recheck_after_days: 7
  };
}

export function saveGlobalSurfaced(tracker: GlobalSurfacedTracker): void {
  const p = getSurfacedPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(p, JSON.stringify(tracker, null, 2));
}

export function markSurfaced(
  session: Session,
  itemType: keyof SurfacedItems,
  itemId: string
): void {
  if (!session.surfaced[itemType].includes(itemId)) {
    session.surfaced[itemType].push(itemId);
  }
}

export function isGloballySurfaced(
  tracker: GlobalSurfacedTracker,
  itemType: keyof Pick<GlobalSurfacedTracker, 'overdue_todos' | 'patterns'>,
  itemId: string
): boolean {
  return tracker[itemType].some(id => id.startsWith(itemId));
}

export function isStaleProjectSurfaced(
  tracker: GlobalSurfacedTracker,
  projectName: string
): boolean {
  return !!tracker.stale_projects[projectName];
}

export function markStaleProjectSurfaced(
  tracker: GlobalSurfacedTracker,
  projectName: string
): void {
  tracker.stale_projects[projectName] = new Date().toISOString();
}

export function shouldRecheckStaleProject(
  tracker: GlobalSurfacedTracker,
  projectName: string
): boolean {
  const last = tracker.stale_projects[projectName];
  if (!last) return false;
  const daysSince = (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= tracker.recheck_after_days;
}

export function markGlobal(
  tracker: GlobalSurfacedTracker,
  itemType: keyof Pick<GlobalSurfacedTracker, 'overdue_todos' | 'patterns'>,
  itemId: string
): void {
  if (!tracker[itemType].some(id => id.startsWith(itemId))) {
    tracker[itemType].push(itemId);
  }
}

export function clearGlobalSurfaced(
  tracker: GlobalSurfacedTracker,
  itemType: keyof Pick<GlobalSurfacedTracker, 'overdue_todos' | 'patterns'>,
  itemId: string
): void {
  tracker[itemType] = tracker[itemType].filter(id => !id.startsWith(itemId));
}

export function clearStaleProject(
  tracker: GlobalSurfacedTracker,
  projectName: string
): void {
  delete tracker.stale_projects[projectName];
}

export async function callModelWithSession(
  systemPrompt: string,
  userPrompt: string,
  session: Session
): Promise<string> {
  const { url, model, apiType } = getActiveBackend();
  const recentMessages = getRecentMessages(session, MAX_HISTORY);

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt }
  ];

  for (const msg of recentMessages) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({ role: 'user', content: userPrompt });

  const ollamaBody = {
    model,
    messages,
    think: false,
    stream: false,
    options: {
      temperature: 0.3,
      num_predict: 600
    }
  };

  const openaiBody = {
    model,
    messages,
    temperature: 0.3,
    max_tokens: 600
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(apiType === 'ollama' ? ollamaBody : openaiBody),
    signal: AbortSignal.timeout(90000)
  });

  if (!response.ok) {
    throw new Error(`Model call failed: ${response.status}`);
  }

  const data = await response.json() as { message?: { content?: string }; choices?: Array<{ message?: { content?: string } }> };
  const content = apiType === 'ollama'
    ? data.message?.content?.trim()
    : data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error('Empty response from model');
  }

  return content;
}
