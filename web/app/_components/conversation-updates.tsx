import type { ReactNode } from 'react';
import type { Ticket } from '../data';
import { ChatBubble } from './chat-bubble';

export function ConversationUpdates({
  history,
  agent = false,
  automatic = false,
  reply,
}: {
  history: Ticket['history'];
  agent?: boolean;
  automatic?: boolean;
  reply: ReactNode;
}) {
  const approvalPrefix = /^Human approved in-app reply and set (?:low|normal|high) priority: /;
  const latestApproval = history.findLast((event) => approvalPrefix.test(event.description));
  const automaticReply = history.find((event) => event.description.startsWith('Automatic in-app reply: '));
  const currentReply = agent && reply ? (
    <ChatBubble
      from="agent"
      own
      label={!latestApproval && (automaticReply || automatic)
        ? 'Automatic reply · no review needed'
        : 'Approved reply'}
    >
      {reply}
    </ChatBubble>
  ) : reply;
  return (
    <>
      {!latestApproval && !automaticReply && currentReply}
      {history.map((event) => {
        if (event.description.startsWith('Automatic in-app reply: ')) {
          return latestApproval ? (
            <ChatBubble key={event.id} from="tunely" label={agent ? 'Automatic reply · no review needed' : 'Tunely'}>
              {event.description.slice('Automatic in-app reply: '.length)}
            </ChatBubble>
          ) : (
            <div key={event.id} className="conversation-current-reply">{currentReply}</div>
          );
        }
        if (event.description.startsWith('Customer replied: ')) {
          return (
            <ChatBubble key={event.id} from="customer" own={!agent} aria-label={agent ? 'Customer message' : 'Your message'}>
              {event.description.slice('Customer replied: '.length)}
            </ChatBubble>
          );
        }
        if (event.description.startsWith('Team asked for details: ')) {
          return (
            <ChatBubble key={event.id} from="agent" own={agent} label="Tunely team" aria-label="Team question">
              {event.description.slice('Team asked for details: '.length)}
            </ChatBubble>
          );
        }
        if (approvalPrefix.test(event.description)) {
          return event.id === latestApproval?.id ? (
            <div key={event.id} className="conversation-current-reply">{currentReply}</div>
          ) : (
            <ChatBubble key={event.id} from="agent" own={agent} label={agent ? 'Approved reply' : 'Tunely team'}>
              {event.description.replace(approvalPrefix, '')}
            </ChatBubble>
          );
        }
        return null;
      })}
    </>
  );
}