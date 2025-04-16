import { WebSocketServer, WebSocket } from 'ws';
import { WebSocketClients } from './clients';
import { WebSocketMessage, InitMessage, UserMessage } from './types';
import { OpenAIService } from '../lib/openai';

export class WebSocketHandler {
  private wss: WebSocketServer;
  private clients: WebSocketClients;
  private openai: OpenAIService;

  constructor(server: any) {
    this.wss = new WebSocketServer({ server });
    this.clients = new WebSocketClients();
    this.openai = new OpenAIService();
    this.setupWebSocket();
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New WebSocket connection established');

      ws.on('message', (data: string) => {
        try {
          const message: WebSocketMessage = JSON.parse(data);
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
          ws.send(JSON.stringify({
            type: 'system_message',
            message: 'Error processing message'
          }));
        }
      });

      ws.on('close', () => {
        // Find and remove the client
        const threadId = Array.from(this.clients.getActiveThreads()).find(
          id => this.clients.getClient(id)?.socket === ws
        );
        if (threadId) {
          this.clients.removeClient(threadId);
          console.log(`Client disconnected: ${threadId}`);
        }
      });
    });
  }

  private handleMessage(ws: WebSocket, message: WebSocketMessage): void {
    switch (message.type) {
      case 'init':
        this.handleInit(ws, message);
        break;
      case 'user_message':
        this.handleUserMessage(ws, message);
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  private handleInit(ws: WebSocket, message: InitMessage): void {
    this.clients.addClient(message.threadId, ws);
    console.log(`Client initialized with threadId: ${message.threadId}`);
    ws.send(JSON.stringify({
      type: 'system_message',
      message: 'Connection established'
    }));
  }

  private async handleUserMessage(ws: WebSocket, message: UserMessage): Promise<void> {
    try {
      // Find the threadId for this connection
      const threadId = Array.from(this.clients.getActiveThreads()).find(
        id => this.clients.getClient(id)?.socket === ws
      );

      if (!threadId) {
        throw new Error('No active thread found for this connection');
      }

      // Send thinking message
      this.clients.broadcastToThread(threadId, JSON.stringify({
        type: 'system_message',
        message: 'Assistant is thinking...'
      }));

      // Get OpenAI thread ID or create new one
      const openaiThreadId = await this.openai.getOrCreateThread(threadId);
      
      // Get AI response
      const response = await this.openai.sendMessage(openaiThreadId, message.message);

      // Send response back to client
      this.clients.broadcastToThread(threadId, JSON.stringify({
        type: 'new_message',
        sender: 'ai',
        message: response
      }));

    } catch (error) {
      console.error('Error handling user message:', error);
      ws.send(JSON.stringify({
        type: 'system_message',
        message: 'Sorry, there was an error processing your message. Please try again.'
      }));
    }
  }

  public broadcastToThread(threadId: string, message: string): void {
    this.clients.broadcastToThread(threadId, message);
  }
} 