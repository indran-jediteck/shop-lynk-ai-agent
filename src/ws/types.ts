import { WebSocket as WS } from 'ws';

export interface InitMessage {
  type: 'init';
  threadId: string;
}

export interface UserMessage {
  type: 'user_message';
  message: string;
}

export interface NewMessage {
  type: 'new_message';
  sender: 'user' | 'ai';
  message: string;
}

export interface SystemMessage {
  type: 'system_message';
  message: string;
}

export type WebSocketMessage = InitMessage | UserMessage | NewMessage | SystemMessage;

export interface WebSocketClient {
  threadId: string;
  socket: WS;
} 