import OpenAI from 'openai';
import dotenv from 'dotenv';
import { Pinecone } from '@pinecone-database/pinecone';
import { ObjectId } from 'mongodb';
import { MongoClient } from 'mongodb';

dotenv.config();
interface SearchParams {
  search_query: string;
  store_id: string;
  filters: {
    category: string;
    price_range: { min: number; max: number };
    availability: 'in_stock' | 'out_of_stock';
  };
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

if (!ASSISTANT_ID) {
  throw new Error('OPENAI_ASSISTANT_ID environment variable is not set');
}else{
  console.log('ASSISTANT_ID:', ASSISTANT_ID);
}

// Map to store thread IDs
const threadMap = new Map<string, OpenAI.Beta.Threads.Thread>();

function isTextContent(content: OpenAI.Beta.Threads.Messages.MessageContent): content is OpenAI.Beta.Threads.Messages.TextContentBlock {
  return content.type === 'text';
}

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  return response.data[0].embedding;
}

export async function vectorProductSearch(searchParams: SearchParams & { store_id: string }) {
  const { search_query, filters, store_id } = searchParams;

  const embedding = await getEmbedding(search_query);

  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!
  });

  const index = pinecone.Index(process.env.PINECONE_INDEX!);

  // Minimal Pinecone filter for speed — just store_id
  const pineconeFilter: Record<string, any> = {
    store_id
  }

  const vectorResults = await index.query({
    vector: embedding,
    topK: 10,
    includeMetadata: true,
    filter: pineconeFilter
  });
  console.log('Vector results:', vectorResults);
  // Step 1: Extract Shopify product ID from the 'gid://shopify/Product/123456' format
  const pineconeIds = vectorResults.matches
  .map(match => match.id)
  .filter((id): id is string => typeof id === 'string');

  console.log('Pinecone GIDs:', pineconeIds);

//  const mongoIds = vectorResults.matches
//    .map(match => match.metadata?.mongo_id)
//    .filter((id): id is string => Boolean(id));
//  console.log('Mongo IDs:', mongoIds);

  // Step 2: Fetch products from MongoDB using the Shopify IDs
  const db = await MongoClient.connect(process.env.MONGODB_URI!);
  const products = await db.db().collection('Shopify_Products')
  .find({ admin_graphql_api_id: { $in: pineconeIds } })
  .toArray();

  console.log('Products:', products);

  return { results: products };
}

export async function processUserMessage(threadId: string, content: string): Promise<string> {
  try {
    console.log('Processing user message:', content);
    console.log('Thread ID:', threadId);
    console.log('ASSISTANT_ID:', ASSISTANT_ID);
    const openaiService = new OpenAIService();
    const openaiThreadId = threadId;
    const response = await openaiService.sendMessage(openaiThreadId, content);
    
    // If the response is our "hold on" message, return it directly
    if (response === "Hold on, still working on your last request...") {
      return response;
    }
    
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
        search_query: args.search_term || args.product_type,
        store_id: "jcsfashions",
        filters: {
          category: args.product_type,
          price_range: args.price_range || { min: 0, max: 1000 },
          availability: 'in_stock' as 'in_stock' | 'out_of_stock'
        }
      };

      console.log('Search params:', searchParams);

      // Make request to our products API endpoint
      const data = await vectorProductSearch(searchParams);
      console.log('Product search response from  now:', data);
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
      
          const productType = args.product_type || (args.filters?.category ?? null);
      
          if (!productType || typeof productType !== 'string') {
            console.warn('No product_type provided — using fallback or skipping category filter');
          }
      
          const result = await this.handleProductSearch({
            product_type: productType || 'general', // fallback if needed
            search_term: args.search_query,
            color: args.color,
            size: args.size,
            material: args.material,
            price_range: args.filters?.price_range || { min: 0, max: 1000 }
          });
      
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
      // Step 1: Check for any active run
      const runs = await this.client.beta.threads.runs.list(threadId);
      const activeRun = runs.data.find(run => 
        run.status === 'in_progress' || 
        run.status === 'queued' || 
        run.status === 'requires_action'
      );
  
      if (activeRun) {
        console.log('Active run found:', activeRun.id, 'with status:', activeRun.status);
        return "Hold on, still working on your last request...";
      }
  
      // Step 2: Add message to thread
      try {
        await this.client.beta.threads.messages.create(threadId, {
          role: 'user',
          content: message,
        });
      } catch (error) {
        // If we get the "can't add messages" error, return wait message
        if (error instanceof Error && 
            error.message.includes("Can't add messages to thread") && 
            error.message.includes("while a run is active")) {
          return "Hold on, still working on your last request";
        }
        throw error; // Re-throw other errors
      }
  
      // Step 3: Create and run
      const run = await this.client.beta.threads.runs.create(threadId, {
        assistant_id: this.assistantId,
      });
  
      // Step 4: Wait for completion (same as before)
      const maxAttempts = 30;
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
  
      // Step 5: Get assistant's response
      const messages = await this.client.beta.threads.messages.list(threadId);
      const assistantMessage = messages.data.find(m => m.role === 'assistant');
      
      if (!assistantMessage) {
        throw new Error('No response received from assistant');
      }
  
      // Step 6: Extract text response
      let responseText = '';
      for (const content of assistantMessage.content) {
        if (isTextContent(content)) {
          responseText += content.text.value + '\n';
        }
      }
  
      responseText = responseText
        .trim()
        .replace(/【.*?】/g, '')
        .replace(/\d+:\d+†source/g, '');
  
      if (!responseText) {
        throw new Error('Empty response from assistant');
      }
  
      return responseText;
  
    } catch (error) {
      console.error('Error in sendMessage:', error);
      
      // Type check the error before accessing message
      if (error instanceof Error && (
          (error.message.includes("Can't add messages to thread") && error.message.includes("while a run is active")) ||
          error.message.includes("already has an active run")
      )) {
        return "Hold on, still working on your last request...";
      }
      
      throw error; // Re-throw other errors to be handled by processUserMessage
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