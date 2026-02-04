import React from 'react';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className={styles.layout}>
      <Sidebar />
      <div className={styles.main}>
        <TabBar />
        <div className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
}
