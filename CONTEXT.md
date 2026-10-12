# AI Support Desk

An AI-assisted service desk for Tunely, a fictional company. Project work is tracked in GitHub Issues; a support ticket is a request handled by the application.

## Language

**Tunely**:
The fictional company whose service desk this is. It runs a consumer music streaming app with paid plans, family sharing, and offline downloads.
_Avoid_: Dayline (former name), the company, the product (when the name will do)

**Knowledge base**:
All company documents the AI may draw on when drafting an answer. Each document is either a help article or an internal note.
_Avoid_: Articles (for the whole set), docs

**Help article**:
A document written for customers and safe to quote to them. Only support agents write help articles.

**Internal note**:
A document for Tunely staff only, such as a known bug, a policy, or a release note. It may inform an answer draft but must not be quoted to the customer.
_Avoid_: Private article

**Support ticket**:
A customer's request for help, tracked from submission through resolution. Customers see a support ticket as a "conversation".
_Avoid_: Ticket (when it could mean a GitHub issue)

**Customer**:
A person using Tunely's app who submits a support ticket.

**Support agent**:
A Tunely staff member who works handed-off support tickets: editing answer drafts, asking the customer for details, filling knowledge gaps, and delivering approved replies.
_Avoid_: Operator, admin

**Visitor**:
A member of the public exploring the demo. A visitor plays both the customer and the support agent, in a private copy of the demo.
_Avoid_: Guest, user

**Owner**:
The author of the demo, who alone can change internal notes and run live evaluations.
_Avoid_: Admin

**Answer draft**:
An AI-suggested response to a support ticket, with references to the knowledge base documents it relied on. It has not been approved for delivery.

**Approved reply**:
An answer draft reviewed and accepted by a support agent for delivery to the customer.

**Automatic reply**:
An answer draft delivered to the customer without review, because a help article clearly covers the question and the ticket is not risky.
_Avoid_: Auto-resolve, bot reply

**Hand-off**:
Routing a support ticket to a support agent instead of replying automatically. Either the AI decides to (because it is unsure, the answer depends on an internal note, or the ticket is risky), or the customer asks for a person after an automatic reply.
_Avoid_: Escalation

**Risky ticket**:
A support ticket where something has gone wrong with the customer's money or account security, such as a refund, a double charge, a hacked or locked account, or fraud. Tunely never lets the AI answer one alone. A how-to question about billing or security (cancelling a plan, updating a card, changing a password) is not risky.

**Knowledge gap**:
A question that no document in the knowledge base covers. A support agent fills it by writing a new help article.
