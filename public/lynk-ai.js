(() => {
  if (window.__lynkAIWidgetLoaded) return;
  window.__lynkAIWidgetLoaded = true;

  if (!document.querySelector('meta[name="viewport"]')) {
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
    document.head.appendChild(meta);
  }

  if (typeof window.marked === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
    script.onload = initLynkChat;
    document.head.appendChild(script);
  } else {
    initLynkChat();
  }

  function initLynkChat() {
    const shopDomain = window.location.hostname;
    let browserId = localStorage.getItem('lynk_browser_id');
    if (!browserId) {
      browserId = 'browser-' + crypto.randomUUID();
      localStorage.setItem('lynk_browser_id', browserId);
    }

    let userInfo = JSON.parse(localStorage.getItem('lynk_chat_user') || '{}');
    let ws; 

    function connectWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        ws.send(JSON.stringify({
          type: 'init',
          browserId: browserId,
          userInfo: userInfo
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Received message:', data);

        switch (data.type) {
          case 'system_message':
            if (data.message === 'thinking') {
              if (!document.getElementById('typing-indicator')) {
                const typingDiv = document.createElement('div');
                typingDiv.id = 'typing-indicator';
                typingDiv.style.cssText = `
                  align-self: flex-start;
                  background: #f0f0f0;
                  color: #666;
                  padding: 10px 15px;
                  border-radius: 15px 15px 15px 0;
                  margin-bottom: 10px;
                `;
                typingDiv.textContent = 'Typing...';
                messages.appendChild(typingDiv);
                messages.scrollTop = messages.scrollHeight;
              }
            }
            break;

          case 'new_message':
            const typingIndicator = document.getElementById('typing-indicator');
            if (typingIndicator) typingIndicator.remove();

            const messageDiv = document.createElement('div');
            messageDiv.style.cssText = `
              align-self: flex-start;
              background: #f0f0f0;
              color: #333;
              padding: 10px 15px;
              border-radius: 15px 15px 15px 0;
              max-width: 80%;
              word-wrap: break-word;
            `;
            messageDiv.innerHTML = window.marked ? marked.parse(data.message) : data.message;
            messages.appendChild(messageDiv);
            messages.scrollTop = messages.scrollHeight;

            if (data.followUpActions && Array.isArray(data.followUpActions)) {
              const actionsDiv = document.createElement('div');
              actionsDiv.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 10px;
              `;

              data.followUpActions.forEach(action => {
                const actionButton = document.createElement('button');
                actionButton.textContent = action.text;
                actionButton.style.cssText = `
                  background: #f0f0f0;
                  border: 1px solid #ddd;
                  padding: 5px 10px;
                  border-radius: 15px;
                  cursor: pointer;
                  font-size: 12px;
                `;
                actionButton.onclick = () => {
                  chatInput.value = action.prompt;
                  sendMessage();
                };
                actionsDiv.appendChild(actionButton);
              });

              messages.appendChild(actionsDiv);
              messages.scrollTop = messages.scrollHeight;
            }
            break;
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    }




    const modal = document.createElement('div');
    modal.id = 'lynk-chat-modal';
    Object.assign(modal.style, {
      display: 'none',
      flexDirection: 'column',
      background: '#fff',
      position: 'fixed',
      boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
      zIndex: 9998,
      borderRadius: '10px',
      overflow: 'hidden', // 🔥 very important - NOT 'auto' here
      width: '400px',
      height: '600px',
      bottom: '90px',
      right: '20px',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '10px 15px',
      background: 'linear-gradient(90deg, #5C6AC4, #8A2BE2)',
      color: '#fff',
      fontSize: '16px',
      fontWeight: 'bold',
    });

    // Title on the left
    const title = document.createElement('div');
    title.innerText = 'Chat with Us';

    // Actions container on the right
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.alignItems = 'center';
    actions.style.gap = '10px';

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.innerText = 'Reset';
    resetBtn.style.cssText = `
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      font-size: 14px;
    `;

    // Clear localStorage and reload
    resetBtn.onclick = () => {
      localStorage.removeItem('lynk_chat_user');
      location.reload();
    };

    // Close button
    const closeBtn = document.createElement('span');
    closeBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    `;
    closeBtn.style.cssText = `
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
    `;

    closeBtn.onclick = () => {
      modal.style.display = 'none';
      chatToggleBtn.style.display = 'flex';
    };

    // Assemble header
    actions.appendChild(resetBtn);
    actions.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(actions);

    const contentArea = document.createElement('div'); // 🔥 ADD this wrapper
    contentArea.id = 'lynk-chat-content';
    Object.assign(contentArea.style, {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden', // Not scroll entire contentArea, only inside messages
    });

    // Then append like this:
    modal.appendChild(header);
    modal.appendChild(contentArea);

        // --- Message history area ---
    const messages = document.createElement('div');
    messages.id = 'lynk-chat-messages';
    Object.assign(messages.style, {
      flex: 1,
      overflowY: 'auto',
      padding: '10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    });

    // --- Input area ---
    const inputWrapper = document.createElement('div');
    Object.assign(inputWrapper.style, {
      display: 'flex',
      padding: '10px',
      borderTop: '1px solid #eee',
      gap: '10px',
      alignItems: 'center',
    });

    const chatInput = document.createElement('input');
    chatInput.type = 'text';
    chatInput.placeholder = 'Type your message...';
    Object.assign(chatInput.style, {
      flex: 1,
      padding: '10px',
      border: '1px solid #ccc',
      borderRadius: '8px',
    });

    const sendBtn = document.createElement('button');
    sendBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
      </svg>
    `;
    Object.assign(sendBtn.style, {
      width: '44px',
      height: '44px',
      background: 'linear-gradient(90deg, #5C6AC4, #8A2BE2)',
      border: 'none',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
    });

    inputWrapper.appendChild(chatInput);
    inputWrapper.appendChild(sendBtn);

    function sendMessage() {
      const message = chatInput.value.trim();
      if (!message) return;
      chatInput.value = '';

      const userMessageDiv = document.createElement('div');
      userMessageDiv.style.cssText = `
        align-self: flex-end;
        background: #f0f0f0;
        color: #333;
        padding: 10px 15px;
        border-radius: 15px 15px 15px 0;
        max-width: 80%;
        word-wrap: break-word;
      `;
      userMessageDiv.textContent = message;
      messages.appendChild(userMessageDiv);
      messages.scrollTop = messages.scrollHeight;

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'user_message',
          message: message,
          threadId: userInfo.email,
          userInfo: userInfo
        }));
      }
    }

    sendBtn.onclick = sendMessage;
    chatInput.onkeypress = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    };
    // When showing form or messages:
    function showUserInfoForm() {
      contentArea.innerHTML = ''; // clear only inside the scrollable part

      const formWrapper = document.createElement('div');
      formWrapper.style.cssText = `
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 15px;
        padding: 20px;
      `;

      const nameInput = document.createElement('input');
      nameInput.placeholder = "Enter your name";
      nameInput.style.cssText = `
        width: 80%;
        padding: 10px;
        border: 1px solid #ccc;
        border-radius: 8px;
      `;

      const emailInput = document.createElement('input');
      emailInput.type = 'email';
      emailInput.placeholder = "Enter your email";
      emailInput.style.cssText = `
        width: 80%;
        padding: 10px;
        border: 1px solid #ccc;
        border-radius: 8px;
      `;

      const submitBtn = document.createElement('button');
      submitBtn.innerText = "Start Chatting";
      submitBtn.style.cssText = `
        padding: 10px 20px;
        background: linear-gradient(90deg, #5C6AC4, #8A2BE2);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
      `;

      const infoText = document.createElement('div');
      infoText.style.cssText = `
        color: #333;
        font-size: 16px;
        text-align: left;
        max-width: 300px;
        line-height: 1.4;
        margin-top: 10px;
      `;
      infoText.innerHTML = `
        We use your email to provide personalized shopping experiences, including:<br><br>
        • New customer discounts<br>
        • Special offers for returning customers<br>
        • Order updates and tracking<br>
        • Personalized product recommendations<br><br>
        If our AI assistant can't fully address your query and our team is offline, we'll email you a response as soon as possible.
      `;

      submitBtn.onclick = () => {
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        if (!name || !email) {
          alert("Please enter your name and email to start chatting.");
          return;
        }
        localStorage.setItem('lynk_chat_user', JSON.stringify({ name, email }));
        contentArea.innerHTML = ''; // reset inside scroll area
        contentArea.appendChild(messages);
        contentArea.appendChild(inputWrapper);
        connectWebSocket();
      };

      formWrapper.appendChild(nameInput);
      formWrapper.appendChild(emailInput);
      formWrapper.appendChild(submitBtn);
      formWrapper.appendChild(infoText);

      contentArea.appendChild(formWrapper);
    }
    function adjustModalSize() {
      if (window.innerWidth < 768) {
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.bottom = '0';
        modal.style.right = '0';
        modal.style.borderRadius = '0';
      } else {
        modal.style.width = '400px';
        modal.style.height = '600px';
        modal.style.bottom = '90px';
        modal.style.right = '20px';
        modal.style.borderRadius = '10px';
      }
    }
    window.addEventListener('resize', adjustModalSize);
    document.body.appendChild(modal);
    const chatToggleBtn = document.createElement('div');
    chatToggleBtn.id = 'lynk-chat-toggle';
    chatToggleBtn.innerHTML = '💬'; // Or a chat icon
    Object.assign(chatToggleBtn.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      background: 'linear-gradient(90deg, #5C6AC4, #8A2BE2)',
      color: '#fff',
      width: '50px',
      height: '50px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      fontSize: '24px',
      zIndex: 9999,
      boxShadow: '0 4px 10px rgba(0, 0, 0, 0.3)',
    });

    chatToggleBtn.onclick = () => {
      modal.style.display = 'flex';
      chatToggleBtn.style.display = 'none';
      adjustModalSize();
    };

    document.body.appendChild(chatToggleBtn);
    if (!userInfo.name || !userInfo.email) {
      showUserInfoForm();
    } else {
      // Assume messages and inputWrapper are globally available or defined
      contentArea.appendChild(messages);
      contentArea.appendChild(inputWrapper);
      connectWebSocket();
    }
  }
})();