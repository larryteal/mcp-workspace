import React, { useState } from 'react';
import { Plus, Save, RefreshCw } from 'lucide-react';
import { useMCP } from '@/context/MCPContext';
import { useTabs } from '@/context/TabContext';
import { useDirty } from '@/context/DirtyContext';
import { MCPTreeItem } from './MCPTreeItem';
import styles from './MCPTree.module.css';

export function MCPTree() {
  const { services, addService, setSelectedMcpId, setSelectedToolId, saveAllToServer, syncFromServer, isSaving, isSyncing, validateAllBeforeSave } = useMCP();
  const { openTab } = useTabs();
  const { hasAnyDirty, markAllSaved } = useDirty();
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const hasDirtyItems = hasAnyDirty();

  const handleAddService = () => {
    const id = addService();
    setSelectedMcpId(id);
    setSelectedToolId(null);
    openTab({
      type: 'overview',
      mcpId: id,
      title: 'Overview',
    });
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const success = await saveAllToServer();
      if (success) {
        // Mark all as saved
        markAllSaved(services);
      } else {
        alert('Failed to save all configurations');
      }
    } catch (error) {
      console.error('Save all error:', error);
      alert('Failed to save all configurations');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    // Show confirmation dialog if there are unsaved changes
    if (hasAnyDirty()) {
      const confirmed = window.confirm('This will overwrite local changes with server data. Continue?');
      if (!confirmed) return;
    }

    setSyncing(true);
    try {
      await syncFromServer();
    } catch (error) {
      console.error('Sync error:', error);
      alert('Failed to sync from server');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className={styles.tree}>
      <div className={styles.header}>
        <span className={styles.label}>MCP SERVICES</span>
        <div className={styles.actions}>
          <button
            className={styles.actionBtn}
            onClick={handleSync}
            disabled={syncing || isSyncing}
            title="Sync from Server"
          >
            {syncing || isSyncing ? (
              <span className={styles.spinner} />
            ) : (
              <RefreshCw size={14} />
            )}
          </button>
          <div className={styles.saveAllWrapper}>
            <button
              className={`${styles.actionBtn} ${!hasDirtyItems ? styles.disabled : ''}`}
              onClick={handleSaveAll}
              disabled={!hasDirtyItems || saving || isSaving}
              title="Save All"
            >
              {saving || isSaving ? (
                <span className={styles.spinner} />
              ) : (
                <Save size={14} />
              )}
            </button>
            {hasDirtyItems && !saving && !isSaving && (
              <span className={styles.dirtyIndicator} title="Unsaved changes" />
            )}
          </div>
          <button
            className={styles.actionBtn}
            onClick={handleAddService}
            title="Add MCP Service"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className={styles.list}>
        {services.map(service => (
          <MCPTreeItem key={service.id} service={service} />
        ))}
      </div>
    </div>
  );
}
