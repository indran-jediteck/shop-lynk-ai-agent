import { WebSocket as WS } from 'ws';

export interface InitMessage {
  type: 'init';
  browserId: string;
  threadId?: string;
  assistantDbId: string;
  assistantId: string;
  userInfo?: {
    name: string;
    email: string;
  };
}

export interface UserMessage {
  type: 'user_message';
  message: string;
  threadId?: string;
  // store_id?: string;  // Add store_id for store-specific assistants
  assistantId: string;
  assistantDbId: string;
  userInfo?: {
    name: string;
    email: string;
  };
}

export interface NewMessage {
  type: 'new_message';
  browserId: string;
  message: string;
  sender: string;
}

export interface SystemMessage {
  type: 'system_message';
  browserId: string;
  message: string;
}

export type WebSocketMessage = InitMessage | UserMessage | NewMessage | SystemMessage;

export interface WebSocketClient {
  threadId: string;
  socket: WS;
} 