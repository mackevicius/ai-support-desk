import type { ReactNode } from 'react';
import type { Ticket } from '../data';
import { ChatBubble } from './chat-bubble';

export function ConversationUpdates({
  history,
  agent = false,
  reply,
}: {
  history: Ticket['history'];
  agent?: boolean;
  reply: ReactNode;
}) {
  const automaticReply = history.find((event) =>
    event.description.startsWith('Automatic in-app reply: '),
  );
  const currentReply =
    agent && reply ? (
      <ChatBubble from="agent" own label="Automatic reply · no review needed">
        {reply}
      </ChatBubble>
    ) : (
      reply
    );
  return (
    <>
      {!automaticReply && currentReply}
      {history.map((event) => {
        if (event.description.startsWith('Automatic in-app reply: ')) {
          return (
            <div key={event.id} className="conversation-current-reply">
              {currentReply}
            </div>
          );
        }
        if (event.description.startsWith('Customer replied: ')) {
          return (
            <ChatBubble
              key={event.id}
              from="customer"
              own={!agent}
              aria-label={agent ? 'Customer message' : 'Your message'}
            >
              {event.description.slice('Customer replied: '.length)}
            </ChatBubble>
          );
        }
        if (event.description.startsWith('Agent replied: ')) {
          return (
            <ChatBubble
              key={event.id}
              from="agent"
              own={agent}
              label="Tunely team"
              aria-label="Agent reply"
            >
              {event.description.slice('Agent replied: '.length)}
            </ChatBubble>
          );
        }
        return null;
      })}
    </>
  );
}
