import React, { useState, useMemo } from 'react';
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

// Above this many lines, the per-line (line-numbered) renderer would create
// hundreds of thousands of DOM nodes and freeze the tab — fall back to plain text.
const PRETTY_LINE_LIMIT = 5000;

function formatCode(code: string): string {
  try {
    return JSON.stringify(JSON.parse(code), null, 2);
  } catch {
    return code;
  }
}

export function ResponseViewer({ response, loading }: ResponseViewerProps) {
  const [activeTab, setActiveTab] = useState('body');
  const [format, setFormat] = useState<FormatType>('pretty');
  const [copied, setCopied] = useState(false);

  // Format once per body (not per render) — JSON.parse+stringify on a multi-MB
  // body is expensive.
  const prettyBody = useMemo(() => (response ? formatCode(response.body) : ''), [response]);

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

  const renderCodeWithLineNumbers = (code: string) => {
    const lines = code.split('\n');
    if (lines.length > PRETTY_LINE_LIMIT) {
      // Too large for per-line DOM rendering — show as plain text to keep the UI
      // responsive. Raw/Copy still give the full body.
      return (
        <>
          <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: '4px 0' }}>
            Large response ({lines.length.toLocaleString()} lines) — line numbers disabled; use Raw or Copy for the full body.
          </div>
          <pre className={styles.rawContent}>{code}</pre>
        </>
      );
    }
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
              {format === 'pretty' && renderCodeWithLineNumbers(prettyBody)}
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
