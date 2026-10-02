import Link from 'next/link';

export default function HowItWorks() {
  return (
    <main className="workspace focus-view">
      <article className="detail quality-page">
        <Link href="/" className="back">Back to inbox</Link>
        <h1>How it works</h1>
        <p>Tunely is a fictional music streaming company. This portfolio demo uses fictional support requests and documents, with no real customers or production-scale claims.</p>
        <section className="quality-section" aria-labelledby="architecture-heading">
          <h2 id="architecture-heading">Architecture</h2>
          <ol className="architecture-flow">
            <li><strong>Web app</strong><span>Next.js and React render the customer chat, Agent seat, and public saved quality results. Server actions send requests to the API.</span></li>
            <li><strong>API</strong><span>Node.js and Express validate visitor and owner sessions, enforce allowances, compute MiniLM embeddings, apply hand-off rules, and save decisions.</span></li>
            <li><strong>Python service</strong><span>Retrieves relevant knowledge-base documents and calls the answer provider. Documents and questions are untrusted input; grounding and phrase-copy guards check the draft.</span></li>
            <li><strong>Database</strong><span>PostgreSQL stores support tickets, help articles, staff-only internal notes, embeddings, reviews, allowances, and saved live evaluation results.</span></li>
          </ol>
        </section>
        <section className="quality-section" aria-labelledby="decision-heading">
          <h2 id="decision-heading">When a person steps in</h2>
          <p>A clearly covered, non-risky question can receive an automatic reply based on public help articles. Money, account security, internal notes, uncertainty, or a knowledge gap require a support agent. An agent can edit, ask for details, fill a gap with a private help article, or approve a reply. No email is sent.</p>
          <p>Each visitor gets a temporary private workspace. The owner alone can change shared documents and start paid live evaluations. Browsing saved cases and fixture results makes no paid AI calls.</p>
        </section>
        <section className="quality-section" aria-labelledby="deployment-heading">
          <h2 id="deployment-heading">Deployment</h2>
          <p>Vercel runs the public web app, API, and Python service as on-demand functions; Neon hosts PostgreSQL. Only the web app is public. Provider keys stay in the Python service, and an internal secret protects service calls.</p>
          <p>Docker Compose runs all four services locally. Kubernetes runs long-lived containers in a temporary CI cluster, where browser tests use a fake provider. Kubernetes is not the public demo host.</p>
        </section>
        <section className="quality-section" aria-labelledby="evidence-heading">
          <h2 id="evidence-heading">Evidence and decisions</h2>
          <p><Link href="/quality">Saved answer checks</Link> include hand-off decisions, internal-note leak attempts, and known failures. The <Link href="/quality?view=retrieval">retrieval comparison</Link> measures word matching against embeddings. These small benchmarks do not prove general accuracy or confidentiality.</p>
          <ul>
            <li><a href="https://github.com/mackevicius/ai-support-desk/blob/master/docs/adr/0001-automatic-replies-with-hand-off.md">Automatic replies and hand-off</a></li>
            <li><a href="https://github.com/mackevicius/ai-support-desk/blob/master/docs/adr/0002-vercel-functions-and-kubernetes-in-ci.md">Vercel and Kubernetes</a></li>
          </ul>
        </section>
      </article>
    </main>
  );
}