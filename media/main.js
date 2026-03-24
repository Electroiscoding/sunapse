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
        // Send message
        btnSend?.addEventListener('click', sendMessage);
        
        messageInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Quick action buttons
        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const prompt = btn.getAttribute('data-prompt');
                if (prompt) {
                    messageInput.value = prompt;
                    sendMessage();
                }
            });
        });

        // Header buttons
        btnModel?.addEventListener('click', () => {
            vscode.postMessage({ type: 'switchModel' });
        });

        btnIndex?.addEventListener('click', () => {
            showStatus('Indexing codebase...');
            vscode.postMessage({ type: 'indexCodebase' });
        });

        btnCleft?.addEventListener('click', () => {
            vscode.postMessage({ type: 'startCleft' });
        });

        btnAttach?.addEventListener('click', () => {
            vscode.postMessage({ type: 'getCodeContext' });
        });

        agentSelect?.addEventListener('change', (e) => {
            const value = e.target.value;
            if (value === 'custom') {
                vscode.postMessage({ type: 'addCustomAgent' });
            }
        });

        autoIterateCheckbox?.addEventListener('change', (e) => {
            if (e.target.checked) {
                const task = messageInput.value || 'Continue current task autonomously';
                vscode.postMessage({ 
                    type: 'startIteration', 
                    task,
                    checkpoints: ['initial']
                });
                showStatus('24/7 Auto-iteration mode enabled');
            } else {
                vscode.postMessage({ type: 'stopIteration' });
                showStatus('Auto-iteration stopped');
            }
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

        // Hide welcome message
        if (welcomeMessage) {
            welcomeMessage.style.display = 'none';
        }

        // Add user message to chat
        addMessage('user', content);
        
        // Clear input
        messageInput.value = '';
        messageInput.style.height = 'auto';

        // Show typing indicator
        showTypingIndicator();

        // Send to extension
        isTyping = true;
        currentResponse = '';
        
        vscode.postMessage({
            type: 'sendMessage',
            content,
            options: {
                agent: agentSelect?.value || 'auto'
            }
        });
    }

    function addMessage(role, content, actions = []) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}-message`;
        
        const avatar = role === 'user' ? '👤' : '⚡';
        const name = role === 'user' ? 'You' : 'Synapse';
        
        messageDiv.innerHTML = `
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
                btn.onclick = () => action.handler();
                actionsDiv.appendChild(btn);
            });
            messageDiv.appendChild(actionsDiv);
        }

        chatContainer.appendChild(messageDiv);
        scrollToBottom();
        
        return messageDiv;
    }

    function formatContent(content) {
        // Escape HTML
        content = content.replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
        
        // Format code blocks
        content = content.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
            return `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`;
        });
        
        // Format inline code
        content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Format bold
        content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        
        // Format italic
        content = content.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        
        // Format links
        content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        
        // Convert newlines to breaks (outside of pre blocks)
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
        const indicator = document.getElementById('typing-indicator');
        if (indicator) {
            indicator.remove();
        }
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
            setTimeout(() => {
                statusEl.textContent = original;
            }, 3000);
        }
    }

    function handleSuggestedEdit(edit) {
        addMessage('ai', `Suggested edit to ${edit.file}`, [
            {
                label: '✓ Apply Edit',
                handler: () => {
                    vscode.postMessage({
                        type: 'applyEdit',
                        filePath: edit.file,
                        content: edit.content,
                        range: edit.range
                    });
                }
            },
            {
                label: '✕ Dismiss',
                secondary: true,
                handler: () => {}
            }
        ]);
    }

    function handleSuggestedCommand(cmd) {
        addMessage('ai', `Suggested command: \`\`\`\n${cmd}\n\`\`\``, [
            {
                label: '▶ Run in Terminal',
                handler: () => {
                    vscode.postMessage({
                        type: 'runTerminal',
                        command: cmd
                    });
                }
            },
            {
                label: '✕ Dismiss',
                secondary: true,
                handler: () => {}
            }
        ]);
    }

    // Handle messages from extension
    window.addEventListener('message', (event) => {
        const message = event.data;
        
        switch (message.type) {
            case 'config':
                updateConfig(message.config);
                break;
                
            case 'configUpdated':
                updateConfig(message.config);
                showStatus('Configuration updated');
                break;
                
            case 'responseStart':
                hideTypingIndicator();
                currentResponse = '';
                break;
                
            case 'responseChunk':
                currentResponse += message.chunk;
                // Update the last message or create new one
                const lastMessage = chatContainer.querySelector('.ai-message:last-child');
                if (lastMessage && !lastMessage.querySelector('.message-actions')) {
                    lastMessage.querySelector('.message-content').innerHTML = formatContent(currentResponse);
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
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error-message';
                errorDiv.textContent = `Error: ${message.error}`;
                chatContainer.appendChild(errorDiv);
                scrollToBottom();
                break;
                
            case 'suggestedEdit':
                handleSuggestedEdit(message.edit);
                break;
                
            case 'suggestedCommand':
                handleSuggestedCommand(message.cmd);
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
                showStatus(`Edit applied to ${message.filePath}`);
                break;
                
            case 'terminalExecuted':
                showStatus('Command executed');
                break;
                
            case 'codeContext':
                if (message.context) {
                    contextInfo.textContent = message.context.filePath;
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

    // Initialize
    init();
})();
