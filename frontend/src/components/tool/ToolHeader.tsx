import React from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/common';
import type { Tool } from '@/types';
import styles from './ToolHeader.module.css';

interface ToolHeaderProps {
  tool: Tool;
  onTest: () => void;
  loading?: boolean;
}

export function ToolHeader({ tool, onTest, loading }: ToolHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.info}>
        <h1 className={styles.name}>{tool.name}</h1>
        {tool.description && (
          <p className={styles.description}>{tool.description}</p>
        )}
      </div>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          onClick={onTest}
          loading={loading}
          icon={<Play size={16} />}
        >
          Test
        </Button>
      </div>
    </div>
  );
}
