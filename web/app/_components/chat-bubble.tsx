import type { ComponentProps } from 'react';
import { cn } from 'cn';

const bubbleStyles = {
  own: 'ml-auto rounded-[18px] rounded-br-md bg-primary px-3.5 py-2.5 text-primary-foreground',
  customer:
    'mr-auto rounded-[18px] rounded-bl-md border border-bubble-border bg-bubble px-3.5 py-2.5 text-bubble-foreground',
  tunely:
    'mr-auto rounded-[18px] rounded-bl-md bg-bubble px-3.5 py-2.5 text-bubble-foreground',
  system: 'mx-auto p-1 text-center text-sm text-muted-foreground',
};

export function ChatBubble({
  from,
  own = false,
  label,
  className,
  children,
  ...props
}: ComponentProps<'article'> & {
  from: 'customer' | 'tunely' | 'system' | 'agent';
  own?: boolean;
  label?: string;
}) {
  const look = own ? 'own' : from === 'agent' ? 'tunely' : from;
  return (
    <article
      data-from={from}
      className={cn(
        'mb-3 w-fit max-w-[82%] text-[15px] whitespace-pre-wrap wrap-break-word',
        bubbleStyles[look],
        className,
      )}
      {...props}
    >
      {label && <span className="block text-xs font-extrabold">{label}</span>}
      <div>{children}</div>
    </article>
  );
}
