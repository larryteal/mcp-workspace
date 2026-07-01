/**
 * Copy text to the clipboard without ever throwing.
 * Uses the async Clipboard API when available (requires a secure context), and
 * falls back to a hidden-textarea `execCommand('copy')` for insecure contexts
 * (plain http / non-localhost) or when permission is denied.
 *
 * @returns true if the copy succeeded, false otherwise (caller decides whether to
 * show a "Copied" state).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
