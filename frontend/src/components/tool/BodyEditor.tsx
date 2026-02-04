import React from 'react';
import { Upload } from 'lucide-react';
import { KeyValueTable } from './KeyValueTable';
import type { Tool, BodyType, KeyValueItem } from '@/types';
import styles from './BodyEditor.module.css';

interface BodyEditorProps {
  tool: Tool;
  onBodyTypeChange: (type: BodyType) => void;
  onBodyContentChange: (content: string) => void;
  onBodyFormDataChange: (formData: KeyValueItem[]) => void;
  onBodyUrlEncodedChange: (urlEncoded: KeyValueItem[]) => void;
}

const bodyTypeOptions: { value: BodyType; label: string; disabled?: boolean }[] = [
  { value: 'none', label: 'none' },
  { value: 'form-data', label: 'form-data', disabled: true },
  { value: 'x-www-form-urlencoded', label: 'x-www-form-urlencoded' },
  { value: 'raw-json', label: 'JSON' },
  { value: 'binary', label: 'binary', disabled: true },
];

export function BodyEditor({
  tool,
  onBodyTypeChange,
  onBodyContentChange,
  onBodyFormDataChange,
  onBodyUrlEncodedChange,
}: BodyEditorProps) {
  return (
    <div className={styles.container}>
      {/* Radio button row */}
      <div className={styles.typeRow}>
        {bodyTypeOptions.map(option => (
          <label
            key={option.value}
            className={`${styles.radioOption} ${tool.bodyType === option.value ? styles.selected : ''} ${option.disabled ? styles.disabled : ''}`}
          >
            <span className={styles.radio}>
              {tool.bodyType === option.value && <span className={styles.radioDot} />}
            </span>
            <input
              type="radio"
              name="bodyType"
              value={option.value}
              checked={tool.bodyType === option.value}
              onChange={() => !option.disabled && onBodyTypeChange(option.value)}
              disabled={option.disabled}
              className={styles.radioInput}
            />
            <span className={styles.radioLabel}>{option.label}</span>
          </label>
        ))}
      </div>

      {/* Content area */}
      <div className={styles.content}>
        {tool.bodyType === 'none' && (
          <div className={styles.emptyMessage}>
            This request does not have a body
          </div>
        )}

        {tool.bodyType === 'raw-json' && (
          <div className={styles.codeEditor}>
            <textarea
              className={styles.textarea}
              value={tool.bodyContent}
              onChange={(e) => onBodyContentChange(e.target.value)}
              placeholder={[
                '{',
                '  "foo": "bar",',
                '  "key": "{{value}}"',
                '}',
              ].join('\n')}
              spellCheck={false}
            />
          </div>
        )}

        {tool.bodyType === 'form-data' && (
          <KeyValueTable
            items={tool.bodyFormData}
            onChange={onBodyFormDataChange}
          />
        )}

        {tool.bodyType === 'x-www-form-urlencoded' && (
          <KeyValueTable
            items={tool.bodyUrlEncoded}
            onChange={onBodyUrlEncodedChange}
          />
        )}

        {tool.bodyType === 'binary' && (
          <label htmlFor="binary-file" className={styles.dropZone}>
            <input type="file" id="binary-file" className={styles.fileInput} />
            <Upload size={32} className={styles.uploadIcon} />
            <span className={styles.dropText}>Click to select a file or drag and drop</span>
            <span className={styles.dropHint}>Select any file type</span>
          </label>
        )}
      </div>
    </div>
  );
}
