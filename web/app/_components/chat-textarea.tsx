'use client';

import type { ComponentProps } from 'react';
import { Textarea } from '../../components/ui/textarea';

export function ChatTextarea(props: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      {...props}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (
          event.defaultPrevented ||
          event.key !== 'Enter' ||
          event.shiftKey ||
          event.nativeEvent.isComposing
        ) {
          return;
        }
        event.preventDefault();
        // Mirror implicit submission: do nothing while the send button is disabled.
        const button =
          event.currentTarget.form?.querySelector<HTMLButtonElement>(
            'button[type="submit"]',
          );
        if (button && !button.disabled) button.form?.requestSubmit(button);
      }}
    />
  );
}
