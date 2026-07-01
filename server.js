const http = require('http');
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const dataDir = path.join(rootDir, 'data');
const votesFile = path.join(dataDir, 'votes.json');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(votesFile)) {
    fs.writeFileSync(votesFile, '[]', 'utf8');
}

function readVotes() {
    try {
        const raw = fs.readFileSync(votesFile, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        fs.writeFileSync(votesFile, '[]', 'utf8');
        return [];
    }
}

function writeVotes(votes) {
    fs.writeFileSync(votesFile, JSON.stringify(votes, null, 2), 'utf8');
}

function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.html': return 'text/html; charset=utf-8';
        case '.css': return 'text/css; charset=utf-8';
        case '.js': return 'application/javascript; charset=utf-8';
        case '.json': return 'application/json; charset=utf-8';
        case '.png': return 'image/png';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        case '.svg': return 'image/svg+xml';
        case '.ico': return 'image/x-icon';
        default: return 'application/octet-stream';
    }
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
}

function serveStatic(req, res, filePath) {
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Server error');
            }
            return;
        }

        res.writeHead(200, { 'Content-Type': getContentType(filePath) });
        res.end(content);
    });
}

const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname === '/api/votes') {
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            });
            res.end();
            return;
        }

        if (req.method === 'GET') {
            const votes = readVotes();
            const counts = { support: 0, oppose: 0, neutral: 0 };

            votes.forEach((vote) => {
                if (vote && vote.choice && counts[vote.choice] !== undefined) {
                    counts[vote.choice] += 1;
                }
            });

            sendJson(res, 200, {
                votes,
                counts,
                totalVotes: votes.length
            });
            return;
        }

        if (req.method === 'POST') {
            let body = '';

            req.on('data', (chunk) => {
                body += chunk;
            });

            req.on('end', () => {
                try {
                    const parsed = JSON.parse(body || '{}');
                    const choice = parsed.choice;

                    if (!choice || !['support', 'oppose', 'neutral'].includes(choice)) {
                        sendJson(res, 400, { error: 'Invalid vote choice' });
                        return;
                    }

                    const vote = {
                        choice,
                        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
                        timestamp: parsed.timestamp || new Date().toISOString()
                    };

                    const votes = readVotes();
                    votes.push(vote);
                    writeVotes(votes);

                    sendJson(res, 201, { success: true, vote });
                } catch {
                    sendJson(res, 400, { error: 'Invalid request body' });
                }
            });
            return;
        }

        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const safePath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    const filePath = path.join(rootDir, safePath.replace(/^\//, ''));

    if (!filePath.startsWith(rootDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        serveStatic(req, res, filePath);
        return;
    }

    const fallbackPath = path.join(rootDir, 'index.html');
    serveStatic(req, res, fallbackPath);
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Server running at http://127.0.0.1:${port}`);
});
