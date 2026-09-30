import { createServer } from 'node:http';

createServer(async (request, response) => {
  if (request.method === 'GET') {
    response.writeHead(200).end();
    return;
  }
  let body = '';
  for await (const chunk of request) body += chunk;
  const input = JSON.parse(JSON.parse(body).messages[1].content);
  if (input.question.includes('teammate')) {
    response.writeHead(503).end();
    return;
  }
  const covered = /offline|family plan|audio quality/i.test(input.question);
  const article = input.articles[0];
  const answer = covered ? { reply: /offline/i.test(input.question) ? 'You can save songs for offline play.' : article.body,
    suggested_priority: 'normal', source_ids: [article.id], clearly_covered: true, requires_team: false }
    : { reply: 'Could you clarify your request?', suggested_priority: 'normal', source_ids: [], clearly_covered: false };
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
}).listen(Number(process.env.PORT ?? 3102), '0.0.0.0');