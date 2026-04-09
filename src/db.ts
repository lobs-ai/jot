import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

export interface Note {
  id: string;
  content: string;
  raw: string;
  tags: string[];
  action_items: string[];
  linked_note_ids: string[];
  projects: string[];
  people: string[];
  analyzed: boolean;
  archived: boolean;
  is_urgent: boolean;
  created_at: string;
  analyzed_at: string | null;
}

export interface InsightsRecord {
  id: number;
  insights_json: string;
  computed_at: string;
}

export interface NoteFilters {
  tag?: string | null;
  from?: string | null;
  to?: string | null;
  includeArchived?: boolean;
}

export interface DB {
  insertNote(content: string): Note;
  getNote(id: string): Note | undefined;
  getAllNotes(filters?: NoteFilters): Note[];
  getNotesByTag(tag: string): Note[];
  searchNotes(query: string, filters?: NoteFilters): Note[];
  updateNoteContent(id: string, content: string): void;
  updateNoteAnalysis(
    id: string,
    tags: string[],
    action_items: string[],
    linked_note_ids: string[]
  ): void;
  deleteNote(id: string): void;
  archiveNote(id: string): void;
  unarchiveNote(id: string): void;
  linkNotes(id1: string, id2: string): void;
  unlinkNotes(id1: string, id2: string): void;
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
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'").get();

  if (!tableExists) {
    db.exec(`
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
        created_at TEXT DEFAULT (datetime('now')),
        analyzed_at TEXT
      );
      
      CREATE INDEX idx_notes_analyzed ON notes(analyzed);
      CREATE INDEX idx_notes_created ON notes(created_at);
      CREATE INDEX idx_notes_archived ON notes(archived);
    `);
  } else {
    try {
      db.exec(`ALTER TABLE notes ADD COLUMN archived INTEGER DEFAULT 0`);
    } catch {
      // column may already exist
    }
    try {
      db.exec(`ALTER TABLE notes ADD COLUMN projects TEXT DEFAULT '[]'`);
    } catch {
      // column may already exist
    }
    try {
      db.exec(`ALTER TABLE notes ADD COLUMN people TEXT DEFAULT '[]'`);
    } catch {
      // column may already exist
    }
    try {
      db.exec(`ALTER TABLE notes ADD COLUMN is_urgent INTEGER DEFAULT 0`);
    } catch {
      // column may already exist
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      insights_json TEXT NOT NULL,
      computed_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      due_date TEXT,
      priority TEXT DEFAULT 'medium',
      completed INTEGER DEFAULT 0,
      completed_at TEXT,
      note_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(completed);
    CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
  `);
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 18);
}

function rowToNote(row: any): Note {
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    action_items: JSON.parse(row.action_items || '[]'),
    linked_note_ids: JSON.parse(row.linked_note_ids || '[]'),
    projects: JSON.parse(row.projects || '[]'),
    people: JSON.parse(row.people || '[]'),
    analyzed: Boolean(row.analyzed),
    archived: Boolean(row.archived),
    is_urgent: Boolean(row.is_urgent)
  };
}

export function openDB(): DB {
  const dbPath = getDBPath();
  const homeDir = os.homedir();
  const dataDir = path.join(homeDir, '.jot');
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
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
        projects: [],
        people: [],
        analyzed: false,
        archived: false,
        is_urgent: false,
        created_at: now,
        analyzed_at: null
      };
    },

    getNote(id: string): Note | undefined {
      const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');
      const row = stmt.get(id) as any;
      if (!row) return undefined;
      return rowToNote(row);
    },

    getAllNotes(filters?: NoteFilters): Note[] {
      let sql = 'SELECT * FROM notes';
      const conditions: string[] = [];
      const params: any[] = [];

      if (filters) {
        if (!filters.includeArchived) {
          conditions.push('archived = 0');
        }
        if (filters.from) {
          conditions.push('created_at >= ?');
          params.push(filters.from);
        }
        if (filters.to) {
          conditions.push('created_at <= ?');
          params.push(filters.to + 'T23:59:59.999Z');
        }
        if (filters.tag) {
          conditions.push('tags LIKE ?');
          params.push(`%"${filters.tag}"%`);
        }
      } else {
        conditions.push('archived = 0');
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
      sql += ' ORDER BY created_at DESC';

      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as any[];
      return rows.map(rowToNote);
    },

    getNotesByTag(tag: string): Note[] {
      const stmt = db.prepare(`
        SELECT * FROM notes 
        WHERE tags LIKE ? AND archived = 0
        ORDER BY created_at DESC
      `);
      const rows = stmt.all(`%"${tag}"%`) as any[];
      return rows.map(rowToNote);
    },

    searchNotes(query: string, filters?: NoteFilters): Note[] {
      let sql = 'SELECT * FROM notes WHERE content LIKE ?';
      const params: any[] = [`%${query}%`];
      const conditions: string[] = [];

      if (filters) {
        if (!filters.includeArchived) {
          conditions.push('archived = 0');
        }
        if (filters.from) {
          conditions.push('created_at >= ?');
          params.push(filters.from);
        }
        if (filters.to) {
          conditions.push('created_at <= ?');
          params.push(filters.to + 'T23:59:59.999Z');
        }
        if (filters.tag) {
          conditions.push('tags LIKE ?');
          params.push(`%"${filters.tag}"%`);
        }
      } else {
        conditions.push('archived = 0');
      }

      if (conditions.length > 0) {
        sql += ' AND ' + conditions.join(' AND ');
      }
      sql += ' ORDER BY created_at DESC';

      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as any[];
      return rows.map(rowToNote);
    },

    updateNoteContent(id: string, content: string): void {
      const stmt = db.prepare('UPDATE notes SET content = ? WHERE id = ?');
      stmt.run(content, id);
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

    deleteNote(id: string): void {
      const stmt = db.prepare('DELETE FROM notes WHERE id = ?');
      stmt.run(id);
    },

    archiveNote(id: string): void {
      const stmt = db.prepare('UPDATE notes SET archived = 1 WHERE id = ?');
      stmt.run(id);
    },

    unarchiveNote(id: string): void {
      const stmt = db.prepare('UPDATE notes SET archived = 0 WHERE id = ?');
      stmt.run(id);
    },

    linkNotes(id1: string, id2: string): void {
      const note1 = this.getNote(id1);
      const note2 = this.getNote(id2);
      if (!note1 || !note2) return;

      if (!note1.linked_note_ids.includes(id2)) {
        const newLinks = [...note1.linked_note_ids, id2];
        const stmt = db.prepare('UPDATE notes SET linked_note_ids = ? WHERE id = ?');
        stmt.run(JSON.stringify(newLinks), id1);
      }

      if (!note2.linked_note_ids.includes(id1)) {
        const newLinks = [...note2.linked_note_ids, id1];
        const stmt = db.prepare('UPDATE notes SET linked_note_ids = ? WHERE id = ?');
        stmt.run(JSON.stringify(newLinks), id2);
      }
    },

    unlinkNotes(id1: string, id2: string): void {
      const note1 = this.getNote(id1);
      const note2 = this.getNote(id2);
      if (!note1 || !note2) return;

      const newLinks1 = note1.linked_note_ids.filter(id => id !== id2);
      const stmt1 = db.prepare('UPDATE notes SET linked_note_ids = ? WHERE id = ?');
      stmt1.run(JSON.stringify(newLinks1), id1);

      const newLinks2 = note2.linked_note_ids.filter(id => id !== id1);
      const stmt2 = db.prepare('UPDATE notes SET linked_note_ids = ? WHERE id = ?');
      stmt2.run(JSON.stringify(newLinks2), id2);
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
