# Automatic replies when well-supported, hand-off otherwise

The original spec required a person to approve every reply. We now let the AI deliver an automatic reply when a help article clearly covers the question and the ticket is not risky, and hand off everything else to a support agent. Approving every draft left the agent with nothing to do but click, and it hid the more interesting judgment: deciding when the AI should *not* answer alone. Hand-off accuracy becomes a measured quality result, and risky tickets and anything relying on internal notes always reach a person.

## Considered Options

- **No agent (AI always replies):** an ordinary chatbot with no human-judgment story.
- **Agent approves every draft:** safe, but the agent role becomes a formality.
