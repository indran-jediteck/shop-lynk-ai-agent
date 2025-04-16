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
    return 'This is a test response from the AI assistant.';


  } catch (error) {
    console.error('Error processing message:', error);
    return 'An error occurred while processing your message.';
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
    // Add message to thread
    await this.client.beta.threads.messages.create(threadId, {
      role: 'user',
      content: message,
    });

    // Create and run
    const run = await this.client.beta.threads.runs.create(threadId, {
      assistant_id: this.assistantId,
    });

    // Wait for completion
    let runStatus = await this.client.beta.threads.runs.retrieve(threadId, run.id);
    while (runStatus.status !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await this.client.beta.threads.runs.retrieve(threadId, run.id);
    }

    // Get the assistant's response
    const messages = await this.client.beta.threads.messages.list(threadId);
    const assistantMessage = messages.data.find(m => m.role === 'assistant');
    const textContent = assistantMessage?.content.find(isTextContent);
    
    return textContent?.text.value || 'No response from assistant';
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