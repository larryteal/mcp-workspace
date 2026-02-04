import React from 'react';
import { Card, Input, TextArea } from '@/components/common';
import { ConfigCodeBlock } from './ConfigCodeBlock';
import { useMCP } from '@/context/MCPContext';
import { useDirty } from '@/context/DirtyContext';
import type { MCPService } from '@/types';
import styles from './MCPOverview.module.css';

interface MCPOverviewProps {
  service: MCPService;
}

export function MCPOverview({ service }: MCPOverviewProps) {
  const { updateService } = useMCP();
  const { isOverviewDirty } = useDirty();

  const isDirty = isOverviewDirty(service.id);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateService(service.id, { name: e.target.value });
  };

  const handleVersionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateService(service.id, { version: e.target.value });
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateService(service.id, { description: e.target.value });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>
            Overview
            {isDirty && <span className={styles.dirtyIndicator} title="Unsaved changes" />}
          </h1>
          <p className={styles.subtitle}>Configure your MCP service metadata and settings</p>
        </div>
      </div>

      <div className={styles.content}>
        <Card title="Basic Information">
          <div className={styles.form}>
            <div className={styles.formRow}>
              <Input
                label="Name"
                value={service.name}
                onChange={handleNameChange}
                placeholder="Enter MCP service name"
              />
              <Input
                label="Version"
                value={service.version}
                onChange={handleVersionChange}
                placeholder="1.0.0"
              />
            </div>
            <TextArea
              label="Description"
              value={service.description}
              onChange={handleDescriptionChange}
              placeholder="Describe what this MCP service does..."
              rows={3}
            />
          </div>
        </Card>

        <Card title="MCP Configuration">
          <ConfigCodeBlock service={service} />
        </Card>
      </div>
    </div>
  );
}
