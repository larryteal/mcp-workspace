import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { SubTabs } from '@/components/common';
import { KeyValueTable } from './KeyValueTable';
import type { ApiResponse, KeyValueItem } from '@/types';
import styles from './ResponseViewer.module.css';

interface ResponseViewerProps {
  response: ApiResponse | null;
  loading?: boolean;
}

const responseTabs = [
  { id: 'body', label: 'Body' },
  { id: 'headers', label: 'Headers' },
  { id: 'cookies', label: 'Cookies' },
];

type FormatType = 'pretty' | 'raw' | 'preview';

export function ResponseViewer({ response, loading }: ResponseViewerProps) {
  const [activeTab, setActiveTab] = useState('body');
  const [format, setFormat] = useState<FormatType>('pretty');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (response?.body) {
      await navigator.clipboard.writeText(response.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <span>Sending request...</span>
      </div>
    );
  }

  if (!response) {
    return (
      <div className={styles.placeholder}>
        <p>Click "Test" to send a request and see the response here.</p>
      </div>
    );
  }

  const headersAsItems: KeyValueItem[] = Object.entries(response.headers).map(
    ([key, value], index) => ({
      id: String(index),
      enabled: true,
      key,
      value,
    })
  );

  const formatCode = (code: string) => {
    try {
      const parsed = JSON.parse(code);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return code;
    }
  };

  const renderCodeWithLineNumbers = (code: string) => {
    const lines = code.split('\n');
    return (
      <div className={styles.codeLines}>
        {lines.map((line, i) => (
          <div key={i} className={styles.codeLine}>
            <span className={styles.lineNumber}>{i + 1}</span>
            <span className={styles.lineContent}>{line}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      {/* Response tabs */}
      <SubTabs
        tabs={responseTabs}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {/* Content */}
      <div className={styles.content}>
        {activeTab === 'body' && (
          <div className={styles.bodyContent}>
            {/* Format selector row */}
            <div className={styles.formatRow}>
              <div className={styles.formatTabs}>
                <button
                  className={`${styles.formatBtn} ${format === 'pretty' ? styles.active : ''}`}
                  onClick={() => setFormat('pretty')}
                >
                  Pretty
                </button>
                <button
                  className={`${styles.formatBtn} ${format === 'raw' ? styles.active : ''}`}
                  onClick={() => setFormat('raw')}
                >
                  Raw
                </button>
                <button
                  className={`${styles.formatBtn} ${format === 'preview' ? styles.active : ''}`}
                  onClick={() => setFormat('preview')}
                >
                  Preview
                </button>
              </div>
              <button className={styles.copyBtn} onClick={handleCopy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Response body */}
            <div className={styles.responseBody}>
              {format === 'pretty' && renderCodeWithLineNumbers(formatCode(response.body))}
              {format === 'raw' && (
                <pre className={styles.rawContent}>{response.body}</pre>
              )}
              {format === 'preview' && (
                <div className={styles.previewContent}>
                  {response.body}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'headers' && (
          <div className={styles.headersContent}>
            {headersAsItems.length > 0 ? (
              <KeyValueTable
                items={headersAsItems}
                onChange={() => {}}
                showDescription={false}
                readOnly
              />
            ) : (
              <p className={styles.empty}>No headers in response.</p>
            )}
          </div>
        )}

        {activeTab === 'cookies' && (
          <div className={styles.cookiesContent}>
            {response.cookies.length > 0 ? (
              <KeyValueTable
                items={response.cookies}
                onChange={() => {}}
                showDescription={false}
                readOnly
              />
            ) : (
              <p className={styles.empty}>No cookies in response.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
