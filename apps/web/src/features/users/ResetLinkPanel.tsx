import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ICON_STROKE } from '@/lib/utils';

/**
 * Shows a one-time password link for the Owner to pass on. The link lets its holder set the
 * account's password, so it is shown once and never stored.
 */
export function ResetLinkPanel({ link, name }: { link: string; name: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-[10px]">
      <p className="text-[14.5px] leading-[1.5] text-neutral-800">
        Send this link to <b>{name}</b> only. They open it once to choose their own password. Anyone
        who has the link can set the password, so don&apos;t post it in a group chat.
      </p>
      <div className="max-h-[120px] overflow-auto rounded-[20px] border border-divider bg-bg p-[12px] font-mono text-[12.5px] break-all select-all">
        {link}
      </div>
      <Button variant="secondary" className="min-h-[46px]" onClick={copy}>
        {copied ? (
          <Check size={16} strokeWidth={ICON_STROKE} aria-hidden />
        ) : (
          <Copy size={16} strokeWidth={ICON_STROKE} aria-hidden />
        )}
        {copied ? 'Copied' : 'Copy link'}
      </Button>
    </div>
  );
}
