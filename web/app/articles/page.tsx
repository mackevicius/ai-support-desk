import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { saveArticle } from '../actions';
import { getHelpArticles } from '../data';
import { SubmitButton } from '../_components/submit-button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Card } from '../../components/ui/card';
import { Separator } from '../../components/ui/separator';
import { StatusPill } from '../_components/status-pill';

export default async function ArticlesPage() {
  const jar = await cookies();
  const sessionId = jar.get('demo_session')?.value;
  const ownerSession = jar.get('owner_session')?.value;
  if (!sessionId || !ownerSession) redirect('/owner');
  const articles = await getHelpArticles(sessionId, ownerSession);
  if (!articles) redirect('/owner');

  return (
    <main className="workspace focus-view">
      <div className="detail articles-page">
        <Link href="/" className="back">
          Back to inbox
        </Link>
        <h1>Help articles</h1>
        <Separator className="mt-6" />
        <section className="article-section" aria-labelledby="add-article">
          <h2 id="add-article">Add article</h2>
          <Card className="rounded-lg p-6">
          <form action={saveArticle} className="review-form">
            <label htmlFor="new-kind">Document type</label>
            <select id="new-kind" name="kind" defaultValue="help_article">
              <option value="help_article">Help article</option>
              <option value="internal_note">Internal note</option>
            </select>
            <label htmlFor="new-title">Title</label>
            <Input id="new-title" name="title" required maxLength={200} />
            <label htmlFor="new-body">Content</label>
            <Textarea
              id="new-body"
              name="body"
              required
              maxLength={5000}
              rows={4}
            />
            <SubmitButton label="Add article" pendingLabel="Adding..." />
          </form>
          </Card>
        </section>
        <Separator />
        <section
          className="article-section"
          aria-labelledby="existing-articles"
        >
          <h2 id="existing-articles">Existing articles</h2>
          {articles.map((article) => (
            <Card key={`${article.id}-${article.title}-${article.body}-${article.retired}`} className="mb-4 gap-4 rounded-lg p-6">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone={article.kind === 'internal_note' ? 'team' : 'neutral'}>{article.kind === 'internal_note' ? 'Internal note' : 'Help article'}</StatusPill>
                <StatusPill tone={article.retired ? 'neutral' : 'ok'}>{article.retired ? 'Retired' : 'Active'}</StatusPill>
              </div>
              <Separator />
            <form
              action={saveArticle}
              className="review-form article-editor"
            >
              <input type="hidden" name="id" value={article.id} />
              <label htmlFor={`kind-${article.id}`}>Document type</label>
              <select
                id={`kind-${article.id}`}
                name="kind"
                defaultValue={article.kind}
              >
                <option value="help_article">Help article</option>
                <option value="internal_note">Internal note</option>
              </select>
              <label htmlFor={`title-${article.id}`}>Title</label>
              <Input
                id={`title-${article.id}`}
                name="title"
                defaultValue={article.title}
                required
                maxLength={200}
              />
              <label htmlFor={`body-${article.id}`}>Content</label>
              <Textarea
                id={`body-${article.id}`}
                name="body"
                defaultValue={article.body}
                required
                maxLength={5000}
                rows={4}
              />
              <label
                className="article-status"
                htmlFor={`retired-${article.id}`}
              >
                <input
                  id={`retired-${article.id}`}
                  type="checkbox"
                  name="retired"
                  defaultChecked={article.retired}
                />
                Retired (excluded from new drafts)
              </label>
              <SubmitButton label="Save article" pendingLabel="Saving..." />
            </form>
            </Card>
          ))}
        </section>
      </div>
    </main>
  );
}
