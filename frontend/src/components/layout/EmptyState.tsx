import React from 'react';
import { Box } from 'lucide-react';
import styles from './EmptyState.module.css';

export function EmptyState() {
  return (
    <div className={styles.container}>
      <Box size={64} className={styles.icon} />
      <h2 className={styles.title}>MCP Workspace</h2>
      <p className={styles.description}>Wrap any RESTful API as a remote MCP service</p>
    </div>
  );
}
