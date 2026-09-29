import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { saveArticle } from '../actions';
import { getHelpArticles } from '../data';
import { SubmitButton } from '../_components/submit-button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';

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
        <Link href="/" className="back">Back to inbox</Link>
        <h1>Help articles</h1>
        <section className="article-section" aria-labelledby="add-article">
          <h2 id="add-article">Add article</h2>
          <form action={saveArticle} className="review-form">
            <label htmlFor="new-title">Title</label>
            <Input id="new-title" name="title" required maxLength={200} />
            <label htmlFor="new-body">Content</label>
            <Textarea id="new-body" name="body" required maxLength={5000} rows={4} />
            <SubmitButton label="Add article" pendingLabel="Adding..." />
          </form>
        </section>
        <section className="article-section" aria-labelledby="existing-articles">
          <h2 id="existing-articles">Existing articles</h2>
          {articles.map((article) => (
            <form key={`${article.id}-${article.title}-${article.body}-${article.retired}`} action={saveArticle} className="review-form article-editor">
              <input type="hidden" name="id" value={article.id} />
              <label htmlFor={`title-${article.id}`}>Title</label>
              <Input id={`title-${article.id}`} name="title" defaultValue={article.title} required maxLength={200} />
              <label htmlFor={`body-${article.id}`}>Content</label>
              <Textarea id={`body-${article.id}`} name="body" defaultValue={article.body} required maxLength={5000} rows={4} />
              <label className="article-status" htmlFor={`retired-${article.id}`}>
                <input id={`retired-${article.id}`} type="checkbox" name="retired" defaultChecked={article.retired} />
                Retired (excluded from new drafts)
              </label>
              <SubmitButton label="Save article" pendingLabel="Saving..." />
            </form>
          ))}
        </section>
      </div>
    </main>
  );
}