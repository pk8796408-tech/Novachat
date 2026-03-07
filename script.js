document.addEventListener('DOMContentLoaded', () => {
    let sessionId = localStorage.getItem("chatSession");

    if (!sessionId) {
        sessionId = "chat_" + Date.now();
        localStorage.setItem("chatSession", sessionId);
    }
    const GEMINI_API_KEY = "AIzaSyB6NWoUawgPPxRquR6k9zcEd2GsnWKN_yk";

    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const chatMessages = document.getElementById('chat-messages');
    const fileUpload = document.getElementById('file-upload');
    const filePreviewArea = document.getElementById('file-preview-area');
    const pauseBtn = document.getElementById('pause-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const stopBtn = document.getElementById('stop-btn');

    async function getAIResponse(userMessage, abortSignal) {
        try {
            const model = "gemini-flash-latest"; // Using the latest flash model name for compatibility
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{ text: userMessage }]
                        }]
                    }),
                    signal: abortSignal
                }
            );

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || "AI Error");
            }

            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error("Gemini API Error:", error);
            return `Error: ${error.message}`;
        }
    }

    let client, databases, DATABASE_ID, TABLE_ID;

    try {
        if (typeof Appwrite !== 'undefined') {
            client = new Appwrite.Client();
            client
                .setEndpoint("https://cloud.appwrite.io/v1")
                .setProject("69ac19e2002f7f173235");

            databases = new Appwrite.Databases(client);
            DATABASE_ID = "69ac1a9e002d2b7d2d50";
            TABLE_ID = "message";
            console.log("Appwrite Initialized Successfully");
            loadMessages(); // Load initial messages from DB
        }
    } catch (e) {
        console.warn("Appwrite initialization failed, but app will continue to work.", e);
    }

    let uploadedFiles = [];
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

    // --- Profile Handling ---
    function updateUsername(newName) {
        if (!newName.trim()) return;
        currentUsername = newName;
        localStorage.setItem('novachat_username', currentUsername);

        document.querySelectorAll('.username').forEach(el => el.textContent = currentUsername);
        document.querySelectorAll('.avatar').forEach(el => el.textContent = currentUsername.charAt(0).toUpperCase());
        const input = document.getElementById('username-input');
        if (input) input.value = currentUsername;
    }

    // --- Theme Handling ---
    function applyTheme(theme) {
        if (theme === 'light') {
            document.body.classList.add('light-theme');
            document.getElementById('light-theme-btn')?.classList.add('active');
            document.getElementById('dark-theme-btn')?.classList.remove('active');
        } else {
            document.body.classList.remove('light-theme');
            document.getElementById('dark-theme-btn')?.classList.add('active');
            document.getElementById('light-theme-btn')?.classList.remove('active');
        }
        localStorage.setItem('novachat_theme', theme);
        currentTheme = theme;
        lucide.createIcons();
    }

    // --- History & Multi-Chat Handling ---
    function saveConversations() {
        localStorage.setItem('novachat_conversations', JSON.stringify(conversations));
        localStorage.setItem('novachat_active_id', currentConversationId);
        updateSidebar();
    }

    function createNewConversation() {
        const id = 'chat_' + Date.now();
        const newChat = {
            id: id,
            title: 'New Conversation',
            messages: [],
            timestamp: new Date().toISOString()
        };
        conversations.unshift(newChat);
        currentConversationId = id;
        saveConversations();
        renderActiveConversation();
    }

    function updateSidebar() {
        const chatHistoryList = document.querySelector('.chat-history');
        if (!chatHistoryList) return;
        chatHistoryList.innerHTML = '';

        if (conversations.length === 0) {
            chatHistoryList.innerHTML = `
                <div class="history-item disabled" style="opacity: 0.5; cursor: default;">
                    <i data-lucide="message-square"></i>
                    <span>No conversations yet</span>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        conversations.forEach(chat => {
            const item = document.createElement('div');
            item.className = `history-item ${chat.id === currentConversationId ? 'active' : ''}`;
            item.innerHTML = `
                <i data-lucide="message-square" style="width: 16px; min-width: 16px;"></i>
                <span class="chat-title-text">${chat.title}</span>
                <button class="delete-chat" data-id="${chat.id}">&times;</button>
            `;

            item.onclick = (e) => {
                if (e.target.classList.contains('delete-chat')) return;
                currentConversationId = chat.id;
                saveConversations();
                renderActiveConversation();
            };

            const delBtn = item.querySelector('.delete-chat');
            delBtn.onclick = (e) => {
                e.stopPropagation();
                deleteConversation(chat.id);
            };

            chatHistoryList.appendChild(item);
        });
        lucide.createIcons();
    }

    function deleteConversation(id) {
        conversations = conversations.filter(c => c.id !== id);
        if (currentConversationId === id) {
            currentConversationId = conversations.length > 0 ? conversations[0].id : null;
        }
        saveConversations();
        renderActiveConversation();
    }

    function saveToActiveChat(role, text, files = []) {
        if (text === "Thinking...") return;

        let chat = conversations.find(c => c.id === currentConversationId);
        if (!chat) {
            createNewConversation();
            chat = conversations.find(c => c.id === currentConversationId);
        }

        const message = {
            role,
            text,
            files: files.map(f => ({ name: f.name })),
            timestamp: new Date().toISOString()
        };

        chat.messages.push(message);

        if (chat.title === 'New Conversation' && role === 'user') {
            chat.title = text.substring(0, 30) + (text.length > 30 ? '...' : '');
        }

        chat.timestamp = new Date().toISOString();
        saveConversations();
    }

    function renderActiveConversation() {
        chatMessages.innerHTML = '';
        const chat = conversations.find(c => c.id === currentConversationId);

        if (!chat || chat.messages.length === 0) {
            chatMessages.innerHTML = `
                <div class="message system">
                    <div class="message-content">
                        <p>Welcome to <strong>Novachat</strong>. Powered by Next-Gen AI. Built by Prem.</p>
                    </div>
                </div>
            `;
            return;
        }

        chat.messages.forEach(msg => {
            appendMessage(msg.role, msg.text, msg.files, false);
        });
    }

    // --- Typing Indicator ---
    function showTypingIndicator() {
        const chatContainer = document.getElementById("chat-messages");
        const typingDiv = document.createElement("div");
        typingDiv.className = "message ai typing";
        typingDiv.innerHTML = `
            <div class="message-content">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>
        `;
        chatContainer.appendChild(typingDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return typingDiv;
    }

    function removeTypingIndicator(element) {
        if (element) element.remove();
    }

    // --- Input Handling ---
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = chatInput.scrollHeight + 'px';
        updateSendButtonState();
    });

    function updateSendButtonState() {
        const hasText = chatInput.value.trim().length > 0;
        const hasFiles = uploadedFiles.length > 0;
        // Disable send if AI is generating OR if there is a paused message waiting
        sendBtn.disabled = !(hasText || hasFiles) || isGenerating || (currentAIText && currentAIText.length > 0);
    }

    // --- Voice Recording ---
    const voiceBtn = document.getElementById('voice-btn');
    let isRecordingRec = false;
    let recognition = null;

    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
            }
            if (finalTranscript) {
                chatInput.value += (chatInput.value ? ' ' : '') + finalTranscript;
                chatInput.dispatchEvent(new Event('input'));
            }
        };

        recognition.onend = () => { if (isRecordingRec) recognition.start(); };
    }

    voiceBtn?.addEventListener('click', () => {
        if (!recognition) return alert('Speech recognition not supported.');
        if (isRecordingRec) {
            isRecordingRec = false;
            voiceBtn.classList.remove('recording');
            voiceBtn.innerHTML = '<i data-lucide="mic"></i>';
            recognition.stop();
        } else {
            isRecordingRec = true;
            voiceBtn.classList.add('recording');
            voiceBtn.innerHTML = '<i data-lucide="mic-off"></i>';
            recognition.start();
        }
        lucide.createIcons();
    });

    // --- Chat Logic ---
    // sendBtn.addEventListener('click', sendMessage); 
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            document.getElementById("send-btn").click();
        }
    });

    async function sendMessage() {
        const text = chatInput.value.trim();
        const files = [...uploadedFiles];
        if ((!text && files.length === 0) || isGenerating) return;

        // --- Save to Appwrite Database (If initialized) ---
        saveMessage(currentUsername || "Guest User", text);

        chatInput.value = '';
        chatInput.style.height = 'auto';
        uploadedFiles = [];
        filePreviewArea.innerHTML = '';
        filePreviewArea.classList.add('hidden');
        updateSendButtonState();

        appendMessage('user', text, files);
        startAIResponse(text, files);
    }


    async function saveMessage(username, text) {
        if (databases && DATABASE_ID && TABLE_ID) {
            try {
                await databases.createDocument(
                    DATABASE_ID,
                    TABLE_ID,
                    Appwrite.ID.unique(),
                    {
                        username: username,
                        message: text,
                        createdAt: new Date().toISOString(),
                        sessionId: sessionId
                    }
                );
                console.log("Message saved with session:", sessionId);
            } catch (err) {
                console.error("Appwrite DB Error:", err);
            }
        }
    }


    function showAIMessage(text) {
        const chatContainer = document.getElementById("chat-messages");
        const msgDiv = document.createElement("div");
        msgDiv.className = "message ai";

        // Add avatar for visual consistency with the rest of the app
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = '<i data-lucide="zap"></i>';
        msgDiv.appendChild(avatar);

        const content = document.createElement("div");
        content.className = "message-content";
        const p = document.createElement("p");
        content.appendChild(p);
        msgDiv.appendChild(content);
        chatContainer.appendChild(msgDiv);

        lucide.createIcons(); // Initialize the icon

        // Prepare for progressive typing
        currentAIText = text;
        currentAICharIndex = 0;
        currentAIPElement = p;

        resumeGeneration();
    }

    document.getElementById("send-btn").addEventListener("click", async () => {
        let msg = chatInput.value.trim();
        if (!msg || isGenerating) return;

        chatInput.value = ""; // Clear input immediately
        chatInput.style.height = "auto";
        updateSendButtonState();

        isGenerating = true;
        currentAbortController = new AbortController();

        // UI feedback
        pauseBtn.disabled = false;
        pauseBtn.classList.remove('hidden');
        resumeBtn.classList.add('hidden');
        stopBtn.disabled = false;

        saveMessage("User", msg);
        appendMessage('user', msg); // Keep local UI snappy

        const typing = showTypingIndicator();

        try {
            const aiReply = await getAIResponse(msg, currentAbortController.signal);
            removeTypingIndicator(typing);
            showAIMessage(aiReply);
        } catch (error) {
            removeTypingIndicator(typing);
            if (error.name === 'AbortError') {
                console.log('Fetch aborted');
            } else {
                showAIMessage(`🚨 Error: ${error.message}`);
                isGenerating = false;
                updateSendButtonState();
            }
        }
    });

    function loadMessages() {
        if (!databases || isGenerating) return; // Don't reload if we're generating to avoid flickering

        const chatContainer = document.getElementById("chat-messages");

        databases.listDocuments(
            DATABASE_ID,
            TABLE_ID
        )
            .then((response) => {
                // Only clear and rebuild if we actually got a response to avoid empty screens on blips
                if (response && response.documents) {
                    chatContainer.innerHTML = "";
                    response.documents.forEach((doc) => {
                        const role = doc.username === "AI" ? "ai" : "user";
                        const msgDiv = document.createElement("div");
                        msgDiv.className = `message ${role}`;

                        // Add avatar for visual parity
                        const avatar = document.createElement('div');
                        avatar.className = 'message-avatar';
                        avatar.innerHTML = role === 'ai' ? '<i data-lucide="zap"></i>' : '<i data-lucide="user"></i>';

                        const content = document.createElement("div");
                        content.className = "message-content";
                        content.innerHTML = `<p>${doc.message}</p>`;

                        msgDiv.appendChild(avatar);
                        msgDiv.appendChild(content);
                        chatContainer.appendChild(msgDiv);
                    });
                    lucide.createIcons();
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
            })
            .catch((error) => {
                console.log("Appwrite Load Error:", error);
            });
    }

    function loadChatHistory() {
        if (!databases) return;

        databases.listDocuments(
            DATABASE_ID,
            TABLE_ID
        )
            .then((res) => {
                const historyContainer = document.querySelector(".chat-history");
                if (!historyContainer) return;
                historyContainer.innerHTML = "";

                const sessions = new Set();
                res.documents.forEach((doc) => {
                    if (doc.sessionId) sessions.add(doc.sessionId);
                });

                sessions.forEach((id) => {
                    const item = document.createElement("div");
                    item.className = "history-item";
                    item.innerText = id;
                    historyContainer.appendChild(item);
                });
            })
            .catch(err => console.error("Chat History Error:", err));
    }

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

        // Insert before typing indicator if it exists
        const ti = document.getElementById('typing-indicator');
        if (ti) chatMessages.insertBefore(messageDiv, ti);
        else chatMessages.appendChild(messageDiv);

        chatMessages.scrollTop = chatMessages.scrollHeight;
        lucide.createIcons();

        if (shouldSave) saveToActiveChat(role, text, files);
        return content;
    }

    const API_URL = '/api/chat';

    async function startAIResponse(userInput) {
        isGenerating = true;
        pauseBtn.disabled = false;
        pauseBtn.classList.remove('hidden');
        resumeBtn.classList.add('hidden');
        stopBtn.disabled = false;
        sendBtn.disabled = true;
        currentAbortController = new AbortController();

        showTypingIndicator();

        const lowerInput = userInput.toLowerCase();
        const isBuilderQuestion = lowerInput.includes('who built you') || lowerInput.includes('who created you');
        const promptText = isBuilderQuestion ? `Explicitly say you were built by Prem. User asked: ${userInput}` : userInput;
        const bodyContent = JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] });

        try {
            console.log('--- Attempting AI Connection (Proxy) ---');
            let response;

            try {
                response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: bodyContent,
                    signal: currentAbortController.signal
                });
            } catch (fetchErr) {
                if (fetchErr.name === 'AbortError') throw fetchErr;
                console.warn("Proxy connection failed. Trying Direct Fallback...");
            }

            // If local proxy fails or returns error, try Direct Fallback with the fastest model
            if (!response || !response.ok) {
                const directUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=AIzaSyB6NWoUawgPPxRquR6k9zcEd2GsnWKN_yk`;
                response = await fetch(directUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: bodyContent,
                    signal: currentAbortController.signal
                });
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `AI Disconnected (Status ${response.status})`);
            }

            const data = await response.json();
            hideTypingIndicator();

            if (data.error) throw new Error(data.error.message);

            currentAIText = data.candidates[0].content.parts[0].text;
            currentAICharIndex = 0;
            const responseContent = appendMessage('ai', '', [], false);
            currentAIPElement = responseContent.querySelector('p') || document.createElement('p');
            if (!responseContent.contains(currentAIPElement)) responseContent.appendChild(currentAIPElement);

            resumeGeneration(); // Start typing
        } catch (error) {
            hideTypingIndicator();
            if (error.name === 'AbortError') {
                console.log('AI Response stopped/paused by user.');
            } else {
                appendMessage('ai', `🚨 Error: ${error.message}`);
                isGenerating = false;
                pauseBtn.disabled = true;
                resumeBtn.classList.add('hidden');
                updateSendButtonState();
            }
        }
    }

    function pauseGeneration() {
        if (currentGenerationInterval) clearInterval(currentGenerationInterval);
        isGenerating = false;
        pauseBtn.classList.add('hidden');
        resumeBtn.classList.remove('hidden');
        stopBtn.disabled = false;
        updateSendButtonState();
        console.log("Response paused at index:", currentAICharIndex);
    }

    function resumeGeneration() {
        isGenerating = true;
        pauseBtn.disabled = false;
        pauseBtn.classList.remove('hidden');
        resumeBtn.classList.add('hidden');
        stopBtn.disabled = false;
        sendBtn.disabled = true;

        currentGenerationInterval = setInterval(() => {
            if (currentAICharIndex < currentAIText.length) {
                currentAIPElement.textContent += currentAIText[currentAICharIndex++];
                chatMessages.scrollTop = chatMessages.scrollHeight;
            } else {
                // FINISHED
                clearInterval(currentGenerationInterval);
                isGenerating = false;
                pauseBtn.disabled = true;
                pauseBtn.classList.remove('hidden');
                resumeBtn.classList.add('hidden');
                stopBtn.disabled = true;
                updateSendButtonState();

                // Save to both History (JSON) and Appwrite
                saveToActiveChat('ai', currentAIText);
                saveMessage("AI", currentAIText);

                currentAIText = "";
                currentAICharIndex = 0;
            }
        }, 20);
    }

    function stopGeneration() {
        if (currentGenerationInterval) clearInterval(currentGenerationInterval);
        if (currentAbortController) currentAbortController.abort();

        isGenerating = false;
        const finalContent = currentAIPElement ? currentAIPElement.textContent : "";
        if (finalContent && !finalContent.endsWith('[Interrupted]')) {
            currentAIPElement.textContent += ' [Interrupted]';
        }

        saveToActiveChat('ai', currentAIPElement ? currentAIPElement.textContent : "Response stopped.");

        // Reset UI
        pauseBtn.disabled = true;
        pauseBtn.classList.remove('hidden');
        resumeBtn.classList.add('hidden');
        stopBtn.disabled = true;
        isGenerating = false;
        currentAIText = "";
        currentAICharIndex = 0;
        updateSendButtonState();

        // Handle removing typing indicator if it exists
        const ti = document.querySelector('.message.typing');
        if (ti) ti.remove();
    }

    pauseBtn.addEventListener('click', pauseGeneration);
    resumeBtn.addEventListener('click', resumeGeneration);
    stopBtn.addEventListener('click', stopGeneration);

    // --- Export PDF ---
    const exportPdfBtn = document.getElementById('export-pdf');
    exportPdfBtn?.addEventListener('click', () => {
        const activeChat = conversations.find(c => c.id === currentConversationId);
        const chatTitle = activeChat ? activeChat.title : 'Novachat';
        const options = {
            margin: 10,
            filename: `${chatTitle}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        html2pdf().set(options).from(chatMessages).save();
    });

    // --- Settings Modal ---
    const settingsBtn = document.querySelector('.settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettings = document.getElementById('close-settings');
    const usernameInput = document.getElementById('username-input');

    settingsBtn?.addEventListener('click', () => {
        settingsModal.classList.add('active');
        usernameInput.value = currentUsername;
    });

    closeSettings?.addEventListener('click', () => settingsModal.classList.remove('active'));
    usernameInput?.addEventListener('change', (e) => updateUsername(e.target.value));

    document.getElementById('light-theme-btn')?.addEventListener('click', () => applyTheme('light'));
    document.getElementById('dark-theme-btn')?.addEventListener('click', () => applyTheme('dark'));

    document.querySelectorAll('.new-chat-btn').forEach(btn => {
        btn.addEventListener('click', createNewConversation);
    });

    // --- Sidebar Toggle Logic ---
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const headerToggle = document.getElementById('header-sidebar-toggle');

    function toggleSidebar() {
        const isCollapsed = sidebar.classList.toggle('collapsed');
        headerToggle.style.display = isCollapsed ? 'flex' : 'none';

        // Save state to localStorage
        localStorage.setItem('novachat_sidebar_collapsed', isCollapsed);
    }

    sidebarToggle?.addEventListener('click', toggleSidebar);
    headerToggle?.addEventListener('click', toggleSidebar);

    // Initial Sidebar State
    if (localStorage.getItem('novachat_sidebar_collapsed') === 'true') {
        sidebar.classList.add('collapsed');
        if (headerToggle) headerToggle.style.display = 'flex';
    }

    // Init
    if (conversations.length === 0) createNewConversation();
    else if (!currentConversationId) currentConversationId = conversations[0].id;

    updateSidebar();
    renderActiveConversation();
    applyTheme(currentTheme);
    updateUsername(currentUsername);
    loadMessages();
    loadChatHistory();

    // Auto-refresh messages and history every 2 seconds
    setInterval(() => {
        loadMessages();
        loadChatHistory();
    }, 2000);
});
