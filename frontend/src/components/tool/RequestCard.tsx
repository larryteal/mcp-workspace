import React, { useState, useEffect, useRef } from 'react';
import { Card, Input, TextArea, SubTabs, Select } from '@/components/common';
import { KeyValueTable } from './KeyValueTable';
import { BodyEditor } from './BodyEditor';
import type { Tool, HttpMethod, BodyType, KeyValueItem } from '@/types';
import styles from './RequestCard.module.css';

interface RequestCardProps {
  tool: Tool;
  onUpdate: (updates: Partial<Tool>) => void;
}

const requestTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'params', label: 'Query Params' },
  { id: 'headers', label: 'Headers' },
  { id: 'body', label: 'Body' },
  { id: 'cookies', label: 'Cookies' },
];

const methodOptions = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
  { value: 'PUT', label: 'PUT' },
  { value: 'DELETE', label: 'DELETE' },
  { value: 'PATCH', label: 'PATCH' },
];

// Store tab state per tool across component renders
const tabStateMap = new Map<string, string>();

export function RequestCard({ tool, onUpdate }: RequestCardProps) {
  // Get saved tab state for this tool, or default to 'overview'
  const [activeTab, setActiveTab] = useState(() => tabStateMap.get(tool.id) || 'overview');
  const prevToolIdRef = useRef(tool.id);

  // Handle tool switching
  useEffect(() => {
    if (prevToolIdRef.current !== tool.id) {
      // Switching to a different tool, restore its saved state or default to 'overview'
      setActiveTab(tabStateMap.get(tool.id) || 'overview');
      prevToolIdRef.current = tool.id;
    }
  }, [tool.id]);

  // Save tab state when it changes
  useEffect(() => {
    tabStateMap.set(tool.id, activeTab);
  }, [tool.id, activeTab]);

  return (
    <Card title="Request">
      <div className={styles.urlBar}>
        <Select
          value={tool.method}
          options={methodOptions}
          onChange={(value) => onUpdate({ method: value as HttpMethod })}
          variant="primary"
        />
        <input
          type="text"
          className={styles.urlInput}
          value={tool.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="Enter request URL..."
        />
      </div>

      <SubTabs
        tabs={requestTabs}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      <div className={styles.tabContent}>
        {activeTab === 'overview' && (
          <div className={styles.overview}>
            <Input
              label="Tool Name"
              value={tool.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              placeholder="myToolName"
              className={styles.monoInput}
            />
            <TextArea
              label="Description"
              value={tool.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              placeholder="Describe what this tool does..."
              rows={3}
            />
            <TextArea
              label="Input Schema"
              value={tool.inputSchema ?? ''}
              onChange={(e) => onUpdate({ inputSchema: e.target.value })}
              placeholder={[
                '{',
                '  "$schema": "https://json-schema.org/draft/2020-12/schema",',
                '  "type": "object",',
                '  "properties": {',
                '    "bar": {',
                '      "type": "string",',
                '      "description": "referenced as {{bar}}"',
                '    }',
                '  },',
                '  "required": ["bar"]',
                '}',
              ].join('\n')}
              rows={12}
              className={styles.monoInput}
            />
            <TextArea
              label="Output Schema"
              value={tool.outputSchema ?? ''}
              onChange={(e) => onUpdate({ outputSchema: e.target.value })}
              placeholder={[
                '{',
                '  "$schema": "https://json-schema.org/draft/2020-12/schema",',
                '  "type": "object",',
                '  "properties": {',
                '    "result": {',
                '      "type": "string"',
                '    }',
                '  },',
                '  "required": ["result"]',
                '}',
              ].join('\n')}
              rows={12}
              className={styles.monoInput}
            />
          </div>
        )}

        {activeTab === 'params' && (
          <KeyValueTable
            items={tool.params}
            onChange={(params) => onUpdate({ params })}
          />
        )}

        {activeTab === 'headers' && (
          <KeyValueTable
            items={tool.headers}
            onChange={(headers) => onUpdate({ headers })}
          />
        )}

        {activeTab === 'body' && (
          <BodyEditor
            tool={tool}
            onBodyTypeChange={(bodyType: BodyType) => onUpdate({ bodyType })}
            onBodyContentChange={(bodyContent: string) => onUpdate({ bodyContent })}
            onBodyFormDataChange={(bodyFormData: KeyValueItem[]) => onUpdate({ bodyFormData })}
            onBodyUrlEncodedChange={(bodyUrlEncoded: KeyValueItem[]) => onUpdate({ bodyUrlEncoded })}
          />
        )}

        {activeTab === 'cookies' && (
          <KeyValueTable
            items={tool.cookies}
            onChange={(cookies) => onUpdate({ cookies })}
          />
        )}
      </div>
    </Card>
  );
}
