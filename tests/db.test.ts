import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { openDB, Note, DB } from '../src/db';

describe('Database', () => {
  let db: DB;
  let testDBPath: string;

  beforeEach(() => {
    const testDBDir = path.join(os.tmpdir(), 'jot-test-' + Math.random().toString(36).slice(2));
    if (!fs.existsSync(testDBDir)) {
      fs.mkdirSync(testDBDir, { recursive: true });
    }
    testDBPath = path.join(testDBDir, 'notes.db');
    
    vi.stubEnv('JOT_DB_PATH', testDBPath);
    
    const HomeDir = os.homedir();
    Object.defineProperty(os, 'homedir', {
      value: () => testDBDir,
      configurable: true
    });
    
    db = openDB();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      if (fs.existsSync(testDBPath)) {
        fs.unlinkSync(testDBPath);
      }
      const dir = path.dirname(testDBPath);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }
    } catch {}
  });

  describe('insertNote', () => {
    it('should insert a note and return it with an id', () => {
      const note = db.insertNote('Test note content');
      
      expect(note.id).toBeDefined();
      expect(note.content).toBe('Test note content');
      expect(note.raw).toBe('Test note content');
      expect(note.tags).toEqual([]);
      expect(note.action_items).toEqual([]);
      expect(note.linked_note_ids).toEqual([]);
      expect(note.analyzed).toBe(false);
      expect(note.archived).toBe(false);
      expect(note.created_at).toBeDefined();
    });
  });

  describe('getNote', () => {
    it('should retrieve a note by id', () => {
      const inserted = db.insertNote('Test note');
      const retrieved = db.getNote(inserted.id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe('Test note');
    });

    it('should return undefined for non-existent id', () => {
      const result = db.getNote('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getAllNotes', () => {
    it('should return all non-archived notes', () => {
      db.insertNote('Note 1');
      db.insertNote('Note 2');
      db.insertNote('Note 3');
      
      const notes = db.getAllNotes();
      expect(notes.length).toBe(3);
    });

    it('should exclude archived notes by default', () => {
      const note1 = db.insertNote('Active note');
      const note2 = db.insertNote('Archived note');
      db.archiveNote(note2.id);
      
      const notes = db.getAllNotes();
      expect(notes.length).toBe(1);
      expect(notes[0].content).toBe('Active note');
    });

    it('should include archived notes when filter is set', () => {
      const note1 = db.insertNote('Active note');
      const note2 = db.insertNote('Archived note');
      db.archiveNote(note2.id);
      
      const notes = db.getAllNotes({ includeArchived: true });
      expect(notes.length).toBe(2);
    });
  });

  describe('searchNotes', () => {
    it('should find notes containing query', () => {
      db.insertNote('Meeting with advisor about project');
      db.insertNote('Lunch at noon');
      db.insertNote('Project deadline tomorrow');
      
      const results = db.searchNotes('project');
      expect(results.length).toBe(2);
    });

    it('should return empty array for no matches', () => {
      db.insertNote('Some note');
      const results = db.searchNotes('nonexistent');
      expect(results.length).toBe(0);
    });
  });

  describe('updateNoteContent', () => {
    it('should update note content', () => {
      const note = db.insertNote('Original content');
      db.updateNoteContent(note.id, 'Updated content');
      
      const updated = db.getNote(note.id);
      expect(updated?.content).toBe('Updated content');
    });
  });

  describe('deleteNote', () => {
    it('should delete a note', () => {
      const note = db.insertNote('To be deleted');
      db.deleteNote(note.id);
      
      const result = db.getNote(note.id);
      expect(result).toBeUndefined();
    });
  });

  describe('archiveNote / unarchiveNote', () => {
    it('should archive a note', () => {
      const note = db.insertNote('To be archived');
      db.archiveNote(note.id);
      
      const retrieved = db.getNote(note.id);
      expect(retrieved?.archived).toBe(true);
    });

    it('should unarchive a note', () => {
      const note = db.insertNote('To be unarchived');
      db.archiveNote(note.id);
      db.unarchiveNote(note.id);
      
      const retrieved = db.getNote(note.id);
      expect(retrieved?.archived).toBe(false);
    });
  });

  describe('linkNotes / unlinkNotes', () => {
    it('should link two notes bidirectionally', () => {
      const note1 = db.insertNote('Note 1');
      const note2 = db.insertNote('Note 2');
      
      db.linkNotes(note1.id, note2.id);
      
      const retrieved1 = db.getNote(note1.id);
      const retrieved2 = db.getNote(note2.id);
      
      expect(retrieved1?.linked_note_ids).toContain(note2.id);
      expect(retrieved2?.linked_note_ids).toContain(note1.id);
    });

    it('should unlink two notes', () => {
      const note1 = db.insertNote('Note 1');
      const note2 = db.insertNote('Note 2');
      
      db.linkNotes(note1.id, note2.id);
      db.unlinkNotes(note1.id, note2.id);
      
      const retrieved1 = db.getNote(note1.id);
      const retrieved2 = db.getNote(note2.id);
      
      expect(retrieved1?.linked_note_ids).not.toContain(note2.id);
      expect(retrieved2?.linked_note_ids).not.toContain(note1.id);
    });
  });

  describe('updateNoteAnalysis', () => {
    it('should update tags, action items, and linked notes', () => {
      const note = db.insertNote('Test note');
      db.updateNoteAnalysis(
        note.id,
        ['research', 'important'],
        ['Finish by Friday'],
        []
      );
      
      const retrieved = db.getNote(note.id);
      expect(retrieved?.tags).toEqual(['research', 'important']);
      expect(retrieved?.action_items).toEqual(['Finish by Friday']);
      expect(retrieved?.analyzed).toBe(true);
    });
  });
});
