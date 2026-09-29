import * as React from 'react';
import { cn } from '../../lib/utils';

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input data-slot="input" type={type} className={cn('w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground', className)} {...props} />;
}