import Link from 'next/link';
import { Card } from '../../components/ui/card';
import { Separator } from '../../components/ui/separator';

export default function HowItWorks() {
  return (
    <main className="workspace focus-view">
      <article className="detail quality-page">
        <h1>How it works</h1>
        <section className="quality-section" aria-labelledby="story-heading">
          <h2 id="story-heading">From question to reply</h2>
          <ol className="list-decimal space-y-4 pl-6">
            <li><strong>The customer asks.</strong> They send a question about Tunely.</li>
            <li><strong>The AI finds relevant help articles.</strong> It looks for information that covers the question.</li>
            <li><strong>It replies or hands off.</strong> A clear answer from help articles can become an automatic reply. Otherwise, the question goes to a support agent.</li>
            <li><strong>A support agent reviews.</strong> The agent edits the draft, asks for details, or approves a reply.</li>
          </ol>
        </section>
        <Separator />
        <section className="quality-section" aria-labelledby="decision-heading">
          <h2 id="decision-heading">When a person steps in</h2>
          <p>A support agent takes over when the AI is unsure, no help article covers the question, or the answer needs a staff-only internal note. The agent can write a new help article to cover a missing answer.</p>
          <p>Problems with money or account security always go to a person: refunds, double charges, hacked or locked accounts, and fraud. Cancelling a plan, updating a card, and changing a password are routine how-to questions; the AI can reply when a help article clearly covers them.</p>
          <p>After an automatic reply, the customer can ask for a person if they still need help. The same conversation goes to a support agent.</p>
        </section>
        <Separator />
        <section className="quality-section" aria-labelledby="architecture-heading">
          <h2 id="architecture-heading">Architecture</h2>
          <ol className="architecture-flow">
            <li><Card className="h-full gap-2 rounded-lg p-4"><strong>Web app</strong><span>Next.js and React render the customer chat, Agent seat, and public saved quality results. Server actions send requests to the API.</span></Card></li>
            <li><Card className="h-full gap-2 rounded-lg p-4"><strong>API</strong><span>Node.js and Express validate visitor and owner sessions, enforce allowances, compute MiniLM embeddings, apply hand-off rules, and save decisions.</span></Card></li>
            <li><Card className="h-full gap-2 rounded-lg p-4"><strong>Python service</strong><span>Retrieves relevant knowledge-base documents and calls the answer provider. Documents and questions are untrusted input; grounding and phrase-copy guards check the draft.</span></Card></li>
            <li><Card className="h-full gap-2 rounded-lg p-4"><strong>Database</strong><span>PostgreSQL stores support tickets, help articles, staff-only internal notes, embeddings, reviews, allowances, and saved live evaluation results.</span></Card></li>
          </ol>
        </section>
        <Separator />
        <section className="quality-section" aria-labelledby="deployment-heading">
          <h2 id="deployment-heading">Deployment</h2>
          <p>Vercel runs the public web app, API, and Python service as on-demand functions; Neon hosts PostgreSQL. Only the web app is public. Provider keys stay in the Python service, and an internal secret protects service calls.</p>
          <p>Docker Compose runs all four services locally. Kubernetes runs long-lived containers in a temporary CI cluster, where browser tests use a fake provider. Kubernetes is not the public demo host.</p>
        </section>
        <Separator />
        <section className="quality-section" aria-labelledby="evidence-heading">
          <h2 id="evidence-heading">Evidence and decisions</h2>
          <p><Link href="/quality">Saved answer checks</Link> include hand-off decisions, internal-note leak attempts, and known failures. The <Link href="/quality?view=retrieval">retrieval comparison</Link> measures word matching against embeddings. These small benchmarks do not prove general accuracy or confidentiality.</p>
          <p>Tunely is a fictional music streaming company. This portfolio demo uses fictional support requests and documents, with no real customers or production-scale claims.</p>
          <p>Each visitor gets a temporary private workspace. The owner alone can change shared documents and start paid live evaluations. Browsing saved cases and fixture results makes no paid AI calls. Replies stay in the conversation; no email is sent.</p>
          <ul>
            <li><a href="https://github.com/mackevicius/ai-support-desk/blob/master/docs/adr/0001-automatic-replies-with-hand-off.md">Automatic replies and hand-off</a></li>
            <li><a href="https://github.com/mackevicius/ai-support-desk/blob/master/docs/adr/0002-vercel-functions-and-kubernetes-in-ci.md">Vercel and Kubernetes</a></li>
          </ul>
        </section>
      </article>
    </main>
  );
}