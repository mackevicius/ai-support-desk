# AI Support Desk

## Problem Statement

I want a deployable portfolio product that demonstrates full-stack ownership and practical AI engineering with Next.js, Node.js, and Python. A visitor should understand it within a minute and try the AI on their own question, without creating an open-ended AI bill. The repository should show what works, what fails, and how the system is tested and operated.

## Solution

Build the service desk of Tunely, a fictional music streaming company. Visitors land on Tunely's homepage, where it is obvious what Tunely is and what problems a customer might have. Each visitor gets a private copy of the demo and switches between two seats: customer and support agent.

As a customer, the visitor submits a problem and the AI drafts an answer from Tunely's knowledge base of help articles and internal notes. When a help article clearly covers the question and the ticket is not risky, the customer gets an automatic reply. Otherwise the ticket is handed off. As a support agent, the visitor sees why the AI decided what it did, edits the draft, asks for details, or fills a knowledge gap by writing a help article, then delivers an approved reply. A public quality page shows measured results, including where the AI fails.

## User Stories

1. As a visitor, I want a private copy of the demo so my changes cannot affect another visitor.
2. As a visitor, I want Tunely's homepage to make clear what Tunely is so I know what problems to report.
3. As a visitor, I want clickable example problems so I can try the service desk without typing.
4. As a visitor, I want to see that this is a portfolio demo and find how it works so I know whose work it is.
5. As a visitor, I want to switch between the customer and support agent seats so I can see both sides of one support ticket.
6. As a visitor, I want the inbox to start with example tickets covering each kind of hand-off so I can see every feature without spending AI requests.
7. As a visitor, I want to know when live AI is paused so I do not mistake a saved draft for a response to my question.
8. As a visitor, I want to reset my copy of the demo so I can start over.
9. As a visitor, I want to view saved quality results so I can judge how well the AI performs.
10. As a customer, I want an immediate answer when a help article covers my problem so I do not have to wait.
11. As a customer, I want to be told right away when a team member will handle my ticket so I know it was received.
12. As a customer, I want to see my tickets with their status and replies so I can follow up.
13. As a customer, I want to see how my ticket was answered so I can trust the reply.
14. As a support agent, I want the inbox to hold handed-off tickets, filterable by status, so I can find work that needs me.
15. As a support agent, I want to see why the AI replied or handed off, and which help articles and internal notes it used, so I can check its judgment.
16. As a support agent, I want to read a ticket's history so I can understand what has happened.
17. As a support agent, I want to edit or reject an answer draft, or ask the customer for details, so I remain responsible for the outcome.
18. As a support agent, I want a warning when a draft copies text from an internal note so I do not leak it to the customer.
19. As a support agent, I want to write a help article for a knowledge gap and redraft so the answer can cite it.
20. As a support agent, I want a suggested priority so I can assess urgency.
21. As a support agent, I want to approve a reply and deliver it inside the app so the customer sees it.
22. As a support agent, I want to reopen a ticket so a premature resolution can be corrected.
23. As a support agent, I want to move to the next ticket after resolving one so I can keep working without returning to the queue.
24. As the owner, I want to sign in to change internal notes and run live evaluations so visitors cannot.
25. As the owner, I want per-visitor and daily limits on live AI, plus logs, so the deployed demo cannot exceed a small, known cost.
26. As the owner, I want the AI to ignore instructions in customer text, visitor-written help articles, and retrieved documents so untrusted text cannot control the workflow.
27. As the owner, I want repeatable cases for citations, unsupported claims, priority, hand-off decisions, internal-note leaks, prompt injection, and retrieval quality so I can measure the AI.
28. As the owner, I want evaluation failures and representative examples published so I can explain trade-offs in interviews.
29. As a developer, I want to run the full product locally with Docker so I can reproduce bugs across services.
30. As a developer, I want automated checks in CI that run without paid AI calls so changes remain safe to ship.

## Implementation Decisions

### Brand and layout

- The company is always shown as "Tunely · music streaming" so visitors know what it is without explanation.
- One brand in two moods, from the chosen "Chat" prototype direction: warm orange accent, rounded shapes, chat bubbles. The customer side is dark charcoal; the agent side is light cream, built for reading many tickets.
- The landing page is Tunely's own homepage: a top navigation, a headline beside a live support chat with clickable example problems, a three-step "How Tunely Support works" section (tell us, get an answer in seconds, a person steps in when it matters), and topic tiles that each start a chat with an example question.
- The customer view is one panel, like a messaging app: the customer's conversations are listed on the left with their status, and the selected support ticket opens as its own chat on the right. "New conversation" starts a fresh chat.
- A thin strip on every page reads "Portfolio demo · How it works" and links to one page describing the architecture and the quality results.
- A top-bar switch, "Viewing as: Customer | Agent", changes seats. After a customer submits a ticket that is handed off, the chat suggests switching to the agent seat.
- The agent view has three columns: the inbox as a conversation list, the selected ticket as a chat thread with the editable answer draft in the reply box, and a numbered "How the AI decided" trail (topic and priority, documents found, rule applied, decision). After resolution the agent moves directly to the next ticket.
- Styling uses Tailwind CSS with shadcn/ui components; Tunely's colours and fonts are defined once as theme tokens. The HTML prototype is a visual reference only and is rewritten as React components, not copied.

### Services

- Next.js provides the homepage, customer views, agent inbox, ticket detail, help article editing, how-it-works page, and quality page.
- A Node.js API owns support ticket data, status transitions, hand-off rules, authorization, demo isolation, usage limits, and integration with the Python service.
- A Python service retrieves knowledge base documents, drafts answers, labels topics and priority, checks drafts for internal-note leaks, and runs evaluation cases. It is part of the running application, not only an offline script.
- Store support tickets, replies, and the knowledge base in a database. Keep example data fictional and reproducible.

### Knowledge base

- Seed about 12 help articles and 8 internal notes about Tunely: playback, offline downloads, family plans, billing, account security, and devices. Internal notes cover known bugs with workarounds, a refund policy, a response-time promise, plan limits, and release notes.
- Leave one or two common topics uncovered on purpose so visitors can see a knowledge gap handled honestly.
- Retrieval is implemented twice, by word matching and by embeddings. Embeddings are computed when a document is saved. The quality page compares both, and the app uses whichever measures better.

### Drafting and hand-off

- The AI drafts an answer as soon as a customer submits a support ticket.
- The AI proposes a topic and priority; fixed rules in code decide whether the ticket is risky. Refunds, double charges, and account security are always risky.
- An automatic reply is delivered only when a help article clearly supports the draft, the ticket is not risky, and the draft relies on no internal note. Everything else is handed off. See [ADR 0001](adr/0001-automatic-replies-with-hand-off.md).
- On hand-off, the customer immediately sees "A Tunely team member will reply soon" and the status "With our team".
- Every ticket shows a "Why" box in plain words: the decision, the reason, and the documents used, each labelled Help or Internal. The customer side links to it as "How was this answered?".
- Before a support agent approves a draft, code checks it for long phrases copied from internal notes and warns the agent if it finds any.
- Answers lacking adequate support request clarification or hand off rather than invent facts.
- AI output cannot deliver a handed-off reply or change priority without a human action.
- Replies are delivered and tracked inside the application. No real email is sent.

### Visitors, roles, and cost

- Each visitor gets a private, temporary copy of the demo. It starts with five saved tickets: one each for an unsure draft, a draft relying on an internal note, a risky ticket, a knowledge gap, and a resolved automatic reply.
- Only the support agent seat can write help articles, and only in the visitor's own copy, with limits on size and count. Visitor-written text is treated as untrusted.
- Only the signed-in owner can change internal notes and start live evaluation runs. Anyone can view saved quality results.
- Live AI is limited to 5 drafts per visitor, including redrafts, and 200 drafts per day across all visitors. The per-visitor limit can be dodged by clearing cookies; the daily limit is the real guard.
- Use a small model with capped output. Set a spending limit on the provider account as a second guard.
- When a limit is reached, or the provider refuses for lack of credit, the app says "Live AI is paused for today" and keeps showing saved examples.
- Keep provider credentials server-side.

### Running and hosting

- The web app, Node.js API, and Python service stay three separate codebases. Docker Compose runs them with the database locally as long-running services.
- Kubernetes setup files describe the same four parts. On every pull request, CI creates a throwaway Kubernetes cluster, deploys the app with an in-cluster Postgres, and runs the end-to-end tests against it. There is no hosted cluster.
- The public demo runs on Vercel's free plan: the web app as Next.js, and the API and Python service as on-demand functions from their own code. The database stays on Neon's free plan. No hosting account holds a payment card, so the worst case of overuse is a paused site, not a bill. See [ADR 0002](adr/0002-vercel-functions-and-kubernetes-in-ci.md).
- Publish a real deployment, a reproducible setup, and measured evaluation results. Do not claim user adoption or production scale without evidence.

## Testing Decisions

- Test observable behavior rather than prompt wording or private implementation details.
- End-to-end tests cover three paths: a covered question gets an automatic reply on the customer side; a risky ticket is handed off, edited, approved, and appears on the customer side with the right status and history; a knowledge gap is filled with a new help article and the redraft cites it.
- API tests cover demo isolation, per-visitor and daily limits, the paused state when the provider refuses, hand-off rules overriding the AI, agent-only help article writes, owner-only internal notes and live evaluation, and rejection of unapproved actions.
- Python evaluation cases cover expected sources, unsupported claims, priority, hand-off decisions, internal-note leak attempts, prompt injection (including visitor-written help articles), and word matching versus embeddings retrieval.
- Deterministic tests use saved responses or fakes and run in CI without paid calls. A separate, explicitly invoked live evaluation measures the actual provider and records model, dataset version, outcomes, latency, and cost.
- Document known failures alongside results; a public sample draft must be clearly labeled as saved output.

## Out Of Scope

Real customer data, real company brands, email delivery, unlimited public AI generation, automatic replies to risky tickets or drafts relying on internal notes, visitor edits to internal notes, mobile apps, a hosted Kubernetes cluster, paid hosting, and claims of organizational adoption or production-scale operation.

## Further Notes

The project is intended to teach both full-stack development and AI engineering while demonstrating judgment to interviewers. Hosting choices should keep idle cost at zero, but free-tier availability and usage limits must be verified before deployment. The provider account holds a small prepaid credit without auto-refill, so running out must degrade gracefully rather than break the app.
