import { beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const testDBDir = path.join(os.tmpdir(), 'jot-test-' + Math.random().toString(36).slice(2));
const testDBPath = path.join(testDBDir, 'notes.db');

beforeEach(() => {
  if (!fs.existsSync(testDBDir)) {
    fs.mkdirSync(testDBDir, { recursive: true });
  }
  vi.stubEnv('XDG_DATA_HOME', testDBDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    if (fs.existsSync(testDBPath)) {
      fs.unlinkSync(testDBPath);
    }
    if (fs.existsSync(testDBDir)) {
      fs.rmSync(testDBDir, { recursive: true });
    }
  } catch {}
});

export { testDBDir, testDBPath };
