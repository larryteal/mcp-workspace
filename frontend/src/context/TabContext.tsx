import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { Tab } from '@/types';

interface TabContextType {
  tabs: Tab[];
  activeTabId: string | null;
  setActiveTabId: (id: string | null) => void;
  openTab: (tab: Omit<Tab, 'id'>) => string;
  closeTab: (id: string) => void;
  closeTabsByMcpId: (mcpId: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  findTab: (mcpId: string, toolId?: string) => Tab | undefined;
}

const TabContext = createContext<TabContextType | null>(null);

const generateId = () => Math.random().toString(36).substring(2, 9);

export function TabProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const openTab = useCallback((tabData: Omit<Tab, 'id'>) => {
    // Check if tab already exists
    const existingTab = tabs.find(
      t =>
        t.mcpId === tabData.mcpId &&
        t.type === tabData.type &&
        t.toolId === tabData.toolId
    );

    if (existingTab) {
      setActiveTabId(existingTab.id);
      return existingTab.id;
    }

    const id = generateId();
    const newTab: Tab = { ...tabData, id };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
    return id;
  }, [tabs]);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== id);
      if (activeTabId === id && newTabs.length > 0) {
        // Activate the previous tab or the first one
        const index = prev.findIndex(t => t.id === id);
        const newActiveIndex = Math.max(0, index - 1);
        setActiveTabId(newTabs[newActiveIndex]?.id || null);
      } else if (newTabs.length === 0) {
        setActiveTabId(null);
      }
      return newTabs;
    });
  }, [activeTabId]);

  const closeTabsByMcpId = useCallback((mcpId: string) => {
    setTabs(prev => {
      const newTabs = prev.filter(t => t.mcpId !== mcpId);
      // If active tab was removed, activate another tab
      const activeTabRemoved = prev.find(t => t.id === activeTabId)?.mcpId === mcpId;
      if (activeTabRemoved) {
        setActiveTabId(newTabs.length > 0 ? newTabs[0].id : null);
      }
      return newTabs;
    });
  }, [activeTabId]);

  const updateTab = useCallback((id: string, updates: Partial<Tab>) => {
    setTabs(prev =>
      prev.map(t => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const findTab = useCallback((mcpId: string, toolId?: string) => {
    return tabs.find(
      t =>
        t.mcpId === mcpId &&
        (toolId ? t.toolId === toolId : t.type === 'overview')
    );
  }, [tabs]);

  return (
    <TabContext.Provider
      value={{
        tabs,
        activeTabId,
        setActiveTabId,
        openTab,
        closeTab,
        closeTabsByMcpId,
        updateTab,
        findTab,
      }}
    >
      {children}
    </TabContext.Provider>
  );
}

export function useTabs() {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabs must be used within a TabProvider');
  }
  return context;
}
