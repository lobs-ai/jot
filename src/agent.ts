import { openDB } from './db.js';
import { runAnalysisCycle } from './analyzer.js';
import { loadConfig } from './config.js';
import { readContext, updateContextFromNote } from './context.js';
import { getOverdueTodos, getDueTodayTodos, createTodosFromActionItems } from './todos.js';
import { createNotifier, shouldNotify, ProcessResult } from './notifier.js';
import { fetchGmailEmails, fetchCalendarEvents, getGoogleConfig } from './google.js';
import { generateInsights, generateDeepInsights, saveInsights } from './insights.js';
import { loadGlobalSurfaced, saveGlobalSurfaced, isGloballySurfaced, markStaleProjectSurfaced, shouldRecheckStaleProject, markGlobal, clearStaleProject } from './sessions.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const LOG_DIR = path.join(os.homedir(), '.jot', 'logs');
const LAST_SYNC_FILE = path.join(os.homedir(), '.jot', '.last_sync');

function log(message: string): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  const logFile = path.join(LOG_DIR, 'agent.log');
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
}

function getLastSync(): Date | null {
  if (!fs.existsSync(LAST_SYNC_FILE)) return null;
  try {
    const content = fs.readFileSync(LAST_SYNC_FILE, 'utf-8');
    return new Date(content.trim());
  } catch {
    return null;
  }
}

function setLastSync(): void {
  fs.writeFileSync(LAST_SYNC_FILE, new Date().toISOString());
}

const URGENT_QUEUE_FILE = path.join(os.homedir(), '.jot', 'urgent_queue.json');

export interface UrgentItem {
  trigger: 'overdue_todo' | 'urgent_note' | 'high_priority_email' | 'meeting_soon';
  content: string;
  severity: 'critical' | 'warning';
  noteId?: string;
  timestamp: string;
}

function loadUrgentQueue(): UrgentItem[] {
  if (fs.existsSync(URGENT_QUEUE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(URGENT_QUEUE_FILE, 'utf-8'));
    } catch { }
  }
  return [];
}

function saveUrgentQueue(queue: UrgentItem[]): void {
  fs.writeFileSync(URGENT_QUEUE_FILE, JSON.stringify(queue, null, 2));
}

function shouldEmitUrgent(item: UrgentItem): boolean {
  const queue = loadUrgentQueue();
  const isRecent = queue.some(q =>
    q.content === item.content &&
    (Date.now() - new Date(q.timestamp).getTime()) < 15 * 60 * 1000
  );
  return !isRecent;
}

function emitUrgent(item: UrgentItem): void {
  if (!shouldEmitUrgent(item)) return;

  const queue = loadUrgentQueue();
  queue.push(item);
  if (queue.length > 20) queue.shift();
  saveUrgentQueue(queue);

  const config = loadConfig();
  const notifier = createNotifier();

  const urgentResult: ProcessResult = {
    processedCount: 0,
    actionItemsFound: [],
    urgentItems: [`[${item.severity.toUpperCase()}] ${item.content}`],
    staleNotes: [],
    patternItems: [],
    summary: `Urgent: ${item.content}`
  };

  notifier.deliver(urgentResult).catch(err => log(`Urgent delivery failed: ${err}`));
}

export interface DigestAccumulator {
  items: {
    type: 'action' | 'urgent' | 'stale';
    content: string;
    timestamp: string;
  }[];
  last_delivered?: string;
}

export function loadDigestAccumulator(): DigestAccumulator {
  const p = path.join(os.homedir(), '.jot', 'digest.json');
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch { }
  }
  return { items: [] };
}

export function saveDigestAccumulator(acc: DigestAccumulator): void {
  const p = path.join(os.homedir(), '.jot', 'digest.json');
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(acc, null, 2));
}

export function shouldDeliverDigest(config: { deliveryMode?: string; digestTime?: string }): boolean {
  if (config.deliveryMode !== 'digest') return false;
  const now = new Date();
  const digestTimeStr = config.digestTime || '08:00';
  const [hours, minutes] = digestTimeStr.split(':').map(Number);
  const digestTime = new Date(now);
  digestTime.setHours(hours, minutes, 0, 0);

  if (now >= digestTime && now.getTime() < digestTime.getTime() + 120000) {
    const acc = loadDigestAccumulator();
    if (!acc.last_delivered) return true;
    const last = new Date(acc.last_delivered).getTime();
    return now.getTime() - last >= 60 * 60 * 1000;
  }
  return false;
}

export async function runAgentCycle(): Promise<ProcessResult> {
  log('Starting agent cycle');
  const db = openDB();
  const config = loadConfig();
  const surfaced = loadGlobalSurfaced();
  const digestMode = config.deliveryMode === 'digest';
  const digestAcc = digestMode ? loadDigestAccumulator() : null;
  
  let processed = 0;
  const actionItemsFound: string[] = [];
  const urgentItems: string[] = [];
  const staleNotes: string[] = [];
  const patternItems: string[] = [];

  let allNotes = db.getAllNotes();
  let googleConfig = getGoogleConfig();

  try {
    if (config.analysis?.autoAnalyze) {
      log('Analyzing notes...');
      const { processed: analyzed } = await runAnalysisCycle();
      processed = analyzed;
      
      for (const note of allNotes) {
        if (note.action_items.length > 0) {
          actionItemsFound.push(...note.action_items);
          
          const todos = createTodosFromActionItems(note.action_items, note.id);
          log(`Created ${todos.length} todos from note ${note.id.slice(0, 8)}`);
        }
      }
    }

    log('Checking todos...');
    const overdueTodos = getOverdueTodos();
    const dueTodayTodos = getDueTodayTodos();
    
    for (const todo of overdueTodos) {
      if (!isGloballySurfaced(surfaced, 'overdue_todos', todo.id)) {
        const item = `OVERDUE: ${todo.content}`;
        if (digestMode && digestAcc) {
          digestAcc.items.push({ type: 'urgent', content: item, timestamp: new Date().toISOString() });
        } else {
          urgentItems.push(item);
        }
        markGlobal(surfaced, 'overdue_todos', todo.id);
      }
    }
    for (const todo of dueTodayTodos) {
      const item = `DUE TODAY: ${todo.content}`;
      if (digestMode && digestAcc) {
        digestAcc.items.push({ type: 'urgent', content: item, timestamp: new Date().toISOString() });
      } else {
        urgentItems.push(item);
      }
    }

    log('Checking for stale projects...');
    const context = readContext();
    const now = Date.now();
    
    for (const project of context.projects) {
      const lastUpdate = new Date(project.lastUpdated).getTime();
      const daysSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60 * 24);
      
      if (daysSinceUpdate >= surfaced.stale_threshold_days) {
        if (shouldRecheckStaleProject(surfaced, project.name)) {
          const item = `Stale project: ${project.name} (${Math.floor(daysSinceUpdate)} days since update)`;
          if (digestMode && digestAcc) {
            digestAcc.items.push({ type: 'stale', content: item, timestamp: new Date().toISOString() });
          } else {
            staleNotes.push(item);
          }
          markStaleProjectSurfaced(surfaced, project.name);
        }
      }
    }

    log('Checking for urgent Tier-3 triggers...');
    for (const todo of overdueTodos) {
      if (!isGloballySurfaced(surfaced, 'overdue_todos', todo.id)) {
        emitUrgent({
          trigger: 'overdue_todo',
          content: `${todo.content} (overdue since ${todo.due_date})`,
          severity: 'critical',
          noteId: todo.note_id || undefined,
          timestamp: new Date().toISOString()
        });
      }
    }

    allNotes = db.getAllNotes();
    for (const note of allNotes) {
      if (note.is_urgent) {
        emitUrgent({
          trigger: 'urgent_note',
          content: note.content.slice(0, 200),
          severity: 'warning',
          noteId: note.id,
          timestamp: new Date().toISOString()
        });
      }
    }

    if (googleConfig.gmail_enabled) {
      try {
        const emails = await fetchGmailEmails(3);
        const highPrioritySenders = ['advisor', 'professor', 'recruiter', 'chen', 'smith'];
        for (const email of emails) {
          const senderLower = email.from.toLowerCase();
          if (highPrioritySenders.some(s => senderLower.includes(s))) {
            emitUrgent({
              trigger: 'high_priority_email',
              content: `Email from ${email.from}: ${email.subject}`,
              severity: 'warning',
              timestamp: new Date().toISOString()
            });
          }
        }
      } catch (e) {
        log(`Gmail urgent check failed: ${e}`);
      }
    }

    if (googleConfig.calendar_enabled) {
      try {
        const events = await fetchCalendarEvents(4);
        const now = Date.now();
        const fifteenMin = 15 * 60 * 1000;
        for (const event of events) {
          const start = new Date(event.start).getTime();
          const timeUntil = start - now;
          if (timeUntil > 0 && timeUntil <= fifteenMin) {
            const noteForEvent = allNotes.find(n =>
              n.content.toLowerCase().includes(event.summary.toLowerCase().split(' ')[0])
            );
            if (!noteForEvent) {
              emitUrgent({
                trigger: 'meeting_soon',
                content: `Meeting "${event.summary}" starts in ${Math.ceil(timeUntil / 60000)} min — no prep notes found`,
                severity: 'warning',
                timestamp: new Date().toISOString()
              });
            }
          }
        }
      } catch (e) {
        log(`Calendar urgent check failed: ${e}`);
      }
    }

    for (const ai of actionItemsFound) {
      if (digestMode && digestAcc) {
        digestAcc.items.push({ type: 'action', content: ai, timestamp: new Date().toISOString() });
      }
    }

    if (digestMode && digestAcc) {
      saveDigestAccumulator(digestAcc);
      log(`Digest: accumulated ${digestAcc.items.length} items since last delivery`);
    }

    log('Syncing external data...');
    googleConfig = getGoogleConfig();
    if (googleConfig.gmail_enabled) {
      try {
        const emails = await fetchGmailEmails(3);
        log(`Fetched ${emails.length} emails`);
      } catch (e) {
        log(`Gmail sync failed: ${e}`);
      }
    }
    
    if (googleConfig.calendar_enabled) {
      try {
        const events = await fetchCalendarEvents(1);
        log(`Fetched ${events.length} calendar events`);
      } catch (e) {
        log(`Calendar sync failed: ${e}`);
      }
    }

    log('Updating learned context...');
    
    for (const note of allNotes) {
      if (note.analyzed && (note.projects.length > 0 || note.people.length > 0)) {
        updateContextFromNote(note.id, note.projects, note.people, note.action_items);
      }
    }

    const updatedContext = readContext();
    for (const [projectName, surfacedDate] of Object.entries(surfaced.stale_projects)) {
      const project = updatedContext.projects.find(p => p.name === projectName);
      if (project) {
        const projectUpdated = new Date(project.lastUpdated).getTime();
        const wasSurfaced = new Date(surfacedDate).getTime();
        if (projectUpdated > wasSurfaced) {
          clearStaleProject(surfaced, projectName);
          log(`Stale project ${projectName} updated, cleared from tracker`);
        }
      } else {
        clearStaleProject(surfaced, projectName);
        log(`Stale project ${projectName} removed from context, cleared from tracker`);
      }
    }

    log('Checking for learned patterns...');
    const patternContext = readContext();
    if (patternContext.patterns.length > 0) {
      for (const pattern of patternContext.patterns) {
        if (!surfaced.patterns.includes(pattern)) {
          patternItems.push(`Pattern: ${pattern}`);
          surfaced.patterns.push(pattern);
          log(`Detected new pattern: ${pattern}`);
        }
      }
    }

    if (allNotes.length > 0) {
      log('Refreshing stored insights...');
      const baseInsights = await generateInsights();
      const deepInsights = await generateDeepInsights();
      saveInsights({
        ...baseInsights,
        research_threads: deepInsights.research_threads,
        suggestions: deepInsights.suggestions,
        generated_at: new Date().toISOString()
      });
      log('Stored insights refreshed');
    }

    saveGlobalSurfaced(surfaced);
    setLastSync();
    
    const summary = `Processed ${processed} notes. ${actionItemsFound.length} action items, ${overdueTodos.length} overdue todos${patternItems.length > 0 ? ', ' + patternItems.length + ' patterns' : ''}.`;
    log('Agent cycle complete: ' + summary);
    
    return {
      processedCount: processed,
      actionItemsFound,
      urgentItems,
      staleNotes,
      patternItems,
      summary
    };
  } catch (error) {
    log(`Agent cycle error: ${error}`);
    throw error;
  }
}

export async function notifyIfNeeded(result: ProcessResult): Promise<void> {
  const config = loadConfig();
  const notifier = createNotifier();
  const deliveryMode = config.deliveryMode || 'urgent';

  if (deliveryMode === 'digest' && shouldDeliverDigest(config)) {
    const acc = loadDigestAccumulator();
    if (acc.items.length === 0) {
      log('Digest delivery skipped — no accumulated items');
      return;
    }

    log(`Delivering digest with ${acc.items.length} items`);
    const urgentItems = acc.items.filter(i => i.type === 'urgent').map(i => i.content);
    const actionItemsFound = acc.items.filter(i => i.type === 'action').map(i => i.content);
    const staleNotes = acc.items.filter(i => i.type === 'stale').map(i => i.content);

    const digestResult: ProcessResult = {
      processedCount: result.processedCount,
      actionItemsFound,
      urgentItems,
      staleNotes,
      patternItems: [],
      summary: `Daily digest: ${acc.items.length} items accumulated`
    };

    await notifier.deliver(digestResult);

    acc.items = [];
    acc.last_delivered = new Date().toISOString();
    saveDigestAccumulator(acc);
    log('Digest delivered and cleared');
    return;
  }

  if (shouldNotify(result, deliveryMode)) {
    log('Sending notification');
    await notifier.deliver(result);
  } else {
    log('Skipping notification (mode check failed)');
  }
}

export async function agentMain(): Promise<void> {
  try {
    const result = await runAgentCycle();
    await notifyIfNeeded(result);
  } catch (error) {
    log(`Agent error: ${error}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  agentMain();
}
