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
    const openaiThreadId = threadId;
    const response = await openaiService.sendMessage(openaiThreadId, content);
    console.log('OpenAI response:', response);
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

  private async handleProductSearch(args: {
    product_type: string;
    search_term?: string;
    color?: string;
    size?: string;
    material?: string;
    price_range?: {
      min: number;
      max: number;
    };
  }): Promise<any> {
    console.log('Performing product search with args:', args);
    
    try {
      // Validate required product_type parameter
      if (!args.product_type) {
        console.error('Missing required product_type parameter');
        throw new Error('product_type is required');
      }

      // Construct search parameters
      const searchParams = {
        search_term: args.search_term || args.product_type,
        color: args.color || 'any',
        size: args.size || 'standard',
        material: args.material || 'any',
        price_range: args.price_range || { min: 0, max: 1000 }
      };

      console.log('Search params:', searchParams);

      // Make request to our products API endpoint
      const response = await fetch('http://localhost:3000/api/products/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(searchParams)
      });

      if (!response.ok) {
        throw new Error(`Product search API error: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Product search response:', data);

      // Log each product's image URL for debugging
      data.results.forEach((product: any) => {
        console.log(`Product ${product.name} image URL:`, product.image);
      });

      return data;
    } catch (error) {
      console.error('Error in product search:', error);
      throw error;
    }
  }

  private async handleToolCalls(threadId: string, runId: string, toolCalls: OpenAI.Beta.Threads.Runs.RequiredActionFunctionToolCall[]): Promise<void> {
    const toolOutputs = [];

    for (const toolCall of toolCalls) {
      console.log('Processing tool call:', toolCall);
      console.log('Function name:', toolCall.function.name);
      console.log('Function arguments:', toolCall.function.arguments);

      if (toolCall.function.name === 'product_search') {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          console.log('Parsed arguments:', args);
          if (!args.product_type || typeof args.product_type !== 'string') {
            throw new Error('Missing or invalid product_type');
          }
        
          
          const result = await this.handleProductSearch(args);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result)
          });
        } catch (error) {
          console.error('Error processing product search:', error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ 
              error: 'Failed to process product search',
              details: error instanceof Error ? error.message : 'Unknown error'
            })
          });
        }
      }
    }

    if (toolOutputs.length > 0) {
      await this.client.beta.threads.runs.submitToolOutputs(threadId, runId, {
        tool_outputs: toolOutputs
      });
    }
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
        console.log('Run status:', runStatus.status);

        if (runStatus.status === 'failed') {
          throw new Error('Assistant run failed: ' + runStatus.last_error?.message);
        }
        if (runStatus.status === 'expired') {
          throw new Error('Assistant run expired');
        }
        if (runStatus.status === 'requires_action') {
          if (runStatus.required_action?.type === 'submit_tool_outputs') {
            const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
            await this.handleToolCalls(threadId, run.id, toolCalls);
          }
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

  public async createThreadWithContext(userInfo: { name: string; email: string }): Promise<string> {
    const thread = await this.client.beta.threads.create();
    const systemMessage = `New session started for user with first name ${userInfo.name} and email (${userInfo.email})`;
    console.log('System message:', systemMessage);
    await this.client.beta.threads.messages.create(thread.id, {
      role: 'assistant',
      content: systemMessage
    });

    return thread.id;
  }
} 