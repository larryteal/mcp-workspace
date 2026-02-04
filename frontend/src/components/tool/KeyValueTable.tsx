import React from 'react';
import { Checkbox } from 'antd';
import { Plus, Trash2 } from 'lucide-react';
import type { KeyValueItem } from '@/types';
import styles from './KeyValueTable.module.css';

interface KeyValueTableProps {
  items: KeyValueItem[];
  onChange: (items: KeyValueItem[]) => void;
  showDescription?: boolean;
  readOnly?: boolean;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

export function KeyValueTable({
  items,
  onChange,
  showDescription = true,
  readOnly = false,
}: KeyValueTableProps) {
  const handleAdd = () => {
    onChange([
      ...items,
      { id: generateId(), enabled: true, key: '', value: '', description: '' },
    ]);
  };

  const handleRemove = (id: string) => {
    onChange(items.filter(item => item.id !== id));
  };

  const handleChange = (id: string, field: keyof KeyValueItem, value: string | boolean) => {
    onChange(
      items.map(item =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  return (
    <div className={styles.container}>
      <table className={styles.table}>
        <thead>
          <tr className={styles.headerRow}>
            <th className={styles.checkboxCol}></th>
            <th className={styles.keyCol}>Key</th>
            <th className={styles.valueCol}>Value</th>
            {showDescription && <th className={styles.descCol}>Description</th>}
            {!readOnly && <th className={styles.actionCol}></th>}
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} className={styles.row}>
              <td className={styles.checkboxCol}>
                <Checkbox
                  checked={item.enabled}
                  onChange={e => handleChange(item.id, 'enabled', e.target.checked)}
                />
              </td>
              <td className={styles.keyCol}>
                <input
                  type="text"
                  className={styles.input}
                  value={item.key}
                  onChange={e => handleChange(item.id, 'key', e.target.value)}
                  placeholder="foo"
                />
              </td>
              <td className={styles.valueCol}>
                <input
                  type="text"
                  className={styles.input}
                  value={item.value}
                  onChange={e => handleChange(item.id, 'value', e.target.value)}
                  placeholder="bar | {{bar}}"
                />
              </td>
              {showDescription && (
                <td className={styles.descCol}>
                  <input
                    type="text"
                    className={styles.input}
                    value={item.description || ''}
                    onChange={e => handleChange(item.id, 'description', e.target.value)}
                    placeholder="Description"
                  />
                </td>
              )}
              {!readOnly && (
                <td className={styles.actionCol}>
                  <button
                    className={styles.removeBtn}
                    onClick={() => handleRemove(item.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <button className={styles.addBtn} onClick={handleAdd}>
          <Plus size={14} />
          <span>Add Row</span>
        </button>
      )}
    </div>
  );
}
