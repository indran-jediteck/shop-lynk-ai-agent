import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

if (!ASSISTANT_ID) {
  throw new Error('OPENAI_ASSISTANT_ID environment variable is not set');
}

// Map to store thread IDs
const threadMap = new Map<string, OpenAI.Beta.Threads.Thread>();

function isTextContent(content: OpenAI.Beta.Threads.Messages.MessageContent): content is OpenAI.Beta.Threads.Messages.TextContentBlock {
  return content.type === 'text';
}

export async function processUserMessage(threadId: string, content: string): Promise<string> {
  try {
    console.log('Processing user message:', content);
    console.log('Thread ID:', threadId);
    
    const openaiService = new OpenAIService();
    const openaiThreadId = await openaiService.getOrCreateThread(threadId);
    const response = await openaiService.sendMessage(openaiThreadId, content);
    return response;
  } catch (error) {
    console.error('Error processing message:', error);
    if (error instanceof Error) {
      return `I apologize, but I encountered an error: ${error.message}. Please try again or rephrase your message.`;
    }
    return 'I apologize, but I encountered an error processing your message. Please try again.';
  }
}

export class OpenAIService {
  private client: OpenAI;
  private assistantId: string;
  private threads: Map<string, string>;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    if (!process.env.OPENAI_ASSISTANT_ID) {
      throw new Error('OPENAI_ASSISTANT_ID environment variable is not set');
    }

    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.assistantId = process.env.OPENAI_ASSISTANT_ID;
    this.threads = new Map();
  }

  public async createThread(): Promise<string> {
    const thread = await this.client.beta.threads.create();
    return thread.id;
  }

  public async sendMessage(threadId: string, message: string): Promise<string> {
    try {
      // Add message to thread
      await this.client.beta.threads.messages.create(threadId, {
        role: 'user',
        content: message,
      });

      // Create and run
      const run = await this.client.beta.threads.runs.create(threadId, {
        assistant_id: this.assistantId,
      });

      // Wait for completion with timeout
      const maxAttempts = 30; // 30 seconds timeout
      let attempts = 0;
      let runStatus = await this.client.beta.threads.runs.retrieve(threadId, run.id);
      
      while (runStatus.status !== 'completed' && attempts < maxAttempts) {
        if (runStatus.status === 'failed') {
          throw new Error('Assistant run failed: ' + runStatus.last_error?.message);
        }
        if (runStatus.status === 'expired') {
          throw new Error('Assistant run expired');
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        runStatus = await this.client.beta.threads.runs.retrieve(threadId, run.id);
        attempts++;
      }

      if (attempts >= maxAttempts) {
        throw new Error('Response timeout: The assistant took too long to respond');
      }

      // Get the assistant's response
      const messages = await this.client.beta.threads.messages.list(threadId);
      const assistantMessage = messages.data.find(m => m.role === 'assistant');
      
      if (!assistantMessage) {
        throw new Error('No response received from assistant');
      }

      // Process all content blocks
      let responseText = '';
      for (const content of assistantMessage.content) {
        if (isTextContent(content)) {
          responseText += content.text.value + '\n';
        }
      }

      // Clean up the response
      responseText = responseText.trim();
      console.log('Assistant response:', responseText);

      if (!responseText) {
        throw new Error('Empty response from assistant');
      }

      return responseText;
    } catch (error) {
      console.error('Error in sendMessage:', error);
      throw error; // Re-throw to be handled by processUserMessage
    }
  }

  public async getOrCreateThread(threadId: string): Promise<string> {
    if (!this.threads.has(threadId)) {
      const newThreadId = await this.createThread();
      this.threads.set(threadId, newThreadId);
      return newThreadId;
    }
    return this.threads.get(threadId)!;
  }
} 