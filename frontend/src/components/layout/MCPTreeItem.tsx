import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Info, Zap, FilePlus, Trash2 } from 'lucide-react';
import { useMCP } from '@/context/MCPContext';
import { useTabs } from '@/context/TabContext';
import { useDirty } from '@/context/DirtyContext';
import type { MCPService, Tool } from '@/types';
import { confirmDialog } from '@/components/common';
import styles from './MCPTreeItem.module.css';

interface MCPTreeItemProps {
  service: MCPService;
}

export function MCPTreeItem({ service }: MCPTreeItemProps) {
  const {
    selectedMcpId,
    selectedToolId,
    setSelectedMcpId,
    setSelectedToolId,
    toggleServiceExpanded,
    addTool,
    deleteService,
    deleteTool
  } = useMCP();
  const { openTab, closeTab, closeTabsByMcpId, findTab } = useTabs();
  const { isServiceDirty, isOverviewDirty, isToolDirty } = useDirty();
  const [isHovered, setIsHovered] = useState(false);
  const [hoveredToolId, setHoveredToolId] = useState<string | null>(null);

  // Check if Overview is selected (mcpId matches and no tool selected)
  const isOverviewSelected = selectedMcpId === service.id && !selectedToolId;

  // Check dirty states
  const serviceDirty = isServiceDirty(service.id);
  const overviewDirty = isOverviewDirty(service.id);

  const handleHeaderClick = () => {
    toggleServiceExpanded(service.id);
  };

  const handleOverviewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedMcpId(service.id);
    setSelectedToolId(null);
    openTab({
      type: 'overview',
      mcpId: service.id,
      title: 'Overview',
    });
  };

  const handleToolClick = (e: React.MouseEvent, tool: Tool) => {
    e.stopPropagation();
    setSelectedMcpId(service.id);
    setSelectedToolId(tool.id);
    openTab({
      type: 'tool',
      mcpId: service.id,
      toolId: tool.id,
      title: tool.name,
    });
  };

  const handleAddTool = (e: React.MouseEvent) => {
    e.stopPropagation();
    const toolId = addTool(service.id);
    setSelectedMcpId(service.id);
    setSelectedToolId(toolId);
    openTab({
      type: 'tool',
      mcpId: service.id,
      toolId,
      title: 'newTool',
    });
  };

  const handleDeleteService = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirmDialog({
      title: 'Delete MCP Service',
      message: `Delete "${service.name}"? This cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (confirmed) {
      closeTabsByMcpId(service.id);
      deleteService(service.id);
    }
  };

  const handleDeleteTool = async (e: React.MouseEvent, tool: Tool) => {
    e.stopPropagation();
    const confirmed = await confirmDialog({
      title: 'Delete Tool',
      message: `Delete "${tool.name}"? This cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (confirmed) {
      // Close the tool's tab first so we don't leave an orphaned tab pointing at
      // a now-deleted tool (service deletion already does this via closeTabsByMcpId).
      const tab = findTab(service.id, tool.id);
      if (tab) closeTab(tab.id);
      deleteTool(service.id, tool.id);
    }
  };

  return (
    <div
      className={`${styles.item} ${service.expanded ? styles.expanded : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* MCP Header */}
      <div className={styles.mcpHeader} onClick={handleHeaderClick}>
        <div className={styles.mcpInfo}>
          {service.expanded ? (
            <ChevronDown size={16} className={styles.chevron} />
          ) : (
            <ChevronRight size={16} className={styles.chevron} />
          )}
          {service.expanded ? (
            <FolderOpen size={16} className={styles.folderIcon} />
          ) : (
            <Folder size={16} className={styles.folderIcon} />
          )}
          <span className={styles.mcpName}>{service.name}</span>
          {serviceDirty && <span className={styles.dirtyIndicator} title="Unsaved changes" />}
        </div>
        <div className={`${styles.mcpActions} ${isHovered ? styles.visible : ''}`}>
          <button className={styles.actionBtn} onClick={handleAddTool} title="Add Tool">
            <FilePlus size={14} />
          </button>
          <button className={styles.actionBtn} onClick={handleDeleteService} title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Sub Items (when expanded) */}
      {service.expanded && (
        <div className={styles.subItems}>
          {/* Overview Item */}
          <div
            className={`${styles.subItem} ${isOverviewSelected ? styles.selected : ''}`}
            onClick={handleOverviewClick}
          >
            <div className={styles.subItemContent}>
              <Info size={14} className={styles.subItemIcon} />
              <span className={styles.subItemText}>Overview</span>
              {overviewDirty && <span className={styles.dirtyIndicator} title="Unsaved changes" />}
            </div>
          </div>

          {/* Tool Items */}
          {service.tools.map(tool => {
            const isToolSelected = selectedMcpId === service.id && selectedToolId === tool.id;
            const toolDirty = isToolDirty(service.id, tool.id);
            return (
              <div
                key={tool.id}
                className={`${styles.subItem} ${isToolSelected ? styles.selected : ''}`}
                onClick={(e) => handleToolClick(e, tool)}
                onMouseEnter={() => setHoveredToolId(tool.id)}
                onMouseLeave={() => setHoveredToolId(null)}
              >
                <div className={styles.subItemContent}>
                  <Zap size={14} className={styles.subItemIcon} />
                  <span className={styles.toolName}>{tool.name}</span>
                  {toolDirty && <span className={styles.dirtyIndicator} title="Unsaved changes" />}
                </div>
                <div className={`${styles.subItemActions} ${hoveredToolId === tool.id ? styles.visible : ''}`}>
                  <button
                    className={styles.actionBtn}
                    onClick={(e) => handleDeleteTool(e, tool)}
                    title="Delete Tool"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
