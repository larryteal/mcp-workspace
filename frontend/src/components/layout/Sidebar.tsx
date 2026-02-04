import React from 'react';
import { Github } from 'lucide-react';
import { SidebarHeader } from './SidebarHeader';
import { MCPTree } from './MCPTree';
import { config } from '@/config';
import styles from './Sidebar.module.css';

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <SidebarHeader />
      <MCPTree />
      <div className={styles.footer}>
        <a
          href={config.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.githubLink}
          title="GitHub & Documentation"
        >
          <Github size={16} />
          <span>GitHub & Docs</span>
        </a>
      </div>
    </aside>
  );
}
