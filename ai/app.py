import json
from http import HTTPStatus

from server import generate_request
from evaluation import evaluate_request


def app(environ, start_response):
    path = environ.get('PATH_INFO')
    method = environ.get('REQUEST_METHOD')
    if method == 'GET' and path == '/health':
        status, body = 200, b''
    elif method == 'POST' and path == '/evaluate':
        status, answer = evaluate_request(environ.get('HTTP_AUTHORIZATION', ''))
        body = json.dumps(answer).encode() if status == 200 else b''
    elif method == 'POST' and path == '/generate':
        status, answer = generate_request(
            environ.get('HTTP_AUTHORIZATION', ''), environ.get('CONTENT_LENGTH', '0'), environ['wsgi.input'],
        )
        body = json.dumps(answer).encode() if status == 200 else b''
    else:
        status, body = 404, b''
    start_response(f'{status} {HTTPStatus(status).phrase}', [
        ('Content-Type', 'application/json'), ('Content-Length', str(len(body))),
    ])
    return [body]
