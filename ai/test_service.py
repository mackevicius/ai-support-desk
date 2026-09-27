import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from server import Handler


class FakeProvider(BaseHTTPRequestHandler):
    calls = []
    answer = {'reply': 'Resend invitations from Settings > Team.', 'source_ids': [1], 'suggested_priority': 'normal'}

    def do_POST(self):
        length = int(self.headers['Content-Length'])
        self.calls.append(json.loads(self.rfile.read(length)))
        body = json.dumps({'choices': [{'message': {'content': json.dumps(self.answer)}}]}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


class ServiceTests(unittest.TestCase):
    def test_http_generation_uses_relevant_evidence_and_clarifies_without_it(self):
        FakeProvider.calls = []
        provider = ThreadingHTTPServer(('127.0.0.1', 0), FakeProvider)
        service = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threads = [threading.Thread(target=server.serve_forever) for server in (provider, service)]
        for thread in threads:
            thread.start()
        try:
            articles = [
                {'id': 1, 'title': 'Inviting teammates', 'body': 'Resend invitations from Settings > Team. Invitations expire after seven days.'},
                {'id': 2, 'title': 'Invoices', 'body': 'Download invoices from Settings > Billing.'},
            ]
            with patch.dict('os.environ', {
                'OPENAI_API_KEY': 'fake-key',
                'OPENAI_BASE_URL': f'http://127.0.0.1:{provider.server_port}',
                'AI_SERVICE_SECRET': 'test-service-secret',
            }):
                def generate(question, secret='test-service-secret'):
                    request = Request(
                        f'http://127.0.0.1:{service.server_port}/generate',
                        data=json.dumps({'question': question, 'articles': articles}).encode(),
                        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {secret}'},
                    )
                    with urlopen(request) as response:
                        return json.load(response)

                with self.assertRaises(HTTPError) as denied:
                    generate('How can I resend invitations?', secret='wrong')
                self.assertEqual(denied.exception.code, 403)
                self.assertEqual(len(FakeProvider.calls), 0)
                answer = generate('How can I resend invitations?')
                self.assertEqual(answer, {
                    'reply': 'Resend invitations from Settings > Team.',
                    'suggested_priority': 'normal',
                    'source_ids': [1],
                })
                self.assertEqual(len(FakeProvider.calls), 1)
                self.assertEqual(FakeProvider.calls[0]['max_tokens'], 300)
                self.assertNotIn('Download invoices', json.dumps(FakeProvider.calls[0]))
                FakeProvider.answer = {
                    'reply': 'Resend invitations from Settings > Team. Refunds are guaranteed.',
                    'source_ids': [1], 'suggested_priority': 'high',
                }
                unsupported = generate('How can I resend invitations?')
                self.assertEqual(unsupported['source_ids'], [])
                self.assertIn('clarify', unsupported['reply'].lower())
                FakeProvider.answer = {
                    'reply': 'Invitations expire after 24 days.',
                    'source_ids': [1], 'suggested_priority': 'normal',
                }
                numeric_claim = generate('When do invitations expire?')
                self.assertEqual(numeric_claim['source_ids'], [])
                clarification = generate('What is the refund policy?')
                self.assertEqual(clarification['source_ids'], [])
                self.assertIn('clarify', clarification['reply'].lower())
                self.assertEqual(len(FakeProvider.calls), 3)
        finally:
            for server in (service, provider):
                server.shutdown()
                server.server_close()
            for thread in threads:
                thread.join()


if __name__ == '__main__':
    unittest.main()