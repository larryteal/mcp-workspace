import React from 'react';
import { Card } from '@/components/common';
import { ResponseViewer } from './ResponseViewer';
import type { ApiResponse } from '@/types';
import styles from './ResponseCard.module.css';

interface ResponseCardProps {
  response: ApiResponse | null;
  loading?: boolean;
}

export function ResponseCard({ response, loading }: ResponseCardProps) {
  const getStatusClass = () => {
    if (!response) return '';
    if (response.status === 0) return styles.error; // Network error
    if (response.status >= 200 && response.status < 300) return styles.success;
    if (response.status >= 400) return styles.error;
    return styles.warning;
  };

  const headerRight = response ? (
    <div className={styles.statusBar}>
      <span className={`${styles.status} ${getStatusClass()}`}>
        {response.status} {response.statusText}
      </span>
      <span className={styles.stat}>Time <span className={styles.statValue}>{response.time} ms</span></span>
      <span className={styles.stat}>Size <span className={styles.statValue}>{response.size}</span></span>
    </div>
  ) : null;

  return (
    <Card title="Response" headerRight={headerRight}>
      <ResponseViewer response={response} loading={loading} />
    </Card>
  );
}
