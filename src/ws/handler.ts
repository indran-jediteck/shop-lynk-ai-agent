import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { activeConnections } from './clients';
import { WebSocketMessage, InitMessage, UserMessage } from './types';
import { processUserMessage, OpenAIService } from '../lib/openai';
import dotenv from 'dotenv';
import { storeBrowserThread } from '../lib/db';

dotenv.config();

async function sendToDiscord(message: string, sender: string, threadId: string, userInfo?: { name: string; email: string }) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  
  // Fire and forget - don't await the Discord webhook
  fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: `**${sender}** (Thread: ${threadId})${userInfo ? `\n**User:** ${userInfo.name} (${userInfo.email})` : ''}:\n${message}`,
    }),
  }).catch(error => {
    console.error('Error sending message to Discord:', error);
  });
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server });
  console.log('WebSocket server initialized');

  wss.on('connection', (ws: WebSocket) => {
    console.log('New WebSocket connection established');

    ws.on('message', async (data: Buffer | string) => {
      try {
        // Convert Buffer to string if needed
        const messageStr = data instanceof Buffer ? data.toString('utf8') : data as string;
        console.log('Raw message received (as string):', messageStr);
        
        const message: WebSocketMessage = JSON.parse(messageStr);
        console.log('Parsed message object:', JSON.stringify(message, null, 2));
        
        switch (message.type) {
          case 'init':
            await handleInit(ws, message as InitMessage);
            break;  
          case 'user_message':
            console.log('Received user message, passing to handler');
            await handleUserMessage(ws, message);
            break;
            
          default:
            console.warn('Unknown message type:', message.type);
        }
      } catch (error) {
        console.error('Error processing message:', error);
        if (error instanceof Error) {
          console.error('Error details:', error.message);
          console.error('Error stack:', error.stack);
        }
        ws.send(JSON.stringify({
          type: 'system_message',
          message: 'Error processing message'
        }));
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      for (const [browserId, socket] of activeConnections.entries()) {
        if (socket === ws) {
          activeConnections.delete(browserId);
          console.log('Removed connection. BrowserId:', browserId);
          console.log('Remaining connections:', Array.from(activeConnections.keys()));
          break;
        }
      }
    });
  });
}

async function handleInit(ws: WebSocket, message: InitMessage) {
  console.log('Handling init message ---:', message);

  if (activeConnections.has(message.browserId)) {
    console.log('BrowserId already registered. Skipping duplicate init.');
    return;
  }

  if (!message.userInfo || !message.userInfo.name || !message.userInfo.email) {
    console.warn('Init received without complete userInfo. Ignoring.');
    return;
  }

  // check if threadid from front end is not null
  if (message.threadId) {
    console.log('ThreadId already exists. Skipping duplicate init.');
  }else{
    //threadid is null then make openai call to create a thread
    console.log('ThreadId does not  exists. creating a new one ');
    const openaiService = new OpenAIService();
    message.threadId = await openaiService.createThreadWithContext(message.userInfo);
    console.log('ThreadId created:', message.threadId);
    //we need to store this in mongo for api/inject to look it up no?
    //store in mongo with email, name , browserid and threadid shopify_browser_thread collection  
    await storeBrowserThread(message.userInfo.email, message.userInfo.name, message.browserId, message.threadId);
  }

  activeConnections.set(message.browserId, ws);

  ws.send(JSON.stringify({
    type: 'init_ack',
    browserId: message.browserId,
    threadId: message.threadId,
    message: 'Connection established'
  }));

  const firstName = message.userInfo.name.split(' ')[0] || 'there';
  ws.send(JSON.stringify({
    type: 'new_message',
    message: `Hi ${firstName}! 👋 I'm your AI assistant. How can I help you today?`,
    sender: 'ai',
    browserId: message.browserId,
    followUpActions: [
      { text: 'Return/Exchange', prompt: 'What is the return policy?' },
      { text: 'Schedule appointment', prompt: 'Can I schedule an appointment?' },
      { text: 'Studio hours', prompt: 'What are your studio hours?' },
      { text: 'Contact support', prompt: 'I need to speak with customer support' },
      { text: 'Order Status', prompt: 'Can you help me check the status of my order?' },
      { text: 'Product question', prompt: 'I have a question about a product' }
    ]
  }))

  console.log('Active connections after init:', Array.from(activeConnections.keys()));
}

async function handleUserMessage(ws: WebSocket, message: UserMessage) {
  console.log('Handling user message:', {
    type: message.type,
    threadId: message.threadId,
    userInfo: message.userInfo,
    messageLength: message.message.length
  });

  const threadId = message.threadId || 'default';

  try {
    // Send user message to Discord without awaiting
    sendToDiscord(message.message, 'User', threadId, message.userInfo);

    // Send thinking message
    ws.send(JSON.stringify({
      type: 'system_message',
      threadId: threadId,
      message: 'Typing'
    }));

    // Ensure we have store_id
    if (!message.store_id) {
      ws.send(JSON.stringify({
        type: 'system_message',
        threadId: threadId,
        message: 'Store ID is required for this operation'
      }));
      return;
    }

    // Process the message
    const response = await processUserMessage(threadId, message.message, message.store_id);
    console.log('OpenAI response received:', {
      threadId,
      responseLength: response.length
    });

    // Send assistant response to Discord without awaiting
    sendToDiscord(response, 'Assistant', threadId, message.userInfo);

    // Send response to user
    ws.send(JSON.stringify({
      type: 'new_message',
      message: response,
      sender: 'ai',
      threadId: threadId
    }));
  } catch (error) {
    console.error('Error in handleUserMessage:', error);
    
    // Send error message to user
    ws.send(JSON.stringify({
      type: 'system_message',
      threadId: threadId,
      message: error instanceof Error ? error.message : 'An error occurred while processing your message'
    }));
  }
} 