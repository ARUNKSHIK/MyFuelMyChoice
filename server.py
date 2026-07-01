import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, 'data')
VOTES_FILE = os.path.join(DATA_DIR, 'votes.json')

os.makedirs(DATA_DIR, exist_ok=True)
if not os.path.exists(VOTES_FILE):
    with open(VOTES_FILE, 'w', encoding='utf-8') as handle:
        json.dump([], handle)


def read_votes():
    try:
        with open(VOTES_FILE, 'r', encoding='utf-8') as handle:
            parsed = json.load(handle)
            return parsed if isinstance(parsed, list) else []
    except Exception:
        with open(VOTES_FILE, 'w', encoding='utf-8') as handle:
            json.dump([], handle)
        return []


def write_votes(votes):
    with open(VOTES_FILE, 'w', encoding='utf-8') as handle:
        json.dump(votes, handle, indent=2)


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, relative_path):
        path = os.path.join(ROOT, relative_path.lstrip('/'))
        if not os.path.commonpath([ROOT, path]) == ROOT:
            self.send_error(403)
            return

        if os.path.isdir(path):
            path = os.path.join(path, 'index.html')

        if os.path.exists(path) and os.path.isfile(path):
            content_type = 'text/html; charset=utf-8'
            if path.endswith('.css'):
                content_type = 'text/css; charset=utf-8'
            elif path.endswith('.js'):
                content_type = 'application/javascript; charset=utf-8'
            elif path.endswith('.json'):
                content_type = 'application/json; charset=utf-8'

            with open(path, 'rb') as handle:
                body = handle.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self._serve_file('/index.html')

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/votes':
            votes = read_votes()
            counts = {choice: 0 for choice in ['support', 'oppose', 'neutral']}
            for vote in votes:
                if vote.get('choice') in counts:
                    counts[vote['choice']] += 1
            self._send_json(200, {
                'votes': votes,
                'counts': counts,
                'totalVotes': len(votes)
            })
            return

        self._serve_file(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != '/api/votes':
            self._send_json(404, {'error': 'Not found'})
            return

        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8')

        try:
            payload = json.loads(body or '{}')
        except json.JSONDecodeError:
            self._send_json(400, {'error': 'Invalid JSON'})
            return

        choice = payload.get('choice')
        if choice not in ['support', 'oppose', 'neutral']:
            self._send_json(400, {'error': 'Invalid choice'})
            return

        vote = {
            'choice': choice,
            'reason': payload.get('reason', ''),
            'timestamp': payload.get('timestamp') or __import__('datetime').datetime.utcnow().isoformat() + 'Z'
        }

        votes = read_votes()
        votes.append(vote)
        write_votes(votes)

        self._send_json(201, {'success': True, 'vote': vote})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '3000'))
    host = '0.0.0.0'
    server = ThreadingHTTPServer((host, port), Handler)
    print(f'Server running at http://{host}:{port}')
    server.serve_forever()
