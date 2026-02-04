import React from 'react';
import { Box } from 'lucide-react';
import styles from './SidebarHeader.module.css';

export function SidebarHeader() {
  return (
    <div className={styles.header}>
      <div className={styles.logo}>
        <Box size={24} className={styles.icon} />
      </div>
      <span className={styles.title}>MCP Workspace</span>
    </div>
  );
}
