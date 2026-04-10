import React from 'react';
import { Box, Text } from 'ink';
import { DB } from '../../db.js';
import { getTodos } from '../../todos.js';

interface StatsWidgetProps {
  db: DB;
  refreshKey: number;
}

export function StatsWidget({ db, refreshKey }: StatsWidgetProps) {
  const [stats, setStats] = React.useState({
    totalNotes: 0,
    archivedNotes: 0,
    totalTodos: 0,
    completedTodos: 0,
    overdueTodos: 0,
    topTags: [] as { tag: string; count: number }[],
  });

  React.useEffect(() => {
    const notes = db.getAllNotes();
    const todos = getTodos();
    const tagCounts: Record<string, number> = {};

    notes.forEach(note => {
      note.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });

    const topTags = Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const today = new Date().toISOString().split('T')[0];
    const overdueTodos = todos.filter(
      t => !t.completed && t.due_date && t.due_date < today
    );

    setStats({
      totalNotes: notes.length,
      archivedNotes: notes.filter(n => n.archived).length,
      totalTodos: todos.length,
      completedTodos: todos.filter(t => t.completed).length,
      overdueTodos: overdueTodos.length,
      topTags,
    });
  }, [db, refreshKey]);

  return (
    <Box
      flexGrow={1}
      borderStyle="round"
      borderColor="gray"
      padding={1}
      flexDirection="column"
    >
      <Box paddingBottom={1} marginBottom={1}>
        <Text bold> Stats </Text>
      </Box>

      <Box flexDirection="column" gap={0}>
        <Box>
          <Text dimColor>Notes: </Text>
          <Text>{stats.totalNotes}</Text>
          {stats.archivedNotes > 0 && (
            <Text dimColor> ({stats.archivedNotes} archived)</Text>
          )}
        </Box>

        <Box>
          <Text dimColor>Todos: </Text>
          <Text>{stats.totalTodos - stats.completedTodos} active</Text>
          <Text dimColor> / {stats.completedTodos} done</Text>
        </Box>

        {stats.overdueTodos > 0 && (
          <Box>
            <Text color="red">Overdue: {stats.overdueTodos}</Text>
          </Box>
        )}

        {stats.topTags.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Top Tags:</Text>
            {stats.topTags.map(({ tag, count }) => (
              <Text key={tag} dimColor>
                #{tag} ({count})
              </Text>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}