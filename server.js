const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const GEMINI_API_KEY = 'AIzaSyB6NWoUawgPPxRquR6k9zcEd2GsnWKN_yk';
// Using gemini-flash-latest which matches the listModels output for this key
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.json': 'application/json'
};

const server = http.createServer(async (req, res) => {
    // Handle All CORS and Preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Bulletproof Proxy Logic
    const urlPath = req.url.split('?')[0];
    if (urlPath.includes('/api/chat')) {
        console.log(`[AI Proxy] Processing ${req.method} request to ${urlPath}`);

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const response = await fetch(GEMINI_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: body
                });

                const data = await response.json();
                console.log(`[AI Proxy] Gemini responded with status: ${response.status}`);

                res.writeHead(response.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(data));
            } catch (error) {
                console.error('[AI Proxy] Critical Error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '[Server] AI connection failed. Check terminal.' }));
            }
        });
        return;
    }

    // Static File Serving
    let filePath = '.' + req.url;
    if (filePath === './' || filePath === '.') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            console.log(`[Static] 404 Not Found: ${filePath}`);
            res.writeHead(404);
            res.end('404 File Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n🚀 Novachat AI Server is LIVE!`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`Press Ctrl+C to stop.\n`);
});
