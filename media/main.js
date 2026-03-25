/**
 * Synapse AI - Webview UI Controller
 * Handles all UI interactions and communication with the extension host
 */

(function() {
    const vscode = acquireVsCodeApi();
    
    // DOM Elements
    const chatContainer = document.getElementById('chat-container');
    const messageInput = document.getElementById('message-input');
    const btnSend = document.getElementById('btn-send');
    const btnModel = document.getElementById('btn-model');
    const btnIndex = document.getElementById('btn-index');
    const btnCleft = document.getElementById('btn-cleft');
    const btnAttach = document.getElementById('btn-attach');
    const agentSelect = document.getElementById('agent-select');
    const modelIndicator = document.getElementById('model-indicator');
    const contextInfo = document.getElementById('context-info');
    const welcomeMessage = document.getElementById('welcome-message');
    const autoIterateCheckbox = document.getElementById('auto-iterate');

    // State
    let isTyping = false;
    let currentResponse = '';
    let config = {};

    // Initialize
    function init() {
        setupEventListeners();
        requestConfig();
        setupInputAutoResize();
    }

    function setupEventListeners() {
        btnSend?.addEventListener('click', sendMessage);
        
        messageInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const prompt = btn.getAttribute('data-prompt');
                if (prompt) {
                    messageInput.value = prompt;
                    sendMessage();
                }
            });
        });

        btnModel?.addEventListener('click', () => vscode.postMessage({ type: 'switchModel' }));
        btnIndex?.addEventListener('click', () => {
            showStatus('Indexing codebase...');
            vscode.postMessage({ type: 'indexCodebase' });
        });
        btnCleft?.addEventListener('click', () => vscode.postMessage({ type: 'startCleft' }));
        btnAttach?.addEventListener('click', () => vscode.postMessage({ type: 'getCodeContext' }));

        agentSelect?.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                vscode.postMessage({ type: 'addCustomAgent' });
            }
        });

        autoIterateCheckbox?.addEventListener('change', (e) => {
            const task = messageInput.value || 'Continue autonomously';
            vscode.postMessage({
                type: e.target.checked ? 'startIteration' : 'stopIteration',
                task,
                checkpoints: ['initial']
            });
            showStatus(e.target.checked ? 'Auto-iteration enabled' : 'Auto-iteration stopped');
        });
    }

    function setupInputAutoResize() {
        if (!messageInput) return;
        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
        });
    }

    function sendMessage() {
        const content = messageInput.value.trim();
        if (!content || isTyping) return;

        if (welcomeMessage) welcomeMessage.style.display = 'none';
        addMessage('user', content);
        messageInput.value = '';
        messageInput.style.height = 'auto';
        showTypingIndicator();

        isTyping = true;
        currentResponse = '';
        vscode.postMessage({
            type: 'sendMessage',
            content,
            options: { agent: agentSelect?.value || 'auto' }
        });
    }

    function addMessage(role, content, actions = []) {
        const div = document.createElement('div');
        div.className = `message ${role}-message`;
        const avatar = role === 'user' ? '👤' : '⚡';
        const name = role === 'user' ? 'You' : 'Synapse';
        
        div.innerHTML = `
            <div class="message-header">
                <span class="message-avatar">${avatar}</span>
                <span>${name}</span>
            </div>
            <div class="message-content">${formatContent(content)}</div>
        `;

        if (actions.length > 0) {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'message-actions';
            actions.forEach(action => {
                const btn = document.createElement('button');
                btn.className = `action-btn ${action.secondary ? 'secondary' : ''}`;
                btn.textContent = action.label;
                btn.onclick = action.handler;
                actionsDiv.appendChild(btn);
            });
            div.appendChild(actionsDiv);
        }

        chatContainer.appendChild(div);
        scrollToBottom();
        return div;
    }

    function formatContent(content) {
        content = content.replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
        content = content.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => 
            `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`);
        content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
        content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        content = content.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        content = content.replace(/\n/g, '<br>');
        return content;
    }

    function showTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.id = 'typing-indicator';
        indicator.innerHTML = '<span></span><span></span><span></span>';
        chatContainer.appendChild(indicator);
        scrollToBottom();
    }

    function hideTypingIndicator() {
        document.getElementById('typing-indicator')?.remove();
    }

    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function requestConfig() {
        vscode.postMessage({ type: 'getConfig' });
    }

    function updateConfig(newConfig) {
        config = newConfig;
        if (modelIndicator) {
            const provider = newConfig.provider || 'openrouter';
            const model = newConfig.model?.split('/').pop() || 'claude';
            modelIndicator.textContent = `${provider}/${model}`;
        }
    }

    function showStatus(message) {
        const statusEl = document.querySelector('.agent-status span:last-child');
        if (statusEl) {
            const original = statusEl.textContent;
            statusEl.textContent = message;
            setTimeout(() => statusEl.textContent = original, 3000);
        }
    }

    function handleAgentStep(step) {
        const div = document.createElement('div');
        div.className = `agent-step ${step.type}-step`;
        
        const icons = {
            thought: '💭',
            action: '🔧',
            observation: '👁️',
            final: '✅'
        };
        const titles = {
            thought: 'Thinking',
            action: 'Action',
            observation: 'Result',
            final: 'Complete'
        };
        
        let content = step.content;
        if (step.type === 'action' && step.toolCall) {
            content = `Using tool: ${step.toolCall.name}`;
        }
        
        div.innerHTML = `
            <div class="step-header">
                <span class="step-icon">${icons[step.type] || '⚡'}</span>
                <span class="step-title">${titles[step.type] || 'Agent'}</span>
            </div>
            <div class="step-content">${formatContent(content)}</div>
        `;
        
        chatContainer.appendChild(div);
        scrollToBottom();
    }

    window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.type) {
            case 'config':
                updateConfig(msg.config);
                break;
            case 'configUpdated':
                updateConfig(msg.config);
                showStatus('Configuration updated');
                break;
            case 'responseStart':
                hideTypingIndicator();
                currentResponse = '';
                break;
            case 'responseChunk':
                currentResponse += msg.chunk;
                const lastMsg = chatContainer.querySelector('.ai-message:last-child');
                if (lastMsg && !lastMsg.querySelector('.message-actions')) {
                    lastMsg.querySelector('.message-content').innerHTML = formatContent(currentResponse);
                } else {
                    addMessage('ai', currentResponse);
                }
                scrollToBottom();
                break;
            case 'responseComplete':
                isTyping = false;
                hideTypingIndicator();
                break;
            case 'error':
                isTyping = false;
                hideTypingIndicator();
                const errDiv = document.createElement('div');
                errDiv.className = 'error-message';
                errDiv.textContent = `Error: ${msg.error}`;
                chatContainer.appendChild(errDiv);
                scrollToBottom();
                break;
            case 'agentStep':
                handleAgentStep(msg.step);
                break;
            case 'indexComplete':
                showStatus('Indexing complete!');
                break;
            case 'cleftStarted':
                showStatus('Cleft flow active');
                break;
            case 'cleftStopped':
                showStatus('Cleft flow stopped');
                break;
            case 'editApplied':
                showStatus(`Edit applied to ${msg.filePath}`);
                break;
            case 'terminalExecuted':
                showStatus('Command executed');
                break;
            case 'codeContext':
                if (msg.context && contextInfo) {
                    contextInfo.textContent = msg.context.filePath;
                }
                break;
            case 'historyCleared':
                chatContainer.innerHTML = '';
                if (welcomeMessage) {
                    welcomeMessage.style.display = 'block';
                    chatContainer.appendChild(welcomeMessage);
                }
                showStatus('History cleared');
                break;
        }
    });

    init();
})();
