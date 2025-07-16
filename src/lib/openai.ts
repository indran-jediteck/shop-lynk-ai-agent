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

// Remove or comment out the global ASSISTANT_ID usage
// const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// if (!ASSISTANT_ID) {
//   throw new Error('OPENAI_ASSISTANT_ID environment variable is not set');
// }else{
//   console.log('ASSISTANT_ID:', ASSISTANT_ID);
// }

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

let openaiServiceInstance: OpenAIService | null = null;

export async function processUserMessage(threadId: string, content: string, assistantId: string): Promise<string> {
  try {
    // Reuse the same instance
    if (!openaiServiceInstance) {
      openaiServiceInstance = new OpenAIService();
    }
    
    const response = await openaiServiceInstance.sendMessage(threadId, content, assistantId);
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
  private assistantId?: string; // Make optional
  private threads: Map<string, string>;
  private assistantCache: Map<string, string> = new Map(); // Add cache

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    // Remove the requirement for OPENAI_ASSISTANT_ID
    // if (!process.env.OPENAI_ASSISTANT_ID) {
    //   throw new Error('OPENAI_ASSISTANT_ID environment variable is not set');
    // }

    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    // this.assistantId = process.env.OPENAI_ASSISTANT_ID; // Optional fallback
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

  private async handleVectorSearch(args: {
    search_query: string;
    store_id: string;
    filters?: {
      category: string;  // Required in interface
      price_range: { min: number; max: number };  // Required in interface
      availability: 'in_stock' | 'out_of_stock';  // Required in interface
    };
  }): Promise<any> {
    console.log('Performing vector search with args:', args);
    
    try {
      const searchParams = {
        search_query: args.search_query,
        store_id: args.store_id,
        filters: args.filters || {
          category: 'general',
          price_range: { min: 0, max: 1000 },
          availability: 'in_stock'
        }
      };

      console.log('Vector search params:', searchParams);
      const data = await vectorProductSearch(searchParams);
      return data;
    } catch (error) {
      console.error('Error in vector search:', error);
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
      if (toolCall.function.name === 'vector_search') {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          console.log('Vector search arguments:', args);
          
          const result = await this.handleVectorSearch({
            search_query: args.search_query,
            store_id: args.store_id,
            filters: args.filters
          });
          
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result)
          });
        } catch (error) {
          console.error('Error processing vector search:', error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ 
              error: 'Failed to process vector search',
              details: error instanceof Error ? error.message : 'Unknown error'
            })
          });
        }
      }
      if (toolCall.function.name === 'get_order_status') {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await this.handleOrderStatus({ 
          order_id: args.order_id, 
          store_id: args.store_id 
        });
      
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(result)
        });
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

  public async sendMessage(
    threadId: string, 
    message: string, 
    assistantId: string // Add this parameter
  ): Promise<string> {
    try {
      // Validate that we have either store_id or fallback assistant
      // if (!store_id && !this.assistantId) {
      //   throw new Error('Either store_id or OPENAI_ASSISTANT_ID environment variable is required');
      // }

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
      const finalAssistantId = assistantId 
      // || (store_id ? 
        // await this.getStoreAssistant(store_id) : 
        // this.assistantId!); // Use fallback assistant
        
      const run = await this.client.beta.threads.runs.create(threadId, {
        assistant_id: finalAssistantId,
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

  // Cache assistant_id per store
  private async getStoreAssistant(store_id: string): Promise<string> {
    // Check cache first
    if (this.assistantCache.has(store_id)) {
      return this.assistantCache.get(store_id)!;
    }

    // Fetch from MongoDB if not cached
    const db = await MongoClient.connect(process.env.MONGODB_URI!);
    const store = await db.db().collection('ShopifyStore').findOne({ store_id });
    await db.close();
    
    if (!store?.agents?.length) {
      throw new Error(`No agents found for store ${store_id}`);
    }
    
    const lastAgent = store.agents[store.agents.length - 1];
    const assistantId = lastAgent.openai_assistant_id;
    
    if (!assistantId) {
      throw new Error(`No assistant ID found for store ${store_id}`);
    }else{
      console.log('Assistant found for store:', assistantId);
    }
    
    // Cache the result
    this.assistantCache.set(store_id, assistantId);
    return assistantId;
  }

  private async getStoreConfig(store_id: string): Promise<any> {
    const db = await MongoClient.connect(process.env.MONGODB_URI!);
    const store = await db.db().collection('ShopifyStore').findOne({ store_id });
    await db.close();
    
    if (!store) {
      throw new Error(`Store ${store_id} not found`);
    }
    
    return store;
  }

  private async handleOrderStatus(args: { order_id: string; store_id?: string }) {
    const { order_id, store_id } = args;
    
    // Use store-specific config if store_id provided, otherwise fallback to env vars
    let shopifyDomain: string;
    let accessToken: string;
    
    if (store_id) {
      const store = await this.getStoreConfig(store_id);
      shopifyDomain = store.shopify_domain;
      accessToken = store.access_token;
    } else {
      // Fallback to environment variables for backward compatibility
      shopifyDomain = process.env.cust_store_name!;
      accessToken = process.env.cust_access_token!;
    }
    
    console.log('Shopify domain:', shopifyDomain);
    console.log('Access token:', accessToken);
    console.log('Order number:', order_id);
    console.log('Store ID:', store_id || 'default');
 
    if (!shopifyDomain || !accessToken) {
      throw new Error("Missing Shopify credentials.");
    }
  
    try {
      // Encode '#' if order_number includes it (e.g., '#1001')
      const encodedOrderNumber = encodeURIComponent(order_id);
  
      const searchUrl = `https://${shopifyDomain}/admin/api/2023-10/orders.json?name=${encodedOrderNumber}&status=any&limit=1`;
      const searchRes = await fetch(searchUrl, {
        headers: {
          'X-Shopify-Access-Token': accessToken!,
          'Content-Type': 'application/json',
        },
      });
  
      if (!searchRes.ok) {
        throw new Error(`Order lookup failed: ${searchRes.statusText}`);
      }
  
      const { orders } = await searchRes.json();
  
      if (!orders || orders.length === 0) {
        throw new Error(`Order ${order_id} not found.`);
      }
  
      const orderId = orders[0].id;
  
      const orderUrl = `https://${shopifyDomain}/admin/api/2023-10/orders/${orderId}.json`;
      const orderRes = await fetch(orderUrl, {
        headers: {
          'X-Shopify-Access-Token': accessToken!,
          'Content-Type': 'application/json',
        },
      });
  
      if (!orderRes.ok) {
        throw new Error(`Order fetch failed: ${orderRes.statusText}`);
      }
  
      const { order } = await orderRes.json();
  
      return {
        order_id: order.id,
        name: order.name,
        financial_status: order.financial_status,
        fulfillment_status: order.fulfillment_status,
        cancelled_at: order.cancelled_at,
      };
    } catch (err) {
      console.error('Order status fetch failed:', err);
      throw err;
    }
  }
}