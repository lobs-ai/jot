import { openDB, InsightsRecord } from './db';
import { getActiveBackend } from './config';

export interface Insights {
  total_notes: number;
  tag_summary: { tag: string; count: number }[];
  tag_trends: { tag: string; trend: 'rising' | 'falling' | 'stable'; note_ids: string[] }[];
  action_items: { text: string; note_id: string; created_at: string; stale: boolean }[];
  orphan_notes: { id: string; content: string; created_at: string }[];
  research_threads: { topic: string; related_note_ids: string[]; summary: string }[];
  linked_notes: { note_id: string; linked_note_ids: string[]; reason: string }[];
  patterns: { pattern: string; evidence: string[]; recommendation: string }[];
  generated_at: string;
}

function computeBasicInsights(): {
  total_notes: number;
  tag_summary: { tag: string; count: number }[];
  orphan_notes: { id: string; content: string; created_at: string }[];
} {
  const db = openDB();
  const allNotes = db.getAllNotes();

  const tagCounts = new Map<string, number>();
  const orphanNotes: { id: string; content: string; created_at: string }[] = [];

  for (const note of allNotes) {
    if (note.tags.length === 0) {
      orphanNotes.push({ id: note.id, content: note.content, created_at: note.created_at });
    }
    for (const tag of note.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const tagSummary = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }));

  return {
    total_notes: allNotes.length,
    tag_summary: tagSummary,
    orphan_notes: orphanNotes
  };
}

export async function generateInsights(): Promise<Insights> {
  const db = openDB();
  const allNotes = db.getAllNotes();

  const basic = computeBasicInsights();

  if (allNotes.length === 0) {
    return {
      total_notes: 0,
      tag_summary: [],
      tag_trends: [],
      action_items: [],
      orphan_notes: [],
      research_threads: [],
      linked_notes: [],
      patterns: [],
      generated_at: new Date().toISOString()
    };
  }

  // Compute action items with stale detection
  const now = new Date();
  const actionItems: { text: string; note_id: string; created_at: string; stale: boolean }[] = [];
  for (const note of allNotes) {
    for (const action of note.action_items) {
      const noteDate = new Date(note.created_at);
      const daysOld = Math.floor((now.getTime() - noteDate.getTime()) / (1000 * 60 * 60 * 24));
      actionItems.push({
        text: action,
        note_id: note.id,
        created_at: note.created_at,
        stale: daysOld > 7
      });
    }
  }

  // Deep analysis via local model
  const { url, model, apiType } = getActiveBackend();

  // Build context with timestamps for trend analysis
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const notesByAge = {
    recent: allNotes.filter(n => new Date(n.created_at) >= thirtyDaysAgo),
    older: allNotes.filter(n => {
      const d = new Date(n.created_at);
      return d >= sixtyDaysAgo && d < thirtyDaysAgo;
    }),
    old: allNotes.filter(n => new Date(n.created_at) < sixtyDaysAgo)
  };

  const allContent = allNotes
    .map(n => `[${n.id.slice(0,8)}] (${n.created_at.slice(0,10)}) ${n.content}`)
    .join('\n---\n');

  const recentContent = notesByAge.recent
    .map(n => `[${n.id.slice(0,8)}] (${n.created_at.slice(0,10)}) ${n.content}`)
    .join('\n---\n');

  const systemPrompt = `You are a research and productivity insights analyst. Analyze a user's note corpus and provide SPECIFIC, ACTIONABLE insights backed by actual note references.

IMPORTANT: You must cite specific note IDs (e.g., "note ab12cd34") and quote specific content from the notes. Do NOT give generic advice like "schedule dedicated focus time" or "create templates". Every insight must reference actual notes and their content.

Always respond with ONLY valid JSON, no markdown. Return an object with these fields:
- tag_trends: array of {tag, trend ("rising"/"falling"/"stable"), note_ids: string[]} - tags that are trending up/down
- research_threads: array of {topic, related_note_ids: string[], summary} - research themes with specific note references
- linked_notes: array of {note_id, linked_note_ids: string[], reason} - notes that should be connected
- patterns: array of {pattern, evidence: string[], recommendation} - interesting patterns with specific evidence

Keep each array to 5 items max. Be specific and cite note IDs.`;

  const userPrompt = `Analyze these notes and identify SPECIFIC patterns:

=== ALL NOTES ===
${allContent}

=== RECENT NOTES (last 30 days) ===
${recentContent}

=== NOTES OVERVIEW ===
Total: ${allNotes.length}
Recent (30d): ${notesByAge.recent.length}
Older (30-60d): ${notesByAge.older.length}
Old (60d+): ${notesByAge.old.length}

Identify:
1. Tag frequency trends - which tags are increasing/decreasing
2. Stale action items - action items mentioned >7 days ago that were never completed
3. Orphan notes - notes with no tags that could benefit from categorization
4. Research clusters - topics that span multiple notes and should be linked
5. Notable patterns - anything unusual or interesting

Respond with JSON: {"tag_trends": [...], "research_threads": [...], "linked_notes": [...], "patterns": [...]}`;

  let tagTrends: { tag: string; trend: 'rising' | 'falling' | 'stable'; note_ids: string[] }[] = [];
  let researchThreads: { topic: string; related_note_ids: string[]; summary: string }[] = [];
  let linkedNotes: { note_id: string; linked_note_ids: string[]; reason: string }[] = [];
  let patterns: { pattern: string; evidence: string[]; recommendation: string }[] = [];

  try {
    let response: Response;

    if (apiType === 'ollama') {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          stream: false,
          options: {
            temperature: 0.4,
            num_predict: 1200
          }
        })
      });
    } else {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.4,
          max_tokens: 1200
        })
      });
    }

    if (response.ok) {
      const data = await response.json() as { message?: { content?: string }; choices?: Array<{ message?: { content?: string } }> };

      let rawResponse: string;
      if (apiType === 'ollama') {
        rawResponse = data.message?.content?.trim() || '{}';
      } else {
        rawResponse = data.choices?.[0]?.message?.content?.trim() || '{}';
      }

      let jsonStr = rawResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '').trim();
      }

      const parsed = JSON.parse(jsonStr);
      tagTrends = parsed.tag_trends || [];
      researchThreads = parsed.research_threads || [];
      linkedNotes = parsed.linked_notes || [];
      patterns = parsed.patterns || [];
    }
  } catch (error) {
    console.error('Insights analysis failed:', error);
  }

  const insights: Insights = {
    total_notes: basic.total_notes,
    tag_summary: basic.tag_summary,
    tag_trends: tagTrends,
    action_items: actionItems,
    orphan_notes: basic.orphan_notes.slice(0, 20),
    research_threads: researchThreads,
    linked_notes: linkedNotes,
    patterns: patterns,
    generated_at: new Date().toISOString()
  };

  // Store in DB
  db.saveInsights(JSON.stringify(insights));

  return insights;
}

export function getStoredInsights(): Insights | null {
  const db = openDB();
  const record = db.getLatestInsights();
  if (!record) return null;

  try {
    return JSON.parse(record.insights_json) as Insights;
  } catch {
    return null;
  }
}

export function formatInsights(insights: Insights): string {
  let output = '\n=== Jot Insights ===\n';
  output += `Total notes: ${insights.total_notes}\n`;
  output += `Generated: ${new Date(insights.generated_at).toLocaleString()}\n`;

  if (insights.tag_summary.length > 0) {
    output += '\nTop Tags:\n';
    insights.tag_summary.slice(0, 10).forEach(({ tag, count }) => {
      output += `  #${tag}: ${count}\n`;
    });
  }

  if (insights.tag_trends.length > 0) {
    output += '\nTag Trends:\n';
    insights.tag_trends.forEach(({ tag, trend, note_ids }) => {
      const arrow = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→';
      const refs = note_ids.slice(0, 3).map(id => id.slice(0, 8)).join(', ');
      output += `  ${arrow} #${tag} (${trend}): ${refs}${note_ids.length > 3 ? '...' : ''}\n`;
    });
  }

  if (insights.action_items.length > 0) {
    const staleItems = insights.action_items.filter(i => i.stale);
    if (staleItems.length > 0) {
      output += `\n⚠️ ${staleItems.length} stale action item(s) (older than 7 days):\n`;
      staleItems.slice(0, 5).forEach((item, i) => {
        const age = Math.floor((Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24));
        output += `  ${i + 1}. "${item.text}" (note ${item.note_id.slice(0, 8)}, ${age}d old)\n`;
      });
    }
    const freshItems = insights.action_items.filter(i => !i.stale);
    if (freshItems.length > 0 && freshItems.length <= 10) {
      output += `\n${freshItems.length} recent action item(s):\n`;
      freshItems.forEach((item, i) => {
        output += `  ${i + 1}. "${item.text}" (note ${item.note_id.slice(0, 8)})\n`;
      });
    }
  }

  if (insights.orphan_notes.length > 0) {
    output += `\n${insights.orphan_notes.length} untagged note(s):\n`;
    insights.orphan_notes.slice(0, 5).forEach(n => {
      const preview = n.content.length > 60 ? n.content.slice(0, 60) + '...' : n.content;
      output += `  - note ${n.id.slice(0, 8)}: "${preview}"\n`;
    });
    if (insights.orphan_notes.length > 5) {
      output += `  ... and ${insights.orphan_notes.length - 5} more\n`;
    }
  }

  if (insights.research_threads.length > 0) {
    output += '\nResearch Threads:\n';
    insights.research_threads.forEach(thread => {
      const refs = thread.related_note_ids.slice(0, 3).map(id => id.slice(0, 8)).join(', ');
      output += `  → ${thread.topic}\n`;
      output += `    Notes: ${refs}\n`;
      output += `    ${thread.summary}\n`;
    });
  }

  if (insights.linked_notes.length > 0) {
    output += '\nSuggested Links:\n';
    insights.linked_notes.slice(0, 5).forEach(link => {
      const targets = link.linked_note_ids.map(id => id.slice(0, 8)).join(', ');
      output += `  note ${link.note_id.slice(0, 8)} ↔ ${targets}\n`;
      output += `    Reason: ${link.reason}\n`;
    });
  }

  if (insights.patterns.length > 0) {
    output += '\nPatterns & Recommendations:\n';
    insights.patterns.forEach(p => {
      output += `  • ${p.pattern}\n`;
      p.evidence.slice(0, 2).forEach(e => {
        output += `    Evidence: "${e.slice(0, 80)}${e.length > 80 ? '...' : ''}"\n`;
      });
      output += `    → ${p.recommendation}\n`;
    });
  }

  return output;
}
