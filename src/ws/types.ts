import { WebSocket as WS } from 'ws';

export interface InitMessage {
  type: 'init';
  threadId: string;
}

export interface UserMessage {
  type: 'user_message';
  message: string;
  threadId?: string;
  userInfo?: {
    name: string;
    email: string;
  };
}

export interface NewMessage {
  type: 'new_message';
  threadId: string;
  content: string;
  role: 'user' | 'assistant';
}

export interface SystemMessage {
  type: 'system_message';
  threadId: string;
  content: string;
}

export type WebSocketMessage = InitMessage | UserMessage | NewMessage | SystemMessage;

export interface WebSocketClient {
  threadId: string;
  socket: WS;
} 