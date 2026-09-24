# AI Support Desk

## Problem Statement

I want a deployable portfolio product that demonstrates full-stack ownership and practical AI engineering with Next.js, Node.js, and Python. It must be useful to explore publicly without creating an open-ended AI bill. The repository should show what works, what fails, and how the system is tested and operated.

## Solution

Build an AI-assisted support inbox for a fictional SaaS company. Visitors explore an isolated temporary workspace with sample support tickets and saved AI results. They can submit new support tickets, but arbitrary public questions do not trigger paid AI calls. The signed-in owner can generate live answer drafts and priority suggestions grounded in fictional help documentation. A person reviews changes before delivering a reply inside the app. An evaluation view shows where the AI succeeds and fails. The support workspace uses a queue-first layout: opening a ticket provides a focused view of the request, sources, and editable draft.

## User Stories

1. As a visitor, I want an isolated temporary demo so my changes cannot affect another visitor.
2. As a visitor, I want to submit a support ticket so I can see how requests enter the inbox.
3. As a visitor, I want sample tickets with saved AI results so I can explore the workflow without a paid AI request.
4. As a visitor, I want to know when live generation is unavailable so I do not mistake a saved draft for a response to my question.
5. As a support agent, I want to view the inbox and filter by status so I can find work that needs attention.
6. As a support agent, I want to read a ticket's history so I can understand what has happened.
7. As a support agent, I want an answer draft with source links so I can verify its claims against the help documentation.
8. As a support agent, I want a suggested priority so I can assess urgency.
9. As a support agent, I want to edit or reject suggestions so I remain responsible for the outcome.
10. As a support agent, I want to approve a reply and deliver it inside the app so the ticket has a complete resolution path.
11. As a support agent, I want to reopen a ticket so a premature resolution can be corrected.
12. As a support agent, I want to move to the next request after resolving one so I can keep reviewing without returning to the queue.
13. As the owner, I want to sign in before using live generation so public visitors cannot spend my API budget.
14. As the owner, I want to manage fictional help documents so I can observe how knowledge changes affect drafts.
15. As the owner, I want AI to ask for more information when the documents do not support an answer.
16. As the owner, I want AI to ignore instructions embedded in a customer's request or retrieved document so untrusted text cannot control the workflow.
17. As the owner, I want repeatable cases for citations, unsupported claims, priority, and handoffs so I can measure quality.
18. As the owner, I want to see evaluation failures and representative examples so I can explain trade-offs in interviews.
19. As the owner, I want request limits and logs so I can operate the deployed demo without surprise costs.
20. As a developer, I want to run the full product locally with Docker so I can reproduce bugs across services.
21. As a developer, I want automated checks in CI that run without paid AI calls so changes remain safe to ship.

## Implementation Decisions

- Next.js provides the request form, support inbox, ticket detail, document management, and evaluation view.
- The support inbox uses prototype B's queue-then-focus layout. The ticket view gives the request, sources, and reply room to read; after resolution, the agent can move directly to the next request. The prototype is disposable, not production code.
- A Node.js API owns support ticket data, status transitions, authorization, demo isolation, and integration with the Python service.
- A Python service retrieves relevant documentation, produces grounded answer and priority suggestions, and runs evaluation cases. It is part of the running application, not only an offline script.
- Store support tickets, replies, and documents in a database. Keep example data fictional and reproducible.
- Public visitors get isolated temporary data and saved AI results. Creating an arbitrary public request does not generate an AI draft; the interface must say so plainly.
- Only the authenticated owner can trigger live generation. Limit request volume and keep provider credentials server-side.
- AI output cannot deliver a reply or change priority without a human action. Answers lacking adequate support should request clarification or hand off rather than invent facts.
- Replies are delivered and tracked inside the application. No real email is sent.
- Docker runs the Next.js app, Node.js API, Python service, and database locally. Use an affordable deployment path for the public demo; managed Kubernetes is not required.
- Publish a real deployment, a reproducible setup, and measured evaluation results. Do not claim user adoption or production scale without evidence.

## Testing Decisions

- Test observable behavior rather than prompt wording or private implementation details.
- The central end-to-end test submits a support ticket, obtains a documented suggestion, reviews it, delivers an approved reply, and confirms the resulting status and history.
- API tests cover demo isolation, owner-only live generation, cost limits, and rejection of unapproved actions.
- Python evaluation cases cover expected sources, unsupported claims, priority, clarification or handoff, and prompt-injection attempts.
- Deterministic tests use saved responses or fakes and run in CI without paid calls. A separate, explicitly invoked live evaluation measures the actual provider and records model, dataset version, outcomes, latency, and cost.
- Document known failures alongside results; a public sample draft must be clearly labeled as saved output.

## Out Of Scope

Real customer data, email delivery, unrestricted public AI generation, autonomous replies, mobile apps, managed Kubernetes in the first version, and claims of organizational adoption or production-scale operation.

## Further Notes

The project is intended to teach both full-stack development and AI engineering while demonstrating judgment to interviewers. Hosting choices should keep idle cost close to zero, but free-tier availability and API usage limits must be verified before deployment. A local Kubernetes exercise can follow the working Docker deployment if it adds value for a specific application.
