document.addEventListener('DOMContentLoaded', () => {
    let sessionId = localStorage.getItem("chatSession") || ("chat_" + Date.now());
    localStorage.setItem("chatSession", sessionId);

    // DOM Elements
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const chatMessages = document.getElementById('chat-messages');
    const fileUpload = document.getElementById('file-upload');
    const filePreviewArea = document.getElementById('file-preview-area');
    const pauseBtn = document.getElementById('pause-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const stopBtn = document.getElementById('stop-btn');
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const headerToggle = document.getElementById('header-sidebar-toggle');

    // App State
    let isGenerating = false;
    let currentGenerationInterval = null;
    let currentAbortController = null;
    let currentAIText = "";
    let currentAICharIndex = 0;
    let currentAIPElement = null;
    let conversations = JSON.parse(localStorage.getItem('novachat_conversations')) || [];
    let currentConversationId = localStorage.getItem('novachat_active_id') || null;
    let currentUsername = localStorage.getItem('novachat_username') || 'Guest User';
    let currentTheme = localStorage.getItem('novachat_theme') || 'dark';
    let uploadedFiles = [];

    // --- Appwrite Logic (Resilient) ---
    let client, databases, DATABASE_ID, TABLE_ID;
    try {
        if (typeof Appwrite !== 'undefined') {
            client = new Appwrite.Client()
                .setEndpoint("https://cloud.appwrite.io/v1")
                .setProject("69ac19e2002f7f173235");
            databases = new Appwrite.Databases(client);
            DATABASE_ID = "69ac1a9e002d2b7d2d50";
            TABLE_ID = "message";
            console.log("🚀 Appwrite Initialized");
        }
    } catch (e) {
        console.warn("⚠️ Appwrite optional features disabled.", e);
    }

    // --- Core Chat Logic ---

    async function handleSendMessage() {
        const userInput = chatInput.value.trim();
        if (!userInput || isGenerating) return;

        // Reset Input
        chatInput.value = '';
        chatInput.style.height = 'auto';
        updateSendButtonState();

        // UI State
        isGenerating = true;
        currentAbortController = new AbortController();
        updateActionButtons(true);

        // Append User Message
        appendMessage('user', userInput);
        saveToDB(currentUsername, userInput);

        // Show Typing
        const typingIndicator = showTypingIndicator();

        try {
            // Check if we are running on a server or local file
            if (window.location.protocol === 'file:') {
                throw new Error("Novachat must be run via the server. Please open http://localhost:3000 in your browser, not the index.html file directly.");
            }

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: userInput }] }]
                }),
                signal: currentAbortController.signal
            });

            removeTypingIndicator(typingIndicator);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                if (response.status === 401) {
                    throw new Error("Missing API Key. Please add your GEMINI_API_KEY to the .env file and restart the server.");
                }
                throw new Error(errorData.error?.message || `Server Error (${response.status})`);
            }

            const data = await response.json();
            const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm sorry, I couldn't generate a response.";

            startTypingEffect(aiReply);

        } catch (error) {
            removeTypingIndicator(typingIndicator);
            if (error.name === 'AbortError') {
                console.log("Generation stopped by user.");
            } else {
                console.error("Chat Error:", error);
                const errorMsg = error.message.includes('Failed to fetch')
                    ? "Failed to connect to server. Is 'node server.js' running at http://localhost:3000?"
                    : error.message;
                appendMessage('ai', `🚨 ${errorMsg}`);
                resetUIAfterGeneration();
            }
        }
    }

    function startTypingEffect(text) {
        isGenerating = true;
        currentAIText = text;
        currentAICharIndex = 0;

        const contentDiv = appendMessage('ai', '', [], false);
        currentAIPElement = document.createElement('p');
        contentDiv.appendChild(currentAIPElement);

        resumeGeneration();
    }

    function resumeGeneration() {
        isGenerating = true;
        updateActionButtons(true, false); // generating, not paused

        currentGenerationInterval = setInterval(() => {
            if (currentAICharIndex < currentAIText.length) {
                currentAIPElement.textContent += currentAIText[currentAICharIndex++];
                chatMessages.scrollTop = chatMessages.scrollHeight;
            } else {
                finishGeneration();
            }
        }, 20);
    }

    function pauseGeneration() {
        if (currentGenerationInterval) clearInterval(currentGenerationInterval);
        isGenerating = false;
        updateActionButtons(true, true); // generating, is paused
    }

    function stopGeneration() {
        if (currentGenerationInterval) clearInterval(currentGenerationInterval);
        if (currentAbortController) currentAbortController.abort();

        if (currentAIPElement && currentAICharIndex < currentAIText.length) {
            currentAIPElement.textContent += " [Interrupted]";
        }

        finishGeneration(true);
    }

    function finishGeneration(interrupted = false) {
        if (currentGenerationInterval) clearInterval(currentGenerationInterval);

        const finalContent = currentAIPElement ? currentAIPElement.textContent : "";
        if (finalContent) {
            saveToActiveChat('ai', finalContent);
            saveToDB("AI", finalContent);
        }

        resetUIAfterGeneration();
    }

    function resetUIAfterGeneration() {
        isGenerating = false;
        currentAIText = "";
        currentAICharIndex = 0;
        currentAIPElement = null;
        updateActionButtons(false);
        updateSendButtonState();

        const typing = document.querySelector('.message.typing');
        if (typing) typing.remove();
    }

    function updateActionButtons(active, paused = false) {
        pauseBtn.disabled = !active || paused;
        pauseBtn.classList.toggle('hidden', paused || !active);

        resumeBtn.disabled = !paused;
        resumeBtn.classList.toggle('hidden', !paused);

        stopBtn.disabled = !active;
        sendBtn.disabled = active;
    }

    // --- Helper Functions ---

    function appendMessage(role, text, files = [], shouldSave = true) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = role === 'user' ? '<i data-lucide="user"></i>' : '<i data-lucide="zap"></i>';

        const content = document.createElement('div');
        content.className = 'message-content';

        if (text) {
            const p = document.createElement('p');
            p.textContent = text;
            content.appendChild(p);
        }

        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        lucide.createIcons();

        if (shouldSave) saveToActiveChat(role, text, files);
        return content;
    }

    function showTypingIndicator() {
        const typingDiv = document.createElement("div");
        typingDiv.className = "message ai typing";
        typingDiv.innerHTML = `
            <div class="message-avatar"><i data-lucide="zap"></i></div>
            <div class="message-content">
                <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            </div>
        `;
        chatMessages.appendChild(typingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        lucide.createIcons();
        return typingDiv;
    }

    function removeTypingIndicator(el) {
        if (el) el.remove();
    }

    async function saveToDB(username, message) {
        if (!databases || typeof Appwrite === 'undefined') return;
        try {
            await databases.createDocument(DATABASE_ID, TABLE_ID, Appwrite.ID.unique(), {
                username, message, createdAt: new Date().toISOString(), sessionId
            });
        } catch (err) { console.error("DB Save Error:", err); }
    }

    function updateSendButtonState() {
        sendBtn.disabled = chatInput.value.trim().length === 0 || isGenerating;
    }

    // --- UI Event Listeners ---

    sendBtn.addEventListener('click', handleSendMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = chatInput.scrollHeight + 'px';
        updateSendButtonState();
    });

    pauseBtn.addEventListener('click', pauseGeneration);
    resumeBtn.addEventListener('click', resumeGeneration);
    stopBtn.addEventListener('click', stopGeneration);

    // --- Sidebar & Profile ---

    function toggleSidebar() {
        const isCollapsed = sidebar.classList.toggle('collapsed');
        headerToggle.style.display = isCollapsed ? 'flex' : 'none';
        localStorage.setItem('novachat_sidebar_collapsed', isCollapsed);
    }

    sidebarToggle?.addEventListener('click', toggleSidebar);
    headerToggle?.addEventListener('click', toggleSidebar);

    function updateUsername(newName) {
        if (!newName.trim()) return;
        currentUsername = newName;
        localStorage.setItem('novachat_username', currentUsername);
        document.querySelectorAll('.username').forEach(el => el.textContent = currentUsername);
        document.querySelectorAll('.avatar').forEach(el => el.textContent = currentUsername.charAt(0).toUpperCase());
    }

    // --- Initialization ---

    function init() {
        if (conversations.length === 0) createNewConversation();
        else if (!currentConversationId) currentConversationId = conversations[0].id;

        updateSidebar();
        renderActiveConversation();
        applyTheme(currentTheme);
        updateUsername(currentUsername);

        if (localStorage.getItem('novachat_sidebar_collapsed') === 'true') {
            sidebar.classList.add('collapsed');
            headerToggle.style.display = 'flex';
        }

        // Voice Support
        setupVoice();
    }

    // Legacy support for these functions referenced in init
    function createNewConversation() {
        const id = 'chat_' + Date.now();
        conversations.unshift({ id, title: 'New Conversation', messages: [], timestamp: new Date().toISOString() });
        currentConversationId = id;
        saveConversations();
        renderActiveConversation();
    }

    function saveConversations() {
        localStorage.setItem('novachat_conversations', JSON.stringify(conversations));
        localStorage.setItem('novachat_active_id', currentConversationId);
        updateSidebar();
    }

    function renderActiveConversation() {
        chatMessages.innerHTML = '';
        const chat = conversations.find(c => c.id === currentConversationId);
        if (!chat || chat.messages.length === 0) {
            appendMessage('system', 'Welcome to Novachat. Powered by AI. Built by Prem.', [], false);
            return;
        }
        chat.messages.forEach(msg => appendMessage(msg.role, msg.text, msg.files, false));
    }

    function updateSidebar() {
        const list = document.querySelector('.chat-history');
        if (!list) return;
        list.innerHTML = '';
        conversations.forEach(chat => {
            const item = document.createElement('div');
            item.className = `history-item ${chat.id === currentConversationId ? 'active' : ''}`;
            item.innerHTML = `<i data-lucide="message-square"></i><span class="chat-title-text">${chat.title}</span><button class="delete-chat">&times;</button>`;
            item.onclick = (e) => {
                if (e.target.classList.contains('delete-chat')) {
                    conversations = conversations.filter(c => c.id !== chat.id);
                    if (currentConversationId === chat.id) currentConversationId = conversations[0]?.id || null;
                    saveConversations();
                    renderActiveConversation();
                    return;
                }
                currentConversationId = chat.id;
                saveConversations();
                renderActiveConversation();
            };
            list.appendChild(item);
        });
        lucide.createIcons();
    }

    function saveToActiveChat(role, text, files = []) {
        const chat = conversations.find(c => c.id === currentConversationId);
        if (chat) {
            chat.messages.push({ role, text, timestamp: new Date().toISOString() });
            if (chat.title === 'New Conversation' && role === 'user') {
                chat.title = text.substring(0, 30) + (text.length > 30 ? '...' : '');
            }
            saveConversations();
        }
    }

    function applyTheme(theme) {
        document.body.classList.toggle('light-theme', theme === 'light');
        localStorage.setItem('novachat_theme', theme);
        currentTheme = theme;
    }

    document.getElementById('light-theme-btn')?.addEventListener('click', () => applyTheme('light'));
    document.getElementById('dark-theme-btn')?.addEventListener('click', () => applyTheme('dark'));
    document.querySelector('.new-chat-btn')?.addEventListener('click', createNewConversation);

    const settingsBtn = document.querySelector('.settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    settingsBtn?.addEventListener('click', () => settingsModal.classList.add('active'));
    document.getElementById('close-settings')?.addEventListener('click', () => settingsModal.classList.remove('active'));
    document.getElementById('username-input')?.addEventListener('change', (e) => updateUsername(e.target.value));

    function setupVoice() {
        const voiceBtn = document.getElementById('voice-btn');
        if (!voiceBtn) return;
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.onresult = (e) => {
            chatInput.value = e.results[0][0].transcript;
            updateSendButtonState();
        };
        voiceBtn.onclick = () => {
            recognition.start();
            voiceBtn.classList.add('recording');
            setTimeout(() => voiceBtn.classList.remove('recording'), 3000);
        };
    }

    init();
});
