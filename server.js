const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const rootDir = __dirname;
const dataDir = path.join(rootDir, 'data');
const votesFile = path.join(dataDir, 'votes.json');
const securityLogFile = path.join(dataDir, 'security.log');
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:3000,http://localhost:3000').split(',').map((origin) => origin.trim()).filter(Boolean);
const csrfSecret = process.env.CSRF_SECRET || crypto.randomBytes(32).toString('hex');
const validChoices = ['support', 'oppose', 'neutral'];
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const rateLimitMaxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 60);
const maxBodySize = Number(process.env.MAX_BODY_SIZE || 65536);
const rateLimitStore = new Map();
const csrfTokens = new Map();

function ensureDataFiles() {
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(votesFile)) {
        fs.writeFileSync(votesFile, '[]', 'utf8');
    }
    if (!fs.existsSync(securityLogFile)) {
        fs.writeFileSync(securityLogFile, '', 'utf8');
    }
}

function logSecurity(event) {
    const entry = `${new Date().toISOString()} ${event}\n`;
    fs.appendFileSync(securityLogFile, entry, 'utf8');
    console.warn(event);
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

function sanitizeText(value, maxLength = 500) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/[\u0000-\u001F\u007F]/g, '').replace(/<[^>]*>/g, '').trim().slice(0, maxLength);
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
}

function getRequestProtocol(req) {
    const forwarded = req.headers['x-forwarded-proto'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim().toLowerCase();
    }
    return req.socket.encrypted ? 'https' : 'http';
}

function isLocalHost(host) {
    if (!host) {
        return true;
    }
    return host.includes('localhost') || host.includes('127.0.0.1') || host.includes('::1');
}

function getOrigin(req) {
    const origin = req.headers.origin;
    return typeof origin === 'string' ? origin : '';
}

function isAllowedOrigin(req) {
    const origin = getOrigin(req);
    if (!origin) {
        return true;
    }
    return allowedOrigins.includes(origin) || origin.startsWith('http://127.0.0.1') || origin.startsWith('http://localhost') || origin.startsWith('https://127.0.0.1') || origin.startsWith('https://localhost');
}

function applySecurityHeaders(res, extraHeaders = {}) {
    const headers = {
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://images.unsplash.com data:; font-src 'self' data:; connect-src 'self'; upgrade-insecure-requests; block-all-mixed-content",
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-XSS-Protection': '0',
        ...extraHeaders
    };

    Object.entries(headers).forEach(([name, value]) => {
        res.setHeader(name, value);
    });
}

function enforceHttps(req, res) {
    if (getRequestProtocol(req) === 'http' && !isLocalHost(req.headers.host || '')) {
        res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
        res.end();
        return true;
    }
    return false;
}

function rateLimit(req, res) {
    const clientIp = getClientIp(req);
    const now = Date.now();
    const bucket = rateLimitStore.get(clientIp) || [];
    const active = bucket.filter((timestamp) => now - timestamp < rateLimitWindowMs);
    active.push(now);

    if (active.length > rateLimitMaxRequests) {
        rateLimitStore.set(clientIp, active);
        logSecurity(`Rate limit exceeded for ${clientIp} on ${req.method} ${req.url}`);
        applySecurityHeaders(res, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Too many requests' }));
        return true;
    }

    rateLimitStore.set(clientIp, active);
    return false;
}

function readJsonBody(req, callback) {
    let body = '';
    let size = 0;

    req.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBodySize) {
            req.destroy();
            return;
        }
        body += chunk;
    });

    req.on('end', () => {
        try {
            const parsed = body ? JSON.parse(body) : {};
            callback(null, parsed);
        } catch {
            callback(new Error('Invalid JSON body'));
        }
    });

    req.on('error', () => {
        callback(new Error('Request body read failed'));
    });
}

function getCsrfToken(req) {
    const tokenFromHeader = req.headers['x-csrf-token'];
    if (typeof tokenFromHeader === 'string' && csrfTokens.has(tokenFromHeader)) {
        return tokenFromHeader;
    }
    const cookieHeader = req.headers.cookie || '';
    const cookieMatch = cookieHeader.match(/(?:^|; )csrfToken=([^;]+)/);
    if (cookieMatch && csrfTokens.has(cookieMatch[1])) {
        return cookieMatch[1];
    }
    return null;
}

function setCsrfCookie(res, token, host) {
    const secure = !isLocalHost(host);
    const cookie = `csrfToken=${token}; Path=/; Max-Age=3600; SameSite=Lax${secure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', cookie);
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
    const body = JSON.stringify(payload);
    applySecurityHeaders(res, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        ...extraHeaders
    });
    res.writeHead(statusCode);
    res.end(body);
}

function serveStatic(req, res, filePath) {
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                applySecurityHeaders(res, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
                res.writeHead(404);
                res.end('Not found');
            } else {
                logSecurity(`File read error for ${filePath}`);
                applySecurityHeaders(res, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
                res.writeHead(500);
                res.end('Server error');
            }
            return;
        }

        const acceptEncoding = req.headers['accept-encoding'] || '';
        const shouldCompress = /gzip/.test(acceptEncoding) && /\.(html|css|js|json|svg|txt)$/i.test(filePath);
        let responseBody = content;
        let headers = {
            'Content-Type': getContentType(filePath),
            'Cache-Control': 'no-store'
        };

        if (shouldCompress) {
            responseBody = zlib.gzipSync(content);
            headers['Content-Encoding'] = 'gzip';
            headers['Vary'] = 'Accept-Encoding';
        }

        applySecurityHeaders(res, headers);
        res.writeHead(200);
        res.end(responseBody);
    });
}

function resolveSafePath(requestPath) {
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\//, '');
    const normalized = path.normalize(path.resolve(rootDir, relativePath));
    const rootPrefix = path.normalize(rootDir + path.sep);
    if (!normalized.startsWith(rootPrefix) && normalized !== rootDir) {
        return null;
    }
    return normalized;
}

function handleApiVotes(req, res) {
    if (req.method === 'OPTIONS') {
        applySecurityHeaders(res, {
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
            'Access-Control-Allow-Credentials': 'true',
            'Cache-Control': 'no-store'
        });
        res.writeHead(204);
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
        sendJson(res, 200, { votes, counts, totalVotes: votes.length });
        return;
    }

    if (req.method === 'POST') {
        const origin = getOrigin(req);
        if (origin && !isAllowedOrigin(req)) {
            logSecurity(`Blocked disallowed origin ${origin}`);
            sendJson(res, 403, { error: 'Forbidden origin' });
            return;
        }

        const token = getCsrfToken(req);
        if (!token) {
            logSecurity(`Missing CSRF token for ${req.method} ${req.url}`);
            sendJson(res, 403, { error: 'Invalid request' });
            return;
        }

        readJsonBody(req, (error, parsed) => {
            if (error) {
                logSecurity(`Invalid JSON body for ${req.method} ${req.url}`);
                sendJson(res, 400, { error: 'Invalid request body' });
                return;
            }

            const choice = typeof parsed.choice === 'string' ? parsed.choice.trim() : '';
            if (!validChoices.includes(choice)) {
                logSecurity(`Invalid vote choice ${String(choice)}`);
                sendJson(res, 400, { error: 'Invalid vote choice' });
                return;
            }

            const reason = sanitizeText(parsed.reason, 500);
            const timestamp = typeof parsed.timestamp === 'string' && parsed.timestamp.trim() ? parsed.timestamp : new Date().toISOString();
            const vote = {
                choice,
                reason,
                timestamp
            };

            const votes = readVotes();
            votes.push(vote);
            writeVotes(votes);
            sendJson(res, 201, { success: true, vote });
        });
        return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
}

ensureDataFiles();

const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (rateLimit(req, res)) {
        return;
    }

    if (enforceHttps(req, res)) {
        return;
    }

    if (requestUrl.pathname === '/api/votes') {
        handleApiVotes(req, res);
        return;
    }

    if (requestUrl.pathname === '/api/csrf-token') {
        if (req.method === 'GET') {
            const token = crypto.createHash('sha256').update(`${csrfSecret}:${Date.now()}`).digest('hex');
            csrfTokens.set(token, Date.now());
            const host = req.headers.host || '';
            const origin = getOrigin(req);
            if (origin && !isAllowedOrigin(req)) {
                logSecurity(`Blocked disallowed origin ${origin}`);
                sendJson(res, 403, { error: 'Forbidden origin' });
                return;
            }
            setCsrfCookie(res, token, host);
            sendJson(res, 200, { token });
            return;
        }
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const safePath = resolveSafePath(requestUrl.pathname);
    if (!safePath) {
        logSecurity(`Blocked path traversal attempt ${requestUrl.pathname}`);
        applySecurityHeaders(res, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        serveStatic(req, res, safePath);
        return;
    }

    const fallbackPath = path.join(rootDir, 'index.html');
    serveStatic(req, res, fallbackPath);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
    console.log(`Secure server running at http://0.0.0.0:${port}`);
});
