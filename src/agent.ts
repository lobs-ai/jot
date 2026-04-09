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

export async function runAgentCycle(): Promise<ProcessResult> {
  log('Starting agent cycle');
  const db = openDB();
  const config = loadConfig();
  const surfaced = loadGlobalSurfaced();
  
  let processed = 0;
  const actionItemsFound: string[] = [];
  const urgentItems: string[] = [];
  const staleNotes: string[] = [];

  try {
    if (config.analysis?.autoAnalyze) {
      log('Analyzing notes...');
      const { processed: analyzed } = await runAnalysisCycle();
      processed = analyzed;
      
      const allNotes = db.getAllNotes();
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
        urgentItems.push(`OVERDUE: ${todo.content}`);
        markGlobal(surfaced, 'overdue_todos', todo.id);
      }
    }
    for (const todo of dueTodayTodos) {
      urgentItems.push(`DUE TODAY: ${todo.content}`);
    }

    log('Checking for stale projects...');
    const context = readContext();
    const now = Date.now();
    
    for (const project of context.projects) {
      const lastUpdate = new Date(project.lastUpdated).getTime();
      const daysSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60 * 24);
      
      if (daysSinceUpdate >= surfaced.stale_threshold_days) {
        if (shouldRecheckStaleProject(surfaced, project.name)) {
          staleNotes.push(`Stale project: ${project.name} (${Math.floor(daysSinceUpdate)} days since update)`);
          markStaleProjectSurfaced(surfaced, project.name);
        }
      }
    }

    log('Syncing external data...');
    const googleConfig = getGoogleConfig();
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
    const allNotes = db.getAllNotes();
    
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
    
    const summary = `Processed ${processed} notes. ${actionItemsFound.length} action items, ${overdueTodos.length} overdue todos.`;
    log('Agent cycle complete: ' + summary);
    
    return {
      processedCount: processed,
      actionItemsFound,
      urgentItems,
      staleNotes,
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
  
  if (shouldNotify(result, config.deliveryMode)) {
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
