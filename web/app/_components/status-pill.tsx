import type { ComponentProps } from 'react';
import { cn } from 'cn';
import { Badge } from '../../components/ui/badge';

const tones = {
  ok: 'bg-ok text-ok-foreground',
  team: 'bg-team text-team-foreground',
  alert: 'bg-alert text-alert-foreground',
  neutral: 'bg-secondary text-secondary-foreground',
};

export function StatusPill({
  tone,
  className,
  ...props
}: ComponentProps<'span'> & { tone: keyof typeof tones }) {
  return (
    <Badge
      data-tone={tone}
      className={cn('font-bold', tones[tone], className)}
      {...props}
    />
  );
}

export function ticketTone(status: string) {
  return status === 'resolved' ? 'ok' : status === 'open' ? 'team' : 'neutral';
}

export function priorityTone(priority: string) {
  return priority === 'high' ? 'alert' : 'neutral';
}
