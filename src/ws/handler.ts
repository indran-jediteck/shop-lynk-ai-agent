import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { activeConnections } from './clients';
import { WebSocketMessage, InitMessage, UserMessage } from './types';
import { processUserMessage } from '../lib/openai';
import dotenv from 'dotenv';

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

  wss.on('connection', (ws: WebSocket) => {
    console.log('New WebSocket connection');

    ws.on('message', async (data: string) => {
      try {
        console.log('Received raw message:', data);
        const message: WebSocketMessage = JSON.parse(data);
        console.log('Parsed message:', message);
        
        switch (message.type) {
          case 'init':
            handleInit(ws, message);
            break;
          case 'user_message':
            await handleUserMessage(ws, message);
            break;
          default:
            console.warn('Unknown message type:', message.type);
        }
      } catch (error) {
        console.error('Error processing message:', error);
        ws.send(JSON.stringify({
          type: 'system_message',
          threadId: 'error',
          message: 'Error processing message'
        }));
      }
    });

    ws.on('close', () => {
      // Remove the connection from activeConnections
      for (const [threadId, socket] of activeConnections.entries()) {
        if (socket === ws) {
          activeConnections.delete(threadId);
          console.log('Client disconnected:', threadId);
          break;
        }
      }
    });
  });
}

function handleInit(ws: WebSocket, message: InitMessage) {
  console.log('Handling init message:', message);
  activeConnections.set(message.threadId, ws);
  ws.send(JSON.stringify({
    type: 'system_message',
    threadId: message.threadId,
    message: 'Connection established'
  }));
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
      message: 'thinking'
    }));

    // Process the message
    const response = await processUserMessage(threadId, message.message);
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