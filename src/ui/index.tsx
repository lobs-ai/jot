import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { openDB } from '../db.js';

export function runUI() {
  const db = openDB();

  render(
    <App db={db} exitCallback={() => process.exit(0)} />
  );
}