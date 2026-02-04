import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import styles from './CodeBlock.module.css';

interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  maxHeight?: number;
}

export function CodeBlock({
  code,
  language = 'json',
  showLineNumbers = true,
  maxHeight,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const lines = code.split('\n');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.language}>{language}</span>
        <button className={styles.copyBtn} onClick={handleCopy}>
          {copied ? (
            <>
              <Check size={14} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={14} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div
        className={styles.codeWrapper}
        style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}
      >
        <pre className={styles.code}>
          {showLineNumbers && (
            <div className={styles.lineNumbers}>
              {lines.map((_, i) => (
                <span key={i}>{i + 1}</span>
              ))}
            </div>
          )}
          <code className={styles.content}>{code}</code>
        </pre>
      </div>
    </div>
  );
}
