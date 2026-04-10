import React from 'react';
import { Box, Text } from 'ink';
import { DB } from '../../db.js';

interface QuickActionsProps {
  isActive: boolean;
  exit: () => void;
  db: DB;
  refresh: () => void;
}

export function QuickActions({ isActive, exit: _exit, db: _db, refresh: _refresh }: QuickActionsProps) {
  const actions = [
    { key: 'n', label: 'New Note', color: 'green' },
    { key: 'r', label: 'Refresh', color: isActive ? 'yellow' : 'gray' },
    { key: 'q', label: 'Quit', color: isActive ? 'red' : 'gray' },
  ];

  return (
    <Box flexDirection="column">
      {actions.map(({ key, label, color }) => (
        <Box key={key} marginBottom={1}>
          <Text bold color={isActive ? color : 'gray'}>
            [{key}]
          </Text>
          <Text color={isActive ? color : 'gray'}> {label}</Text>
        </Box>
      ))}
    </Box>
  );
}