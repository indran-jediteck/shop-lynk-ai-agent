import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { activeConnections } from './clients';
import { WebSocketMessage, InitMessage, UserMessage } from './types';
import { processUserMessage } from '../lib/openai';
import dotenv from 'dotenv';

dotenv.config();

async function sendToDiscord(message: string, sender: string, threadId: string, userInfo?: { name: string; email: string }) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  
  try {
    const userDetails = userInfo ? `\n**User:** ${userInfo.name} (${userInfo.email})` : '';
    const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: `**${sender}** (Thread: ${threadId})${userDetails}:\n${message}`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Discord webhook error: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error sending message to Discord:', error);
  }
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
  console.log('Handling user message:', message);
  console.log('Message type:', message.type);
  console.log('Message content:', message.message);
  console.log('Message threadId:', message.threadId);
  console.log('User info:', message.userInfo);
  console.log('Full message object:', JSON.stringify(message, null, 2));

  // Send user message to Discord
  await sendToDiscord(message.message, 'User', message.threadId || 'default', message.userInfo);

  // Send thinking message
  ws.send(JSON.stringify({
    type: 'system_message',
    threadId: message.threadId || 'default',
    message: 'Assistant is thinking...'
  }));

  const response = await processUserMessage(message.threadId || 'default', message.message);
  console.log('OpenAI response:', response);

  // Send assistant response to Discord
  await sendToDiscord(response, 'Assistant', message.threadId || 'default', message.userInfo);

  ws.send(JSON.stringify({
    type: 'new_message',
    message: response,
    sender: 'assistant'
  }));
} 