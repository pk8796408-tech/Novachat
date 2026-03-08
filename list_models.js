const GEMINI_API_KEY = 'AIzaSyD5k3lnU6lGQv2OHWBE8Zljez5ZNu3he0o';
// DO NOT LEAK YOUR KEY. Use .env instead.
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;

async function listModels() {
    try {
        const response = await fetch(url);
        const data = await response.json();
        console.log("Available Gemini Models:");
        if (data.models) {
            data.models.forEach(m => {
                const supportsGenerate = m.supportedGenerationMethods.includes('generateContent');
                console.log(`- ${m.name} [GenerateContent: ${supportsGenerate}]`);
            });
        } else {
            console.log("No models found or error extraing models list:", data);
        }
    } catch (error) {
        console.error("Error listing models:", error);
    }
}

listModels();
