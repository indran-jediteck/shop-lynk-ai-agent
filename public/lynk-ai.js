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
    let browserId = localStorage.getItem('lynk_browser_id');
    let threadId = localStorage.getItem('lynk_thread_id');
    let isRunActive = false;
    if (!browserId) {
      browserId = 'browser-' + crypto.randomUUID();
      localStorage.setItem('lynk_browser_id', browserId);
    }
    const script = document.querySelector('script[src*="lynk-ai.js"]');
    let storeId = window.location.hostname; // 'jcsfashions' //
    console.log("🛒 Store ID:", storeId);
    storeId = storeId.replace(/^www\./i, '');
    // If it's not localhost or an IP, normalize & extract the center.
    if (storeId !== 'localhost' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(storeId)) {
      // strip leading www.
      storeId = storeId.replace(/^www\./i, '');

      // Shopify backend host → take the first label ("jediteck" from "jediteck.myshopify.com")
      const shopifyMatch = /^([^.]+)\.myshopify\.com$/i.exec(storeId);
      if (shopifyMatch) {
        storeId = shopifyMatch[1];
      } else {
        const labels = storeId.split('.');

        if (labels.length <= 2) {
          // "jcsfashions.com" → "jcsfashions"
          storeId = labels[0];
        } else {
          // Handle common 2-part public suffixes ".co.uk", ".com.au", etc.
          const TWO_PART_SUFFIXES = new Set([
            'co.uk','com.au','co.in','com.br','co.jp','co.kr','com.mx','com.sg','com.tr','co.za',
            'com.ar','com.co','com.my','com.ph','com.vn','com.hk','com.tw'
          ]);

          const last2 = labels.slice(-2).join('.');
          // If 2-part suffix, take the label before those two; else take before the last
          storeId = TWO_PART_SUFFIXES.has(last2)
            ? labels.slice(-3, -2)[0]
            : labels.slice(-2, -1)[0];
        }
      }
    }
    if (storeId === 'localhost' || storeId === 'onrender' || storeId === 'trycloudflare') {
      storeId = 'jcsfashions';
    }
    console.log("🛒 Store ID:", storeId);
    let userInfo = JSON.parse(localStorage.getItem('lynk_chat_user') || '{}');
    let ws; 
    const allowedMessages = ['Typing', 'Hold on, still working on your last request', 'Fetching data', 'Processing', 'Working on it'];    

    function showStatusMessage(message) {
      const existingIndicator = document.getElementById('system-indicator');
      if (existingIndicator) {
        existingIndicator.remove(); // Remove old one to force re-render
      }
    
      const uniqueClass = `blink-${Date.now()}`; // 🔥 unique class to force re-render
    
      const indicatorDiv = document.createElement('div');
      indicatorDiv.id = 'system-indicator';
      indicatorDiv.style.cssText = `
        align-self: flex-start;
        background: #f5f5f5;
        color: #555;
        padding: 10px 15px;
        border-radius: 15px 15px 15px 0;
        margin-bottom: 10px;
      `;
    
      indicatorDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="font-size: 14px;">${message}</div>
          <div style="display: flex; gap: 4px; align-items: center;">
            <span class="${uniqueClass}" style="width: 6px; height: 6px; background: #999; border-radius: 50%; animation: blink 1s infinite ease-in-out;"></span>
            <span class="${uniqueClass}" style="width: 6px; height: 6px; background: #999; border-radius: 50%; animation: blink 1s 0.2s infinite ease-in-out;"></span>
            <span class="${uniqueClass}" style="width: 6px; height: 6px; background: #999; border-radius: 50%; animation: blink 1s 0.4s infinite ease-in-out;"></span>
          </div>
        </div>
        <style>
          @keyframes blink {
            0%, 80%, 100% { opacity: 0; }
            40% { opacity: 1; }
          }
        </style>
      `;
    
      messages.appendChild(indicatorDiv);
      messages.scrollTop = messages.scrollHeight;
    }

    function connectWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // const wsUrl = `${protocol}//${window.location.host}`;
      //const wsUrl = `wss://5569-2601-647-5500-6530-b50e-d9de-bd9e-48fc.ngrok-free.app`;
      // const wsUrl = `wss://shop-lynk-ai-agent.onrender.com`;
      const wsUrl = `wss://shop-lynk-ai-agent.onrender.com`;
      ws = new WebSocket(wsUrl);
      console.log('Connecting to WebSocket:', wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected now now sending init message');
        ws.send(JSON.stringify({
          type: 'init',
          browserId: browserId,
          userInfo: userInfo,
          threadId: threadId,
          storeId: storeId
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Received message:', data);
         // 🔥 NEW universal error check block before switch
        if (
          data.message &&
          typeof data.message === 'string' &&
          data.message.includes("Can't add messages to") &&
          data.message.includes("while a run")
        ) {
          isRunActive = true;
          showStatusMessage("Hold on, still working on your last request");
          return;
        }
        switch (data.type) {
          case 'init_ack':
            if (data.threadId) {
              localStorage.setItem('lynk_thread_id', data.threadId);
              threadId = data.threadId;
              console.log('Thread ID set from server:', threadId);
            }
            break;
            
          case 'init_message':
            // Display the welcome message with follow-up actions
            const welcomeDiv = document.createElement('div');
            welcomeDiv.style.cssText = `
              align-self: flex-start;
              background: #f0f0f0;
              color: #333;
              padding: 10px 15px;
              border-radius: 15px 15px 15px 0;
              max-width: 80%;
              word-wrap: break-word;
              margin: 0;
            `;
            welcomeDiv.innerHTML = `
              <div style="margin: 0; padding: 0; max-width: 100%;">
                ${window.marked ? marked.parse(data.message) : data.message}
              </div>
            `;
            messages.appendChild(welcomeDiv);
            
            // Add follow-up action buttons
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
                actionButton.textContent = action;
                actionButton.style.cssText = `
                  background: #f0f0f0;
                  border: 1px solid #ddd;
                  padding: 5px 10px;
                  border-radius: 15px;
                  cursor: pointer;
                  font-size: 12px;
                `;
                actionButton.onclick = () => {
                  chatInput.value = action;
                  sendMessage();
                };
                actionsDiv.appendChild(actionButton);
              });
              
              messages.appendChild(actionsDiv);
            }
            
            messages.scrollTop = messages.scrollHeight;
            break;
            
          case 'system_message':
            if (!allowedMessages.includes(data.message)) break;
            isRunActive = true;
            showStatusMessage(data.message);
            break;

          case 'new_message':
            const typingIndicator = document.getElementById('typing-indicator');
            if (typingIndicator) typingIndicator.remove();
            isRunActive = false;
            // Check if the message is one of our status messages
            if (allowedMessages.includes(data.message)) {
              showStatusMessage(data.message);
              return; // Don't proceed with normal message handling
            }

            // Only remove system indicator if we're not showing a status message
            const systemIndicator = document.getElementById('system-indicator');
            if (systemIndicator) systemIndicator.remove();

            // Check if it's an error message about active run
            if (data.message.includes("Can't add messages to") && data.message.includes("while a run is active")) {
              showStatusMessage("Hold on, still working on your last request...");
              return; // Don't proceed with normal message handling
            }
            isRunActive = false;
            sendBtn.disabled = false;
            chatInput.disabled = false;
            const messageDiv = document.createElement('div');
            messageDiv.style.margin = '0'; 
            messageDiv.style.cssText = `
              align-self: flex-start;
              background: #f0f0f0;
              color: #333;
              padding: 10px 15px;
              border-radius: 15px 15px 15px 0;
              max-width: 80%;
              word-wrap: break-word;
              margin: 0;
            `;
            messageDiv.innerHTML = `
                <div style="margin: 0; padding: 0; max-width: 100%;">
                  ${window.marked ? marked.parse(data.message) : data.message}
                </div>
              `;

              // Constrain all images inside this messageDiv after rendering
              const imgs = messageDiv.querySelectorAll('img');
              imgs.forEach(img => {
                img.style.maxWidth = '120px';   // thumbnail size
                img.style.height = 'auto';
                img.style.borderRadius = '8px';
                img.style.marginTop = '8px';
              });

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
        const errorMessage = error?.message || error.toString();
      
        if (
          errorMessage.includes("Can't add messages to") &&
          errorMessage.includes("while a run")
        ) {
          showStatusMessage("Hold on, still working on your last request");
          return;
        }
      
        console.error("WebSocket error:", error);
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
      // overflowY: 'scroll', // keep scroll behavior
      overflow: 'hidden',
      width: '500px',
      height: '30vh',
      top: '20px',
      maxHeight: '60vh',
      bottom: '90px',
      right: '20px',
    
      // scrollbar hiding
      // scrollbarWidth: 'none',     // Firefox
      // msOverflowStyle: 'none',    // IE/Edge
    });
    

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      position: 'sticky',
      top: '0',
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
      localStorage.removeItem('lynk_browser_id');
      localStorage.removeItem('lynk_thread_id');
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
      // flex: 1,
      display: 'flex',
      flexDirection: 'column',
      // overflowY: 'scroll', // Not scroll entire contentArea, only inside messages
      transition: 'min-height 0.3s ease',
      minHeight: '100%', // <-- add this line
    });

    // Then append like this:
    modal.appendChild(header);
    modal.appendChild(contentArea);

        // --- Message history area ---
    const messages = document.createElement('div');
    messages.id = 'lynk-chat-messages';
    Object.assign(messages.style, {
      backgroundColor:'#ffffff',
      flex: 1,
      overflow: 'scroll',
      padding: '10px',
      paddingBottom: '50px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      scrollbarWidth: 'none',     // Firefox
      msOverflowStyle: 'none', 
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

    // Create a container for input area and footer
    const bottomContainer = document.createElement('div');
    Object.assign(bottomContainer.style, {
      borderTop: '1px solid #eee',
      position: 'relative',
      backgroundColor:'#ffffff',
      width : "100%",
      bottom : "38px",
    });

    // Add powered by footer
    const poweredByFooter = document.createElement('div');
    poweredByFooter.style.cssText = `
      padding: 8px 0;
      background-color: #fff;
      text-align: center;
      position: relative;
      overflow: hidden;
      width:100%;
      bottom: 40px;
      color: #666;
      font-size: 12px;
      border-top: 1px solid #eee;
    `;
    poweredByFooter.innerHTML = 'Powered by <a href="https://jediteck.com" target="_blank" style="color: #5C6AC4; text-decoration: none;">Lynk AI / JediTeck</a> ver 2.1';

    // Correct order of elements
    bottomContainer.appendChild(inputWrapper);
//    bottomContainer.appendChild(poweredByFooter);

    // Add elements to content area in correct order
    contentArea.appendChild(messages);
    contentArea.appendChild(bottomContainer);

    function sendMessage() {
      const message = chatInput.value.trim();
      if (!message || isRunActive) {
        if (isRunActive) {
          showStatusMessage("Hold on, still working on your last request");
        }
        chatInput.value = '';
        return;
      }
      chatInput.value = '';
      isRunActive = true;
      sendBtn.disabled = true;
      chatInput.disabled = true;
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
          threadId: threadId,
          storeId: storeId, // Add store_id from global variable
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
      messages.innerHTML = ''; 
      contentArea.removeChild(bottomContainer);// clear only inside the scrollable part

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

      // Add mandatory phone number input
      const phoneInput = document.createElement('input');
      phoneInput.type = 'tel';
      phoneInput.placeholder = "Enter your phone number";
      phoneInput.required = true;
      phoneInput.style.cssText = `
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
        We use your information to provide personalized shopping experiences, including:<br><br>
        • New customer discounts<br>
        • Special offers for returning customers<br>
        • Order updates and tracking<br>
        • Personalized product recommendations<br>
        • SMS notifications for urgent updates<br><br>
        If our AI assistant can't fully address your query and our team is offline, we'll email you a response as soon as possible.
      `;

      submitBtn.onclick = () => {
        const name = nameInput.value.trim()
          .split(' ')
          .map(word => word.toLowerCase().replace(/^\w/, c => c.toUpperCase()))
          .join(' ');
        const email = emailInput.value.trim();
        const phone = phoneInput.value.trim();
        
        if (!name || !email || !phone) {
          alert("Please enter your name, email, and phone number to start chatting.");
          return;
        }
        
        // Store user info with phone number
        localStorage.setItem('lynk_chat_user', JSON.stringify({ name, email, phone }));
        userInfo = { name, email, phone };  // 🔥 Update in memory too
        contentArea.innerHTML = ''; // reset inside scroll area
        messages.removeChild(formWrapper);
        contentArea.appendChild(messages);
        contentArea.appendChild(bottomContainer);
        contentArea.appendChild(poweredByFooter);
        connectWebSocket();
      };

      formWrapper.appendChild(nameInput);
      formWrapper.appendChild(emailInput);
      formWrapper.appendChild(phoneInput);  // Add phone input to form
      formWrapper.appendChild(submitBtn);
      formWrapper.appendChild(infoText);

      messages.appendChild(formWrapper);
      contentArea.appendChild(poweredByFooter);
      //contentArea.appendChild(bottomContainer); // Add the bottom container with input and footer
    }
    function adjustModalSize() {
      if (window.innerWidth < 768) {
        modal.style.width = '100%';
        modal.style.height = '100vh';
        modal.style.maxHeight = '100vh';
        modal.style.bottom = '0';
        modal.style.right = '0';
        modal.style.borderRadius = '0';
      } else {
        modal.style.width = '500px';
        modal.style.maxHeight = '90vh';
        modal.style.height = '90vh';
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
      contentArea.appendChild(bottomContainer);
      contentArea.appendChild(poweredByFooter);
      connectWebSocket();
    }
  }
})();