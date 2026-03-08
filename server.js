const http = require('http');
const fs = require('fs');
const path = require('path');

// --- Get API Key ---
function getLatestKey() {

    // Railway / hosting environment variable
    if (process.env.GEMINI_API_KEY) {
        return process.env.GEMINI_API_KEY;
    }

    // Local .env file (for local testing)
    const envPath = path.join(__dirname, '.env');

    try {
        if (fs.existsSync(envPath)) {

            const envFile = fs.readFileSync(envPath, 'utf8');
            const lines = envFile.split('\n');

            for (let line of lines) {
                const [key, value] = line.split('=');

                if (key && value) {
                    if (key.trim() === 'GEMINI_API_KEY') {
                        return value.trim();
                    }
                }
            }
        }
    } catch (e) {
        console.error("Error reading .env:", e);
    }

    return null;
}

// Railway dynamic port
const PORT = process.env.PORT || 3000;

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

    // --- CORS ---
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const urlPath = req.url.split('?')[0];

    // --- AI CHAT API ---
    if (urlPath.includes('/api/chat')) {

        console.log(`[${new Date().toLocaleTimeString()}] 🤖 AI Request Received`);

        const apiKey = getLatestKey();

        if (!apiKey) {

            console.error("❌ GEMINI_API_KEY Missing");

            res.writeHead(401, { 'Content-Type': 'application/json' });

            res.end(JSON.stringify({
                error: {
                    message: "Missing API key. Add GEMINI_API_KEY in Railway Variables."
                }
            }));

            return;
        }

        let body = '';

        req.on('data', chunk => {
            body += chunk;
        });

        req.on('end', async () => {

            try {

                const targetUrl =
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

                console.log("⚡ Calling Gemini API...");

                const response = await fetch(targetUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: body
                });

                const data = await response.json();

                if (!response.ok) {

                    console.error("Gemini Error:", data);

                    res.writeHead(response.status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(data));

                    return;
                }

                console.log("✅ Gemini Response Success");

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(data));

            } catch (error) {

                console.error("🔥 Server Error:", error);

                res.writeHead(500, { 'Content-Type': 'application/json' });

                res.end(JSON.stringify({
                    error: {
                        message: "Failed to connect Gemini API."
                    }
                }));
            }

        });

        return;
    }

    // --- STATIC FILE SERVER ---
    let filePath = '.' + req.url;

    if (filePath === './' || filePath === '.') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {

        if (error) {

            console.log(`404 File: ${filePath}`);

            res.writeHead(404);
            res.end('404 File Not Found');

        } else {

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');

        }

    });

});

// IMPORTANT for Railway
server.listen(PORT, '0.0.0.0', () => {

    console.log(`\n🚀 Novachat AI Server is LIVE!`);
    console.log(`🌍 Running on Port: ${PORT}`);
    console.log(`Press Ctrl+C to stop\n`);

});
