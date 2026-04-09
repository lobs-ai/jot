import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

export interface Note {
  id: string;
  content: string;
  raw: string;
  tags: string[];
  action_items: string[];
  linked_note_ids: string[];
  analyzed: boolean;
  created_at: string;
  analyzed_at: string | null;
}

export interface InsightsRecord {
  id: number;
  insights_json: string;
  computed_at: string;
}

export interface DB {
  insertNote(content: string): Note;
  getNote(id: string): Note | undefined;
  getAllNotes(): Note[];
  getNotesByTag(tag: string): Note[];
  searchNotes(query: string): Note[];
  updateNoteAnalysis(
    id: string,
    tags: string[],
    action_items: string[],
    linked_note_ids: string[]
  ): void;
  markAnalyzed(id: string): void;
  saveInsights(insights: string): void;
  getLatestInsights(): InsightsRecord | undefined;
}

function getDBPath(): string {
  const homeDir = os.homedir();
  const dataDir = path.join(homeDir, '.jot');
  return path.join(dataDir, 'notes.db');
}

function initDB(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      raw TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      action_items TEXT DEFAULT '[]',
      linked_note_ids TEXT DEFAULT '[]',
      analyzed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      analyzed_at TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_notes_analyzed ON notes(analyzed);
    CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at);

    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      insights_json TEXT NOT NULL,
      computed_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 18);
}

export function openDB(): DB {
  const dbPath = getDBPath();
  const homeDir = os.homedir();
  const dataDir = path.join(homeDir, '.jot');
  
  if (!require('fs').existsSync(dataDir)) {
    require('fs').mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  initDB(db);

  return {
    insertNote(content: string): Note {
      const id = generateId();
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        INSERT INTO notes (id, content, raw, created_at)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(id, content, content, now);
      return {
        id,
        content,
        raw: content,
        tags: [],
        action_items: [],
        linked_note_ids: [],
        analyzed: false,
        created_at: now,
        analyzed_at: null
      };
    },

    getNote(id: string): Note | undefined {
      const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');
      const row = stmt.get(id) as any;
      if (!row) return undefined;
      return {
        ...row,
        tags: JSON.parse(row.tags || '[]'),
        action_items: JSON.parse(row.action_items || '[]'),
        linked_note_ids: JSON.parse(row.linked_note_ids || '[]'),
        analyzed: Boolean(row.analyzed)
      };
    },

    getAllNotes(): Note[] {
      const stmt = db.prepare('SELECT * FROM notes ORDER BY created_at DESC');
      const rows = stmt.all() as any[];
      return rows.map(row => ({
        ...row,
        tags: JSON.parse(row.tags || '[]'),
        action_items: JSON.parse(row.action_items || '[]'),
        linked_note_ids: JSON.parse(row.linked_note_ids || '[]'),
        analyzed: Boolean(row.analyzed)
      }));
    },

    getNotesByTag(tag: string): Note[] {
      const stmt = db.prepare(`
        SELECT * FROM notes 
        WHERE tags LIKE ? 
        ORDER BY created_at DESC
      `);
      const rows = stmt.all(`%"${tag}"%`) as any[];
      return rows.map(row => ({
        ...row,
        tags: JSON.parse(row.tags || '[]'),
        action_items: JSON.parse(row.action_items || '[]'),
        linked_note_ids: JSON.parse(row.linked_note_ids || '[]'),
        analyzed: Boolean(row.analyzed)
      }));
    },

    searchNotes(query: string): Note[] {
      const stmt = db.prepare(`
        SELECT * FROM notes 
        WHERE content LIKE ? 
        ORDER BY created_at DESC
      `);
      const rows = stmt.all(`%${query}%`) as any[];
      return rows.map(row => ({
        ...row,
        tags: JSON.parse(row.tags || '[]'),
        action_items: JSON.parse(row.action_items || '[]'),
        linked_note_ids: JSON.parse(row.linked_note_ids || '[]'),
        analyzed: Boolean(row.analyzed)
      }));
    },

    updateNoteAnalysis(
      id: string,
      tags: string[],
      action_items: string[],
      linked_note_ids: string[]
    ): void {
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        UPDATE notes 
        SET tags = ?, action_items = ?, linked_note_ids = ?, analyzed = 1, analyzed_at = ?
        WHERE id = ?
      `);
      stmt.run(
        JSON.stringify(tags),
        JSON.stringify(action_items),
        JSON.stringify(linked_note_ids),
        now,
        id
      );
    },

    markAnalyzed(id: string): void {
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        UPDATE notes SET analyzed = 1, analyzed_at = ? WHERE id = ?
      `);
      stmt.run(now, id);
    },

    saveInsights(insights: string): void {
      const stmt = db.prepare(`
        INSERT INTO insights (insights_json) VALUES (?)
      `);
      stmt.run(insights);
    },

    getLatestInsights(): InsightsRecord | undefined {
      const stmt = db.prepare('SELECT * FROM insights ORDER BY id DESC LIMIT 1');
      return stmt.get() as InsightsRecord | undefined;
    }
  };
}