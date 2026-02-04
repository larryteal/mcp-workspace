import React, { useState, useMemo } from 'react';
import { Check, Terminal, Link, FileJson } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { md5 } from '@/utils/md5';
import type { MCPService } from '@/types';
import styles from './ConfigCodeBlock.module.css';

interface ConfigCodeBlockProps {
  service: MCPService;
}

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}

type CopyType = 'json' | 'claude-code' | 'url';

export function ConfigCodeBlock({ service }: ConfigCodeBlockProps) {
  const { workspaceId } = useWorkspace();
  const [copiedType, setCopiedType] = useState<CopyType | null>(null);

  // Use MD5 hash of workspaceId in MCP URL for security (prevents inferring edit URL from MCP URL)
  const workspaceHash = useMemo(() => md5(workspaceId), [workspaceId]);

  const displayName = slugify(service.name);
  // Use backend URL from env, fallback to same origin if not configured
  const mcpBaseUrl = import.meta.env.VITE_MCP_API_BASE_URL || window.location.origin;
  const mcpUrl = `${mcpBaseUrl}/workspace/${workspaceHash}/mcp/${service.id}`;

  const config = {
    mcpServers: {
      [displayName]: {
        type: 'http',
        url: mcpUrl,
      },
    },
  };

  const jsonConfig = JSON.stringify(config, null, 2);
  const claudeCodeCommand = `claude mcp add --transport http ${displayName} ${mcpUrl}`;

  const handleCopy = async (type: CopyType) => {
    let textToCopy = '';
    switch (type) {
      case 'json':
        textToCopy = jsonConfig;
        break;
      case 'claude-code':
        textToCopy = claudeCodeCommand;
        break;
      case 'url':
        textToCopy = mcpUrl;
        break;
    }
    await navigator.clipboard.writeText(textToCopy);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const lines = jsonConfig.split('\n');

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.language}>JSON</span>
        <div className={styles.copyButtons}>
          <button
            className={styles.copyBtn}
            onClick={() => handleCopy('json')}
            title="Copy JSON config"
          >
            {copiedType === 'json' ? (
              <>
                <Check size={14} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <FileJson size={14} />
                <span>JSON</span>
              </>
            )}
          </button>
          <button
            className={styles.copyBtn}
            onClick={() => handleCopy('claude-code')}
            title="Copy Claude Code command"
          >
            {copiedType === 'claude-code' ? (
              <>
                <Check size={14} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Terminal size={14} />
                <span>Claude Code</span>
              </>
            )}
          </button>
          <button
            className={styles.copyBtn}
            onClick={() => handleCopy('url')}
            title="Copy URL only"
          >
            {copiedType === 'url' ? (
              <>
                <Check size={14} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Link size={14} />
                <span>URL</span>
              </>
            )}
          </button>
        </div>
      </div>
      <div className={styles.codeWrapper} style={{ maxHeight: 300, overflow: 'auto' }}>
        <pre className={styles.code}>
          <div className={styles.lineNumbers}>
            {lines.map((_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
          <code className={styles.content}>{jsonConfig}</code>
        </pre>
      </div>
    </div>
  );
}
