const http = require('http');
const fs = require('fs');
const path = require('path');

// --- Dynamic Environment Loader ---
const envPath = path.join(__dirname, '.env');
function getLatestKey() {
    try {
        if (fs.existsSync(envPath)) {
            const envFile = fs.readFileSync(envPath, 'utf8');
            const lines = envFile.split('\n');
            for (let line of lines) {
                const [key, value] = line.split('=');
                if (key?.trim() === 'GEMINI_API_KEY' && value?.trim() !== 'YOUR_NEW_KEY_HERE') {
                    return value.trim();
                }
            }
        }
    } catch (e) {
        console.error("Error reading .env:", e);
    }
    return null;
}

const PORT = 3000;

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
        console.log(`[${new Date().toLocaleTimeString()}] 🤖 AI Request Received`);

        const apiKey = getLatestKey();

        // Check for valid API key
        if (!apiKey || apiKey === 'YOUR_NEW_KEY_HERE') {
            console.error("❌ Error: GEMINI_API_KEY is missing in .env");
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: "API Key Not Found! Please open the .env file and paste your Gemini API key. The server will detect it automatically once you save the file." } }));
            return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

                console.log(`[AI Proxy] Calling Gemini API...`);
                const response = await fetch(targetUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: body
                });

                const data = await response.json();

                if (!response.ok) {
                    console.error(`❌ Gemini API Error (${response.status}):`, data.error?.message || 'Unknown error');
                    res.writeHead(response.status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(data));
                    return;
                }

                console.log(`✅ Gemini Responded Successfully (Status: ${response.status})`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(data));

            } catch (error) {
                console.error('🔥 [AI Proxy] Critical Error:', error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: 'Connection to Gemini failed. Please check if your server machine has internet access.'
                    }
                }));
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
