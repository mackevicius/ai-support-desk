import * as React from 'react';
import { cn } from '../../lib/utils';

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn('w-full resize-y rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground', className)} {...props} />;
}