import React from 'react';
import { Box, Text } from 'ink';

interface QuickActionsProps {
  isActive: boolean;
  exit: () => void;
}

export function QuickActions({ isActive, exit }: QuickActionsProps) {
  const actions = [
    { key: 'q', label: 'Quit' },
  ];

  return (
    <Box flexDirection="column">
      {actions.map(({ key, label }) => (
        <Box key={key} marginBottom={1}>
          <Text bold color={isActive ? 'green' : 'gray'}>
            [{key}]
          </Text>
          <Text> {label}</Text>
        </Box>
      ))}
    </Box>
  );
}