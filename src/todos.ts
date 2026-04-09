import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

function getDBPath(): string {
  const homeDir = os.homedir();
  const dataDir = path.join(homeDir, '.jot');
  return path.join(dataDir, 'notes.db');
}

function openTodoDB(): Database.Database {
  const dbPath = getDBPath();
  const homeDir = os.homedir();
  const dataDir = path.join(homeDir, '.jot');
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrateLegacyTodoRows(db);
  return db;
}

function normalizeLegacyTodoRow(row: { content: string; due_date: string | null; priority: string | null }): { content: string; due_date: string | null; priority: 'high' | 'medium' | 'low' } {
  let content = row.content;
  let dueDate = row.due_date;
  let priority = (row.priority === 'high' || row.priority === 'low' || row.priority === 'medium' ? row.priority : 'medium') as 'high' | 'medium' | 'low';

  const dueMatch = content.match(/(?:^|\s)--due\s+(\d{4}-\d{2}-\d{2})(?=\s|$)/);
  if (dueMatch && !dueDate) {
    dueDate = dueMatch[1];
  }

  const priorityMatch = content.match(/(?:^|\s)--priority\s+(high|medium|low)(?=\s|$)/);
  if (priorityMatch) {
    priority = priorityMatch[1] as 'high' | 'medium' | 'low';
  }

  if (/(^|\s)--high(?=\s|$)/.test(content)) {
    priority = 'high';
  } else if (/(^|\s)--low(?=\s|$)/.test(content)) {
    priority = 'low';
  } else if (/(^|\s)--medium(?=\s|$)/.test(content)) {
    priority = 'medium';
  }

  content = content
    .replace(/(?:^|\s)--due\s+\d{4}-\d{2}-\d{2}(?=\s|$)/g, ' ')
    .replace(/(?:^|\s)--priority\s+(high|medium|low)(?=\s|$)/g, ' ')
    .replace(/(?:^|\s)--(?:high|medium|low)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { content, due_date: dueDate, priority };
}

function migrateLegacyTodoRows(db: Database.Database): void {
  const rows = db.prepare(`
    SELECT id, content, due_date, priority
    FROM todos
    WHERE content LIKE '%--priority %'
       OR content LIKE '% --high%'
       OR content LIKE '% --medium%'
       OR content LIKE '% --low%'
       OR content LIKE '%--due %'
  `).all() as Array<{ id: string; content: string; due_date: string | null; priority: string | null }>;

  if (rows.length === 0) {
    return;
  }

  const update = db.prepare('UPDATE todos SET content = ?, due_date = ?, priority = ? WHERE id = ?');
  const runMigration = db.transaction((items: Array<{ id: string; content: string; due_date: string | null; priority: string | null }>) => {
    for (const row of items) {
      const normalized = normalizeLegacyTodoRow(row);
      update.run(normalized.content || row.content, normalized.due_date, normalized.priority, row.id);
    }
  });

  runMigration(rows);
}

export interface Todo {
  id: string;
  content: string;
  due_date: string | null;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
  completed_at: string | null;
  note_id: string | null;
  created_at: string;
}

export interface TodoFilters {
  includeCompleted?: boolean;
  overdue?: boolean;
  dueToday?: boolean;
  priority?: 'high' | 'medium' | 'low';
}

export interface TodoUpdates {
  content?: string;
  due_date?: string | null;
  priority?: 'high' | 'medium' | 'low';
}

export function insertTodo(
  content: string,
  dueDate?: string | null,
  priority: 'high' | 'medium' | 'low' = 'medium',
  noteId?: string | null
): Todo {
  const db = openTodoDB();
  const id = Math.random().toString(36).substring(2, 18);
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO todos (id, content, due_date, priority, note_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, content, dueDate || null, priority, noteId || null, now);
  
  return {
    id,
    content,
    due_date: dueDate || null,
    priority,
    completed: false,
    completed_at: null,
    note_id: noteId || null,
    created_at: now
  };
}

export function getTodos(filters?: TodoFilters): Todo[] {
  const db = openTodoDB();
  let sql = 'SELECT * FROM todos';
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters) {
    if (!filters.includeCompleted) {
      conditions.push('completed = 0');
    }
    if (filters.overdue) {
      const today = new Date().toISOString().split('T')[0];
      conditions.push('due_date < ?');
      params.push(today);
      conditions.push('completed = 0');
    }
    if (filters.dueToday) {
      const today = new Date().toISOString().split('T')[0];
      conditions.push('due_date = ?');
      params.push(today);
      conditions.push('completed = 0');
    }
    if (filters.priority) {
      conditions.push('priority = ?');
      params.push(filters.priority);
    }
  } else {
    conditions.push('completed = 0');
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY CASE priority WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 WHEN \'low\' THEN 3 END, due_date ASC, created_at DESC';

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as any[];
  return rows.map(rowToTodo);
}

export function getTodo(id: string): Todo | undefined {
  const db = openTodoDB();
  const stmt = db.prepare('SELECT * FROM todos WHERE id = ?');
  const row = stmt.get(id) as any;
  if (!row) return undefined;
  return rowToTodo(row);
}

export function getOverdueTodos(): Todo[] {
  return getTodos({ overdue: true });
}

export function getDueTodayTodos(): Todo[] {
  return getTodos({ dueToday: true });
}

export function updateTodo(id: string, updates: TodoUpdates): void {
  const db = openTodoDB();
  const setClauses: string[] = [];
  const params: any[] = [];

  if (updates.content !== undefined) {
    setClauses.push('content = ?');
    params.push(updates.content);
  }
  if (updates.due_date !== undefined) {
    setClauses.push('due_date = ?');
    params.push(updates.due_date);
  }
  if (updates.priority !== undefined) {
    setClauses.push('priority = ?');
    params.push(updates.priority);
  }

  if (setClauses.length === 0) return;

  params.push(id);
  const stmt = db.prepare(`UPDATE todos SET ${setClauses.join(', ')} WHERE id = ?`);
  stmt.run(...params);
}

export function completeTodo(id: string): void {
  const db = openTodoDB();
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE todos SET completed = 1, completed_at = ? WHERE id = ?');
  stmt.run(now, id);
}

export function uncompleteTodo(id: string): void {
  const db = openTodoDB();
  const stmt = db.prepare('UPDATE todos SET completed = 0, completed_at = NULL WHERE id = ?');
  stmt.run(id);
}

export function deleteTodo(id: string): void {
  const db = openTodoDB();
  const stmt = db.prepare('DELETE FROM todos WHERE id = ?');
  stmt.run(id);
}

export function createTodosFromActionItems(actionItems: string[], noteId: string): Todo[] {
  const todos: Todo[] = [];
  for (const item of actionItems) {
    const todo = insertTodo(item, null, 'medium', noteId);
    todos.push(todo);
  }
  return todos;
}

function rowToTodo(row: any): Todo {
  return {
    id: row.id,
    content: row.content,
    due_date: row.due_date,
    priority: row.priority || 'medium',
    completed: Boolean(row.completed),
    completed_at: row.completed_at,
    note_id: row.note_id,
    created_at: row.created_at
  };
}

export function formatTodoList(todos: Todo[]): string {
  if (todos.length === 0) {
    return 'No todos. Add one with: jot todo add "task"';
  }

  let output = `=== ${todos.length} todo(s) ===\n\n`;
  
  for (const todo of todos) {
    const due = todo.due_date ? ` (due: ${todo.due_date})` : '';
    const pri = `[${todo.priority.toUpperCase()}]`;
    const done = todo.completed ? '[x]' : '[ ]';
    output += `${done} ${pri} ${todo.content}${due}\n`;
    output += `    id: ${todo.id.slice(0, 8)}\n`;
  }
  
  return output;
}
