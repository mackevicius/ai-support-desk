# Feature details

How each part of the demo behaves. For an overview, see the [README](../README.md). Terms are defined in [CONTEXT.md](../CONTEXT.md).

## Demo data

Every visitor starts with five saved Tunely cases: an unsure family invitation draft, a playback draft informed by an internal note, a risky duplicate charge, an uncovered playlist import question, and a solved offline-listening conversation with a saved automatic reply. Browsing and resetting these cases makes no AI calls. The homepage topic tiles submit example questions, and its three-step section explains how customer questions reach an answer or a person.

The fictional starter corpus in `api/starter-data.json` contains 12 help articles and 8 internal notes and is shared with the evaluation fixtures. Playlist imports and listening statistics deliberately remain uncovered. Startup replaces the known Dayline seed records, preserves custom documents and requests, and leaves visitor reviews and saved source snapshots intact.

## Customer chat

Ask Tunely a question in the customer chat or choose an example problem. A clearly covered, non-risky question receives an automatic reply using public help articles. Everything else shows "A Tunely team member will reply soon" and "With our team", with a suggestion to switch to the Agent seat. "How was this answered?" shows the reason and public articles used; the decision is also saved in the agent's history. The customer panel lists each visitor's conversations separately, without a ticket-history list. New requests and reviews belong to a temporary visitor session; reset does not change another visitor's data or replenish live-AI allowance.

## Agent seat

The Agent seat handles sample requests and new handed-off conversations in three columns: an inbox with **Needs reply** and **All** tabs, the customer thread and editable answer draft, and a numbered "How the AI decided" trail with a collapsed history. Fixed code rules hand off refunds, double charges, account security and weakly supported answers even when the provider suggests replying. Agents send answers or ask for details from one reply box, or redraft. Priority is shown as a label only. They cannot solve or reopen a conversation. Redrafts count toward the visitor's live-draft allowance and do not change a conversation that is waiting on the customer. The decision trail uses the saved decision and reason recorded in history. A signed-in owner can manage help articles and generate live drafts for unsolved sample requests. Retired articles are excluded from new drafts; saved drafts keep their original citations. No email is sent.

## Conversation lifecycle

Customer home remains the landing page for first-time visitors. From a conversation, **New conversation** opens an empty chat at `/conversations/new` without leaving the conversation list. Conversation links announce loading immediately, and the selected conversation, list, and daily allowance load concurrently. Customers can send follow-up messages in an unsolved chat; messages appear in both seats, belong only to that visitor, and return answered requests to the team without using another AI draft. Previous replies remain in the thread.

Every automatic reply or agent reply leaves the conversation **Waiting on customer**. Only the customer can use **Solved** to mark it fixed. Solved conversations are final and read-only in both seats, with **Start a new conversation** replacing the customer reply box. Closed starter conversations count as Solved.

While waiting after an automatic reply, **Didn't help? Talk to a person** moves that visitor's conversation to the Agent's **Needs reply** inbox, with **Customer asked for a person** in the decision trail and agent history. It preserves the original reply and AI decision, uses no live AI allowance, and leaves hand-off accuracy unchanged. Solved conversations, AI hand-offs, and team replies do not offer this option.

Agent home opens the first open request in that workspace, or the first remaining request when none are open. Switching seats on a submitted conversation keeps that conversation selected. Reset remains available in the inbox column.

## Knowledge gaps

When no document supports an answer, the Agent seat marks a **Knowledge gap** and offers **Write help article**. Visitors can save up to five help articles in their own private copy, each with a title up to 200 characters and content up to 5000 characters. They cannot write internal notes or alter shared documents. Private articles are available for 24 hours and reset removes them without restoring the article or live-draft allowance. After saving an article, **Redraft** uses the updated knowledge base and cites supporting articles; it still needs agent approval. This also works on the saved playlist-import knowledge gap without changing anyone else's sample. Embedded instructions in visitor articles are untrusted, just like instructions in all other documents, and have a dedicated deterministic evaluation case.

## Internal notes and the copy guard

Every knowledge-base document has a type: **Help article** or **Internal note**. The signed-in owner chooses the type in the Help articles editor and alone can create, edit, or retire internal notes. Drafts citing internal notes always hand off, regardless of the provider's recommendation. The agent's trail labels sources Help or Internal; customer ticket responses omit drafts and internal source titles and text. "How was this answered?" shows only a count of internal sources.

The deterministic copy guard detects **eight or more consecutive words** copied from internal notes, ignoring case and punctuation. It checks all current internal notes, including retired notes, and the draft's saved internal sources. Matching ranges are highlighted while the agent edits, and the server checks the submitted reply before approval or asking for details. The agent can edit the reply or explicitly acknowledge the warning and approve it. Copied phrases never qualify for automatic delivery. Python also prevents long internal quotations before returning a draft; the API checks independently before delivery. Neither copy check calls AI. This is a phrase-copy guard, not proof that paraphrased or shorter confidential text is safe.

Generation checks both the original knowledge-base text and refreshed document types before deciding on delivery. Detected copied phrases are saved with the draft, including uncited phrases, so editing a note while generation runs cannot erase the warning. Customer responses use a decision-field allowlist and exclude unchecked AI topic metadata.
