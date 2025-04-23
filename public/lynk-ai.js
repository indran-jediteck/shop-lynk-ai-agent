
let hasInitialized = false;

// Wait for marked to load before initializing
if (typeof marked === 'undefined') {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
  script.onload = initializeChat;
  document.head.appendChild(script);
} else {
  initializeChat();
}

function initializeChat() {
  // Get the current shop's domain from the URL parameter
  const shop = window.location.hostname;
  console.log('shop:', shop);

  // Generate or retrieve browser ID
  let browserId = localStorage.getItem('lynk_browser_id');
  if (!browserId) {
    browserId = 'browser-' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    localStorage.setItem('lynk_browser_id', browserId);
  }
  console.log('Browser ID:', browserId);

  // WebSocket connection
  let ws = null;

  // Get the app URL from the script tag
  const scriptTag = document.currentScript;
  const appUrl = scriptTag.src.split('/lynk-ai.js')[0];
  
  // Get user info from localStorage or set defaults
  let userInfo = JSON.parse(localStorage.getItem('chatUserInfo')) || {
    name: '',
    email: ''
  };

  // Create chat button
  const chatButton = document.createElement('button');
  chatButton.innerHTML = '💬';
  chatButton.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: linear-gradient(90deg, #5C6AC4, #8A2BE2);
    color: white;
    border: none;
    cursor: pointer;
    font-size: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    z-index: 1000;
    transition: all 0.3s ease;
  `;
  chatButton.onmouseover = () => {
    chatButton.style.transform = 'scale(1.1)';
    chatButton.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
  };
  chatButton.onmouseout = () => {
    chatButton.style.transform = 'scale(1)';
    chatButton.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
  };

  // Create chat modal
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 20px;
    width: 700px;
    height: 800px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    display: none;
    flex-direction: column;
    z-index: 1000;
    overflow: hidden;
  `;

  // Create chat header
  const chatHeader = document.createElement('div');
  chatHeader.style.cssText = `
    padding: 15px;
    background: linear-gradient(90deg, #5C6AC4, #8A2BE2);
    color: white;
    border-radius: 12px 12px 0 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: relative;
  `;
  chatHeader.innerHTML = `
    <span style="font-weight: bold; font-size: 18px;">Chat with us</span>
    <div style="display: flex; gap: 10px;">
      <button id="resetUser" style="
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        font-size: 14px;
        padding: 0 8px;
        display: flex;
        align-items: center;
      ">Reset User</button>
      <button id="closeChat" style="
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        font-size: 24px;
        padding: 0 8px;
      ">×</button>
    </div>
  `;

  // Create messages container
  const messagesContainer = document.createElement('div');
  messagesContainer.style.cssText = `
    flex: 1;
    padding: 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    -webkit-overflow-scrolling: touch;
  `;

  // Create input container
  const inputContainer = document.createElement('div');
  inputContainer.style.cssText = `
    padding: 15px;
    border-top: 1px solid #eee;
    display: flex;
    gap: 10px;
    background: white;
    position: relative;
    z-index: 1;
  `;

  // Create input field
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type your message...';
  input.style.cssText = `
    flex: 1;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    outline: none;
    font-size: 16px;
  `;

  // Create send button
  const sendButton = document.createElement('button');
  sendButton.innerHTML = 'Send';
  sendButton.style.cssText = `
    padding: 12px 24px;
    background: linear-gradient(90deg, #5C6AC4, #8A2BE2);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    font-weight: 500;
    transition: transform 0.2s;
  `;

  // Add hover effect
  sendButton.onmouseover = () => sendButton.style.transform = 'scale(1.05)';
  sendButton.onmouseout = () => sendButton.style.transform = 'scale(1)';

  // Create user info form
  const userInfoForm = document.createElement('div');
  userInfoForm.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: white;
    z-index: 2;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
  `;

  userInfoForm.innerHTML = `
    <form id="chat-user-form" style="
      background: white;
      padding: 20px;
      border-radius: 8px;
      width: 100%;
      max-width: 300px;
    ">
      <h3 style="margin: 0 0 15px; font-size: 18px; text-align: center;">Enter Your Information</h3>
      <input 
        type="text" 
        id="chat-name" 
        required
        placeholder="Your name" 
        style="
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          margin-bottom: 8px;
          font-size: 14px;
          box-sizing: border-box;
        "
      >
      <input 
        type="email" 
        id="chat-email" 
        required
        placeholder="Your email" 
        style="
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          margin-bottom: 15px;
          font-size: 14px;
          box-sizing: border-box;
        "
      >
      <button 
        type="submit"
        style="
          width: 100%;
          padding: 10px;
          background: linear-gradient(90deg, #5C6AC4, #8A2BE2);
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          cursor: pointer;
        "
      >Start Chatting</button>
      <p style="
        margin: 15px 0 0;
        font-size: 13px;
        color: #666;
        line-height: 1.4;
        text-align: left;
      ">
        We use your email to provide personalized shopping experiences, including:
        <br>• New customer discounts
        <br>• Special offers for returning customers
        <br>• Order updates and tracking
        <br>• Personalized product recommendations
        <br><br>If our AI assistant can't fully address your query and our team is offline, we'll email you a response as soon as possible.
      </p>
    </form>
  `;

  // Add user info form to modal
  modal.appendChild(userInfoForm);

  // Function to handle mobile view
  function updateModalForMobile() {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        height: 100%;
        background: white;
        border-radius: 0;
        display: none;
        flex-direction: column;
        z-index: 1000;
        overflow: hidden;
      `;
      chatHeader.style.borderRadius = '0';
    } else {
      modal.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 20px;
        width: 700px;
        height: 800px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        display: none;
        flex-direction: column;
        z-index: 1000;
        overflow: hidden;
      `;
      chatHeader.style.borderRadius = '12px 12px 0 0';
    }
  }

  // Add viewport meta tag if not exists
  if (!document.querySelector('meta[name="viewport"]')) {
    const viewportMeta = document.createElement('meta');
    viewportMeta.name = 'viewport';
    viewportMeta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
    document.head.appendChild(viewportMeta);
  }

  // Handle window resize
  window.addEventListener('resize', updateModalForMobile);

  // Assemble modal
  inputContainer.appendChild(input);
  inputContainer.appendChild(sendButton);
  modal.appendChild(chatHeader);
  modal.appendChild(messagesContainer);
  modal.appendChild(inputContainer);

  // Add modal to page
  document.body.appendChild(chatButton);
  document.body.appendChild(modal);

  // Add highlight.js for code syntax highlighting
  const highlightCSS = document.createElement('link');
  highlightCSS.rel = 'stylesheet';
  highlightCSS.href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.8.0/styles/github.min.css';
  document.head.appendChild(highlightCSS);

  const highlightJS = document.createElement('script');
  highlightJS.src = 'https://cdn.jsdelivr.net/npm/highlight.js@11.8.0/lib/highlight.min.js';
  document.head.appendChild(highlightJS);

  // Function to create thinking indicator
  function createThinkingIndicator() {
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'thinking-indicator';
    thinkingDiv.style.cssText = `
      padding: 12px 16px;
      border-radius: 12px;
      max-width: 80%;
      margin: 8px 0;
      margin-right: auto;
      background: #f5f5f5;
      color: #666;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    `;

    const dots = document.createElement('div');
    dots.style.cssText = `
      display: flex;
      gap: 4px;
    `;

    // Create 3 animated dots
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.style.cssText = `
        width: 6px;
        height: 6px;
        background: #666;
        border-radius: 50%;
        animation: thinking 1.4s infinite;
        animation-delay: ${i * 0.2}s;
      `;
      dots.appendChild(dot);
    }

    // Add animation keyframes
    if (!document.getElementById('thinking-style')) {
      const style = document.createElement('style');
      style.id = 'thinking-style';
      style.textContent = `
        @keyframes thinking {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
      `;
      document.head.appendChild(style);
    }

    const text = document.createElement('span');
    text.textContent = 'Assistant is thinking';
    
    thinkingDiv.appendChild(text);
    thinkingDiv.appendChild(dots);
    return thinkingDiv;
  }

  // WebSocket message handler
  function handleWebSocketMessage(event) {
    try {
      const data = JSON.parse(event.data);
      console.log('WebSocket message received:', data);


      if (data.type === 'new_message') {
        // Ensure message content is treated as markdown for AI messages
        if (data.sender === 'ai') {
          console.log('Raw AI message:', data.message);
          // Preserve markdown characters by decoding HTML entities
          const decodedMessage = data.message
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ');
          console.log('Decoded message:', decodedMessage);
          addMessage(decodedMessage, 'ai');

          if (data.followUpActions && Array.isArray(data.followUpActions)) {
            const lastMessage = messagesContainer.lastElementChild;
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.cssText = `
              display: flex;
              flex-wrap: wrap;
              gap: 8px;
              margin-top: 12px;
            `;
          
            data.followUpActions.forEach(action => {
              const button = document.createElement('button');
              button.textContent = action.text;
              button.style.cssText = `
                padding: 8px 12px;
                background: #E3F2FD;
                color: #1565C0;
                border: none;
                border-radius: 20px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s ease;
              `;
              button.onmouseover = () => {
                button.style.background = '#1565C0';
                button.style.color = 'white';
              };
              button.onmouseout = () => {
                button.style.background = '#E3F2FD';
                button.style.color = '#1565C0';
              };
              button.onclick = () => {
                input.value = action.prompt;
                sendButton.click();
              };
              buttonsContainer.appendChild(button);
            });
          
            if (lastMessage) {
              lastMessage.appendChild(buttonsContainer);
            }
          }


        } else {
          addMessage(data.message, data.sender);
        }
      } else if (data.type === 'system_message' && data.message !== 'Connection established') {
        addMessage(data.message, 'system');
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  }

  // Function to safely parse markdown
  function parseMarkdown(content) {
    console.log('Raw content:', content);
    const parsed = marked.parse(content);
    console.log('Parsed HTML:', parsed);
    return parsed;
  }

  // Function to add message to chat
  function addMessage(content, sender, isStreaming = false) {
    console.log('Adding message:', { content, sender, isStreaming });
    
    // Remove existing thinking indicator if any
    const existingThinking = messagesContainer.querySelector('.thinking-indicator');
    if (existingThinking) {
      existingThinking.remove();
    }

    // If it's a system message showing "thinking", use the animated indicator
    if (sender === 'system' && content === 'thinking') {
      const thinkingIndicator = createThinkingIndicator();
      messagesContainer.appendChild(thinkingIndicator);
      return;
    }

    // Create message container
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    messageDiv.style.cssText = `
      max-width: 80%;
      padding: 16px;
      border-radius: 12px;
      margin-bottom: 12px;
      word-wrap: break-word;
      ${sender === 'user' ? 'background: #f0f0f0; color: #333; align-self: flex-end;' : 'background: #f0f0f0; color: #333; align-self: flex-start;'}
    `;

    // Create content container with markdown styles
    const contentDiv = document.createElement('div');
    contentDiv.className = 'markdown-content';
    
    console.log('adding content:', content);


    // Add markdown styles dynamically if they don't exist
    if (!document.getElementById('markdown-styles')) {
      const style = document.createElement('style');
      style.id = 'markdown-styles';
      style.textContent = `
        .markdown-content {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.6;
          color: inherit;
        }
        .markdown-content p {
          margin: 0 0 1em 0;
        }
        .markdown-content p:last-child {
          margin-bottom: 0;
        }
        .markdown-content ul, .markdown-content ol {
          margin: 1em 0;
          padding-left: 2em;
        }
        .markdown-content li {
          margin: 0.5em 0;
        }
        .markdown-content h1, .markdown-content h2, .markdown-content h3,
        .markdown-content h4, .markdown-content h5, .markdown-content h6 {
          margin: 1.5em 0 0.5em;
          line-height: 1.25;
        }
        .markdown-content h1 { font-size: 1.5em; }
        .markdown-content h2 { font-size: 1.3em; }
        .markdown-content h3 { font-size: 1.2em; }
        .markdown-content h4 { font-size: 1.1em; }
        .markdown-content h5, .markdown-content h6 { font-size: 1em; }
        .markdown-content pre {
          background: rgba(0,0,0,0.05);
          padding: 1em;
          border-radius: 8px;
          overflow-x: auto;
          margin: 1em 0;
        }
        .markdown-content code {
          background: rgba(0,0,0,0.05);
          padding: 0.2em 0.4em;
          border-radius: 4px;
          font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
          font-size: 0.9em;
        }
        .markdown-content pre code {
          background: none;
          padding: 0;
        }
        .markdown-content blockquote {
          border-left: 3px solid #ddd;
          margin: 1em 0;
          padding: 0.5em 0 0.5em 1em;
          color: inherit;
          font-style: italic;
        }
        .markdown-content a {
          color: #2B6CB0;
          text-decoration: none;
          border-bottom: 1px solid currentColor;
        }
        .markdown-content a:hover {
          border-bottom: 2px solid currentColor;
        }
        .markdown-content img {
          display: inline-block;
          max-width: 150px;
          height: 150px;
          border-radius: 8px;
          margin: 4px;
          object-fit: cover;
          vertical-align: middle;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .markdown-content img:hover {
          transform: scale(1.05);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .markdown-content .product-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1em;
          margin: 1em 0;
        }
        .markdown-content .product-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 1em;
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .markdown-content .product-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 6px 16px rgba(0,0,0,0.1);
        }
        .markdown-content .product-card img {
          width: 200px;
          height: 200px;
          object-fit: cover;
          margin: 0;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .markdown-content .product-card a {
          text-decoration: none;
          border: none;
          display: block;
        }
        
        .markdown-content .product-card a:hover {
          border: none;
        }
        
        .markdown-content .product-card img:hover {
          transform: scale(1.05);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
      `;
      document.head.appendChild(style);
    }
    
    // Handle content based on sender
    if (sender === 'ai') {
      // For AI messages, parse markdown
      const parsedContent = parseMarkdown(content);
      contentDiv.innerHTML = parsedContent;
      
      // Remove default link styling from product card links
      contentDiv.querySelectorAll('.product-card a').forEach(link => {
        link.style.textDecoration = 'none';
        link.style.border = 'none';
      });
      
      // Apply syntax highlighting to code blocks if highlight.js is available
      if (typeof hljs !== 'undefined') {
        contentDiv.querySelectorAll('pre code').forEach((block) => {
          hljs.highlightElement(block);
        });
      }
    } else {
      // For user messages, preserve line breaks but don't parse markdown
      contentDiv.textContent = content;
    }
    
    // Add content to message
    messageDiv.appendChild(contentDiv);
    
    // Add message to container
    messagesContainer.appendChild(messageDiv);
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Function to create quick action buttons
  function createQuickActionButtons() {
    const actions = [
      { text: 'Check my order', prompt: 'Can you help me check the status of my order?' },
      { text: 'Product question', prompt: 'I have a question about a product' },
      { text: 'Return/Exchange', prompt: 'I need help with a return or exchange' },
      { text: 'Schedule appointment', prompt: 'I would like to schedule an appointment' },
      { text: 'Studio hours', prompt: 'What are your studio hours?' },
      { text: 'Contact support', prompt: 'I need to speak with customer support' }
    ];

    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    `;

    actions.forEach(action => {
      const button = document.createElement('button');
      button.textContent = action.text;
      button.style.cssText = `
        padding: 8px 12px;
        background: #E3F2FD;
        color: #1565C0;
        border: none;
        border-radius: 20px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s ease;
      `;
      button.onmouseover = () => {
        button.style.background = '#1565C0';
        button.style.color = 'white';
      };
      button.onmouseout = () => {
        button.style.background = '#E3F2FD';
        button.style.color = '#1565C0';
      };
      button.onclick = () => {
        input.value = action.prompt;
        sendButton.click();
      };
      buttonsContainer.appendChild(button);
    });

    return buttonsContainer;
  }

  // // Function to show welcome message
  // function showWelcomeMessage() {
  //   const firstName = userInfo.name.split(' ')[0] || 'there';
  //   const welcomeMessage = `Hi ${firstName}! 👋 I'm your AI assistant. How can I help you today?`;
  //   ws.send(JSON.stringify({
  //     type: 'user_message',
  //     message: '__welcome__',
  //     browserId: browserId,
  //     userInfo: userInfo
  //   }));
    
  //   const buttonsContainer = createQuickActionButtons();
  //   const lastMessage = messagesContainer.lastElementChild;
  //   lastMessage.appendChild(buttonsContainer);
  // }

  // Function to show user info form
  function showUserInfoForm() {
    userInfoForm.style.display = 'flex';
    messagesContainer.style.display = 'none';
    inputContainer.style.display = 'none';
    
    // Clear previous values
    const nameInput = document.getElementById('chat-name');
    const emailInput = document.getElementById('chat-email');
    if (nameInput) nameInput.value = '';
    if (emailInput) emailInput.value = '';
  }

  // Function to hide user info form
  function hideUserInfoForm() {
    userInfoForm.style.display = 'none';
    messagesContainer.style.display = 'flex';
    inputContainer.style.display = 'flex';
    console.log('Form hidden, chat shown');
  }

  // Handle reset user button click
  document.getElementById('resetUser').addEventListener('click', () => {
    localStorage.removeItem('chatUserInfo');
    userInfo = { name: '', email: '' };
    showUserInfoForm();
  });

  // Update the form submission handler to show welcome message
  document.getElementById('chat-user-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const form = e.target;
    const nameInput = form.querySelector('#chat-name');
    const emailInput = form.querySelector('#chat-email');
    
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    
    console.log('Form values:', { name, email });
    
      if (name && email) {
        userInfo = { name, email };
        localStorage.setItem('chatUserInfo', JSON.stringify(userInfo));
        console.log('Saved user info:', userInfo);
        hideUserInfoForm();
        if (ws && ws.readyState === WebSocket.OPEN && !hasInitialized) {
          ws.send(JSON.stringify({
            type: 'init',
            browserId: browserId,
            userInfo: userInfo  
          }));
          hasInitialized = true;
        }
  //      showWelcomeMessage();
      } else {
        alert('Please provide both name and email');
      }
    });

  // Create and setup WebSocket connection
  function setupWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;
    console.log('Connecting to WebSocket:', wsUrl);
    
    ws = new WebSocket(wsUrl);
  
    ws.onopen = () => {
      console.log('WebSocket connected');
  
      // ❗ Only send init if we have user info
      if (userInfo.name && userInfo.email) {
        ws.send(JSON.stringify({
          type: 'init',
          browserId,
          userInfo
        }));
        hasInitialized = true;
      }
      
      // Show appropriate UI
      if (!userInfo.name || !userInfo.email) {
        showUserInfoForm();
      } else {
        hideUserInfoForm();
      }
    };
  
    ws.onmessage = handleWebSocketMessage;
  
    ws.onclose = () => {
      console.log('WebSocket disconnected. Retrying in 5s...');
      setTimeout(setupWebSocket, 5000);
      hasInitialized = false;

    };
  
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }
  

  // Initialize WebSocket when chat button is clicked
  chatButton.onclick = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setupWebSocket();
    }
    
    // Show chat modal
    modal.style.display = 'flex';
    
    // Show user info form if no user info exists
    if (!userInfo.name || !userInfo.email) {
      showUserInfoForm();
    } else {
      hideUserInfoForm();
    }
    chatButton.style.display = 'none';
  };

  // Handle close button
  document.getElementById('closeChat').onclick = () => {
    modal.style.display = 'none';
    chatButton.style.display = 'flex';
    // Restore body scroll
    document.body.style.overflow = '';
  };

  // Update send button handler
  sendButton.onclick = async () => {
    const message = input.value.trim();
    if (!message || !ws || ws.readyState !== WebSocket.OPEN) return;

    // Add user message to chat
    addMessage(message, 'user');
    input.value = '';

    // // Get user info from localStorage and validate
    // let userInfo = { name: '', email: '' };
    // try {
    //   const storedInfo = localStorage.getItem('chatUserInfo');
    //   if (storedInfo) {
    //     userInfo = JSON.parse(storedInfo);
    //     if (!userInfo.name || !userInfo.email) {
    //       console.warn('Invalid user info in localStorage');
    //       userInfo = { name: '', email: '' };
    //     }
    //   }
    // } catch (error) {
    //   console.error('Error loading user info:', error);
    // }

    // Send message through WebSocket with only browser ID
    ws.send(JSON.stringify({
      type: 'user_message',
      message: message,
      browserId: browserId,
      userInfo: userInfo
    }));
  };

  // Handle Enter key in input
  input.onkeypress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendButton.click();
    }
  };
}