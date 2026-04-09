import { openDB } from './db.js';
import { runAnalysisCycle } from './analyzer.js';

const db = openDB();
runAnalysisCycle().catch(() => process.exit(1));
