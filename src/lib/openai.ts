import OpenAI from 'openai';

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
    
    return assistantMessage?.content[0].text?.value || 'No response from assistant';
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