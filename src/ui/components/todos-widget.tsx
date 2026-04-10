import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { getTodos, Todo } from '../../todos.js';

interface TodosWidgetProps {
  refreshKey: number;
  isActive: boolean;
  selectedIndex: number;
  onSelectIndexChange: (index: number) => void;
}

export function TodosWidget({
  refreshKey,
  isActive,
  selectedIndex,
  onSelectIndexChange: _onSelectIndexChange,
}: TodosWidgetProps) {
  const [todos, setTodos] = useState<Todo[]>([]);

  useEffect(() => {
    const allTodos = getTodos({ includeCompleted: false });
    setTodos(allTodos);
  }, [refreshKey]);

  const visibleCount = 12;
  const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(visibleCount / 2), Math.max(0, todos.length - visibleCount)));
  const visibleTodos = todos.slice(startIndex, startIndex + visibleCount);

  const priorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'red';
      case 'medium':
        return 'yellow';
      case 'low':
        return 'blue';
      default:
        return 'gray';
    }
  };

  const formatDue = (dueDate: string | null) => {
    if (!dueDate) return '';
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    if (dueDate === today) return ' today';
    if (dueDate === tomorrow) return ' tomorrow';
    if (dueDate < today) return ` (overdue!)`;
    return ` ${dueDate}`;
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      {isActive && <Text dimColor>↑↓ navigate</Text>}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        {todos.length === 0 ? (
          <Text dimColor>No todos.</Text>
        ) : (
          visibleTodos.map((todo, i) => {
            const globalIndex = startIndex + i;
            const isSelected = globalIndex === selectedIndex;

            return (
              <Box
                key={todo.id}
                flexDirection="column"
                paddingLeft={1}
                borderStyle={isSelected ? 'bold' : undefined}
                borderColor={isSelected ? 'green' : undefined}
              >
                <Text bold={isSelected} color={isSelected ? 'green' : undefined}>
                  {todo.content.slice(0, 60)}
                  {todo.content.length > 60 ? '...' : ''}
                </Text>
                <Box>
                  <Text color={priorityColor(todo.priority)}>
                    [{todo.priority}]
                  </Text>
                  <Text dimColor>{formatDue(todo.due_date)}</Text>
                </Box>
              </Box>
            );
          })
        )}
      </Box>
      <Text dimColor>
        {todos.length > 0 && `${selectedIndex + 1}/${todos.length}`}
      </Text>
    </Box>
  );
}