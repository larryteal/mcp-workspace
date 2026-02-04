import React from 'react';
import { X, Info, Zap } from 'lucide-react';
import { useTabs } from '@/context/TabContext';
import { useMCP } from '@/context/MCPContext';
import { useDirty } from '@/context/DirtyContext';
import styles from './TabBar.module.css';

export function TabBar() {
  const { tabs, activeTabId, setActiveTabId, closeTab } = useTabs();
  const { setSelectedMcpId, setSelectedToolId } = useMCP();
  const { isOverviewDirty, isToolDirty } = useDirty();

  const handleTabClick = (tabId: string, mcpId: string, toolId?: string) => {
    setActiveTabId(tabId);
    setSelectedMcpId(mcpId);
    setSelectedToolId(toolId || null);
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  // Check if a tab has unsaved changes
  const isTabDirty = (tab: typeof tabs[0]): boolean => {
    if (tab.type === 'overview') {
      return isOverviewDirty(tab.mcpId);
    } else if (tab.toolId) {
      return isToolDirty(tab.mcpId, tab.toolId);
    }
    return false;
  };

  return (
    <div className={styles.tabBar}>
      <div className={styles.tabs}>
        {tabs.map(tab => {
          const isDirty = isTabDirty(tab);
          return (
            <div
              key={tab.id}
              className={`${styles.tab} ${tab.id === activeTabId ? styles.active : ''}`}
              onClick={() => handleTabClick(tab.id, tab.mcpId, tab.toolId)}
            >
              {tab.type === 'overview' ? (
                <Info size={14} className={styles.icon} />
              ) : (
                <Zap size={14} className={styles.icon} />
              )}
              <span className={`${styles.title} ${tab.type === 'tool' ? styles.mono : ''}`}>
                {tab.title}
              </span>
              <div className={styles.closeArea}>
                {isDirty && <span className={styles.dirtyIndicator} />}
                <button
                  className={styles.closeBtn}
                  onClick={(e) => handleCloseTab(e, tab.id)}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
