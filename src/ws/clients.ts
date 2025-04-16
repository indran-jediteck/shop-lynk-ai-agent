import { WebSocket } from 'ws';
import { WebSocketClient } from './types';

export const activeConnections = new Map<string, WebSocket>();

export class WebSocketClients {
  private clients: Map<string, WebSocketClient>;

  constructor() {
    this.clients = new Map();
  }

  addClient(threadId: string, socket: WebSocket): void {
    this.clients.set(threadId, { threadId, socket });
  }

  removeClient(threadId: string): void {
    this.clients.delete(threadId);
  }

  getClient(threadId: string): WebSocketClient | undefined {
    return this.clients.get(threadId);
  }

  broadcastToThread(threadId: string, message: string): void {
    const client = this.getClient(threadId);
    if (client && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(message);
    }
  }

  getActiveThreads(): string[] {
    return Array.from(this.clients.keys());
  }
} 