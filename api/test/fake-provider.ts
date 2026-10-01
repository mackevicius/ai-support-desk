import { createServer } from 'node:http';

const questionCalls = new Map<string, number>();

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
  const covered = /offline|family plan|audio quality|staff playback/i.test(
    input.question,
  );
  const calls = (questionCalls.get(input.question) ?? 0) + 1;
  questionCalls.set(input.question, calls);
  const redrafted = input.question.includes('redraft review') && calls > 1;
  const article = redrafted
    ? input.articles.find(
        (item: { title: string }) => item.title === 'Changing audio quality',
      )
    : input.articles[0];
  const answer = covered
    ? {
        topic: redrafted
          ? 'Audio quality'
          : /offline/i.test(input.question)
            ? 'Offline downloads'
            : 'Music settings',
        reply: redrafted
          ? article.body
          : /offline/i.test(input.question)
            ? 'You can save songs for offline play.'
            : article.body,
        suggested_priority: redrafted ? 'high' : 'normal',
        source_ids: [article.id],
        clearly_covered: !redrafted,
        requires_team: redrafted,
      }
    : {
        topic: 'Unclassified',
        reply: 'Could you clarify your request?',
        suggested_priority: 'normal',
        source_ids: [],
        clearly_covered: false,
      };
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(answer) } }],
    }),
  );
}).listen(
  Number(process.env.DEMO_PROVIDER_PORT ?? process.env.PORT ?? 3102),
  '0.0.0.0',
);
