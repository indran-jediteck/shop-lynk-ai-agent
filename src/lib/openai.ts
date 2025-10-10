import OpenAI from 'openai';
import dotenv from 'dotenv';
import { Pinecone } from '@pinecone-database/pinecone';
import { ObjectId } from 'mongodb';
import { MongoClient } from 'mongodb';



dotenv.config();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
interface SearchParams {
  search_query: string;
  store_id: string;
  // filters: {
  //   category: string;
  //   price_range: { min: number; max: number };
  //   availability: 'in_stock' | 'out_of_stock';
  // };
}
interface GreetUserToolResponse {
  has_cart: boolean;
  has_last_order: boolean;
  customer_name?: string;
  cart_data?: {
    draft_order_id: number;
    items: Array<{
      title: string;
      variant_title: string;
      quantity: number;
      price: string;
    }>;
    total_price: string;
    total_items: number;
    checkout_url: string;
  };
  last_order_data?: {
    order_id: number;
    purchased_date: string;
    days_since_purchase: number;
    items: Array<{
      title: string;
      quantity: number;
    }>;
  };
}

interface DraftOrderLineItemInput {
  variantId: string;                       // numeric id OR "gid://shopify/ProductVariant/<id>"
  quantity?: number;                       // defaults to 1
  properties?: Record<string, string>;     // optional line-item properties (custom attributes)
}

interface CreateDraftOrderRequest {
  items: DraftOrderLineItemInput[];        // list of items to include in the draft order
  storeId: string;                         // your internal store identifier (used to fetch shop config)
  customerEmail?: string;                  // optional customer email to attach to draft order
  note?: string;                           // optional admin note for the draft order
}

interface CreateDraftOrderResultSuccess {
  success: true;
  draftOrderId: number | string;
  checkoutUrl?: string;                    // draft_order.invoice_url
  itemsAdded: Array<{
    lineItemId?: number;
    variantId?: number | string;
    title?: string;
    variantTitle?: string;
    quantity?: number;
    price?: string;
    properties?: any;
  }>;
  totalQuantity: number;
  totalPrice?: string;
  message: string;
}

interface CreateDraftOrderResultError {
  success: false;
  error: string;
  message: string;
}

type CreateDraftOrderResult = CreateDraftOrderResultSuccess | CreateDraftOrderResultError

interface RemoveFromCartRequest {
  items: DraftOrderLineItemInput[];
  storeId: string;
  customerEmail?: string;
  note?: string;
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
  const { search_query, store_id } = searchParams;
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
  const adminGraphqlIds = vectorResults.matches
  .map(match => match.id)
  .filter((id): id is string => typeof id === 'string')
  .map(id => {
    const parts = id.split('_');
    return parts.length >= 3 ? `gid://shopify/Product/${parts[2]}` : null;
  })
  .filter((id): id is string => id !== null);

console.log('Admin GraphQL API IDs:', adminGraphqlIds);

//  const mongoIds = vectorResults.matches
//    .map(match => match.metadata?.mongo_id)
//    .filter((id): id is string => Boolean(id));
//  console.log('Mongo IDs:', mongoIds);

  // Step 2: Fetch products from MongoDB using the Shopify IDs
  const db = await MongoClient.connect(process.env.MONGODB_URI!);
  const products = await db.db().collection('Shopify_Products')
  .find({ admin_graphql_api_id: { $in: adminGraphqlIds } })
  .toArray();

  console.log('Products:', products);

  return { results: products };
}

let openaiServiceInstance: OpenAIService | null = null;

export async function processUserMessage(threadId: string, content: string, storeId: string, userInfo: any, assistantId: string): Promise<string> {
  try {
    // Reuse the same instance
    if (!openaiServiceInstance) {
      openaiServiceInstance = new OpenAIService();
    }
    
    const response = await openaiServiceInstance.sendMessage(threadId, content, storeId, userInfo.email, assistantId,userInfo.name);
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
        // filters: args.filters || {
        //   category: 'general',
        //   price_range: { min: 0, max: 1000 },
        //   availability: 'in_stock'
        // }
      };

      console.log('Vector search params:', searchParams);
      const data = await vectorProductSearch(searchParams);
      return data;
    } catch (error) {
      console.error('Error in vector search:', error);
      throw error;
    }
  }

  private async handleToolCalls(threadId: string, runId: string, toolCalls: OpenAI.Beta.Threads.Runs.RequiredActionFunctionToolCall[],storeId:string,email:string,name:string): Promise<void> {
    const toolOutputs = [];

    console.log('Processing all tool calls:', toolCalls);

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
            store_id: storeId,
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
          store_id: storeId 
        });
      
      
      
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(result)
        });
      }

      if (toolCall.function.name === 'add_to_cart') {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await this.handleAddToCart({ 
          items: args.items, 
          storeId: storeId,
          customerEmail: email 
        }); 
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(result)
        });
      }
      if (toolCall.function.name === 'remove_from_cart') {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await this.handleRemoveFromCart({ 
          items: args.items, 
          storeId: storeId,
          customerEmail: email 
        }); 
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(result)
        });
      }
      if (toolCall.function.name === 'greet_user') {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await this.handleGreetUser({ 
          customerEmail: email,
          storeId,
          customerName: name 
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
    storeId: string,
    email: string,
    assistantId: string,
    name : string
     // Add this parameter
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
            await this.handleToolCalls(threadId, run.id, toolCalls,storeId,email,name);
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

  public async createThreadWithContext(userInfo: { name: string; email: string; phone: string }): Promise<string> {
    const thread = await this.client.beta.threads.create();
    const systemMessage = `New session started for user with first name ${userInfo.name}, email (${userInfo.email}), and phone (${userInfo.phone})`;
    console.log('System message:', systemMessage);
    await this.client.beta.threads.messages.create(thread.id, {
      role: 'assistant',
      content: systemMessage
    });

    return thread.id;
  }

  // Cache assistant_id per store
  public async getStoreAssistant(store_id: string): Promise<string> {
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

  


  private async handleAddToCart(req: CreateDraftOrderRequest): Promise<CreateDraftOrderResult> {
    const { items, storeId, customerEmail, note } = req;
  
    // Validate input
    if (!Array.isArray(items) || items.length === 0) {
      return {
        success: false,
        error: 'NO_ITEMS',
        message: 'Please provide at least one item with a variantId.'
      };
    }
  
    try {
      // Load store credentials
      const storeConfig = await this.getStoreConfig(storeId);
      const { shopify_domain: shopDomain, access_token: accessToken } = storeConfig || {};
      
      if (!shopDomain || !accessToken) {
        throw new Error('Missing store configuration: shopify_domain or access_token.');
      }
  
      // Parse and validate line items
      const lineItems = this.parseLineItems(items);
      if ('error' in lineItems) {
        return lineItems;
      }
  
      // Build API URLs
      const baseUrl = `https://${shopDomain}/admin/api/2024-01`;
      const headers = {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      };
  
      let existingDraft = null;
      if (customerEmail) {
        const customerId = await this.getCustomerIdByEmail(shopDomain, accessToken, customerEmail);
        if (customerId) {
          existingDraft = await this.findDraftByCustomerId(baseUrl, headers, customerId);
        }
      }

      console.log("existingDraft: ", existingDraft);
  
      if (existingDraft) {
        // Update existing draft by merging line items
        return await this.updateDraftOrder(
          existingDraft,
          lineItems as any[],
          note,
          baseUrl,
          headers
        );
      }
  
      // Create new draft order
      return await this.createDraftOrder(
        lineItems as any[],
        customerEmail,
        note,
        baseUrl,
        headers
      );
  
    } catch (err) {
      console.error('handleAddToCart failed:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'UNKNOWN_ERROR',
        message: 'Failed to create or update draft order. Please try again.'
      };
    }
  }
  
  private parseLineItems(items: any[]): any[] | CreateDraftOrderResult {
    const lineItems = [];
  
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rawVariantId = item.variantId ?? item.variant_id ?? item.variant;
      const quantity = Math.max(1, Math.floor(Number(item.quantity ?? item.qty ?? 1)));
      const properties = item.properties ?? item.props;
  
      // Extract numeric variant ID
      const variantId = this.extractVariantId(rawVariantId);
      
      if (!variantId) {
        return {
          success: false,
          error: 'INVALID_VARIANT',
          message: `Invalid variant identifier at items[${i}]: ${String(rawVariantId)}`
        };
      }
  
      const lineItem: any = { variant_id: Number(variantId), quantity };
      if (properties && Object.keys(properties).length > 0) {
        lineItem.properties = properties;
      }
  
      lineItems.push(lineItem);
    }
  
    return lineItems;
  }
  
  private extractVariantId(rawId: any): string | null {
    if (!rawId) return null;
  
    const idString = String(rawId);
    const gidPrefix = 'gid://shopify/ProductVariant/';
    
    if (idString.startsWith(gidPrefix)) {
      return idString.replace(gidPrefix, '');
    }
  
    const match = idString.match(/(\d+)$/);
    return match && /^\d+$/.test(match[1]) ? match[1] : null;
  }
  

  
  private async updateDraftOrder(
    existingDraft: any,
    newLineItems: any[],
    note: string | undefined,
    baseUrl: string,
    headers: Record<string, string>
  ): Promise<CreateDraftOrderResult> {
    // Merge line items by variant ID
    const mergedItems = this.mergeLineItems(existingDraft.line_items || [], newLineItems);
  
    // Build update payload - Don't include the draft order ID in the body
    const payload: any = {
      draft_order: {
        id: existingDraft.id,
        line_items: mergedItems
      }
    };
  
    if (note) {
      payload.draft_order.note = note;
    }
  
    // Send update request
    const response = await fetch(`${baseUrl}/draft_orders/${existingDraft.id}.json`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload)
    });
  
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update draft order: ${errorText}`);
    }
  
    const { draft_order: updatedDraft } = await response.json();
    
    return this.formatDraftOrderResult(
      updatedDraft,
      `Updated existing draft order (id: ${updatedDraft.id}) with ${newLineItems.length} item(s).`
    );
  }
  
  private mergeLineItems(existingItems: any[], newItems: any[]): any[] {
    const itemsByVariant: Record<string, any> = {};
  
    // Index existing items - MUST keep the line item ID
    for (const item of existingItems) {
      const variantId = String(item.variant_id);
      itemsByVariant[variantId] = { 
        id: item.id,  // CRITICAL: Keep the line item ID
        variant_id: item.variant_id,
        quantity: item.quantity,
        ...(item.properties ? { properties: item.properties } : {}),
        ...(item.title ? { title: item.title } : {}),
        ...(item.price ? { price: item.price } : {})
      };
    }
  
    // Merge new items - increase quantity if variant exists
    for (const newItem of newItems) {
      const variantId = String(newItem.variant_id);
      
      if (itemsByVariant[variantId]) {
        // IMPORTANT: Increase quantity of existing item
        itemsByVariant[variantId].quantity += newItem.quantity;
      } else {
        // Add as new item (no id field for new items)
        itemsByVariant[variantId] = {
          variant_id: Number(newItem.variant_id),
          quantity: newItem.quantity,
          ...(newItem.properties ? { properties: newItem.properties } : {}),
          ...(newItem.title ? { title: newItem.title } : {}),
          ...(newItem.price ? { price: newItem.price } : {})
        };
      }
    }
  
    // Return all items - existing items MUST have their ID
    return Object.values(itemsByVariant).map(item => {
      const lineItem: any = {
        variant_id: Number(item.variant_id),
        quantity: item.quantity
      };
      
      // Include ID for existing items (this tells Shopify to UPDATE, not CREATE)
      if (item.id) {
        lineItem.id = item.id;
      }
      
      // Include optional fields
      if (item.properties) {
        lineItem.properties = item.properties;
      }
      if (item.title) {
        lineItem.title = item.title;
      }
      if (item.price) {
        lineItem.price = item.price;
      }
      
      return lineItem;
    });
  }
  
  private async createDraftOrder(
    lineItems: any[],
    customerEmail: string | undefined,
    note: string | undefined,
    baseUrl: string,
    headers: Record<string, string>
  ): Promise<CreateDraftOrderResult> {
    const payload: any = {
      draft_order: {
        line_items: lineItems,
        use_customer_default_address: false,
      }
    };
  
    if (customerEmail) {
      payload.draft_order.email = customerEmail;
    }
  
    if (note) {
      payload.draft_order.note = note;
    }
  
    const response = await fetch(`${baseUrl}/draft_orders.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Shopify draft order creation failed: ${errorText}`);
    }
  
    const { draft_order: createdDraft } = await response.json();
    
    return this.formatDraftOrderResult(
      createdDraft,
      `Created draft order with ${lineItems.length} line item(s).`
    );
  }
  
  private formatDraftOrderResult(draft: any, message: string): CreateDraftOrderResult {
    const itemsAdded = (draft.line_items || []).map((li: any) => ({
      lineItemId: li.id,
      variantId: li.variant_id,
      title: li.title,
      variantTitle: li.variant_title || '',
      quantity: li.quantity,
      price: li.price,
      properties: li.properties || null
    }));
  
    const totalQuantity = itemsAdded.reduce((sum: number, item: any) => sum + item.quantity, 0);
  
    return {
      success: true,
      draftOrderId: draft.id,
      checkoutUrl: draft.invoice_url,
      itemsAdded,
      totalQuantity,
      totalPrice: draft.total_price,
      message
    };
  }

  private async getCustomerIdByEmail(
    shopifyDomain: string,
    accessToken: string,
    email: string
  ): Promise<number | null> {
    try {
      console.log(shopifyDomain,"shopifdsfdsgf")
      const url = `https://${shopifyDomain}/admin/api/2023-10/customers/search.json?query=email:${email}`;
  
      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': accessToken
        }
      });
  
      if (!response.ok) {
        const errorBody = await response.json();
        console.warn(`Shopify API error: ${response.statusText} - ${JSON.stringify(errorBody)}`);
        return null;
      }
  
      const data = await response.json() as { customers: any[] };
      console.log('Customer data:', data);
      
      const customer = data.customers?.[0];
      
      
      if (!customer) {
        console.log(`No customer found with email: ${email}`);
        return null;
      }
  
      console.log(`Found customer: ID ${customer.id}`);
      return customer.id;
  
    } catch (error) {
      console.warn('Error searching for customer:', error);
      return null;
    }
  }
private async findDraftByCustomerId(
baseUrl: string,
headers: Record<string, string>,
customerId: number
): Promise<any | null> {
try {
  const response = await fetch(`${baseUrl}/draft_orders.json`, {
    method: 'GET',
    headers
  });

  if (!response.ok) {
    console.warn('Could not fetch draft orders for customer. Status:', response.status);
    return null;
  }

  const data = await response.json();
  const drafts = data.draft_orders || [];
  console.log(drafts,"drafts")

  
  const existingDraft = drafts.find((draft: any) => {
    console.log(draft,"drafttttt")
    if(draft.customer.id){
    const isCustomerExist = draft.customer.id === customerId;
    const isOpen = draft.status === 'open';
    
    return isOpen && isCustomerExist;
    }
    return null;
  });

  if (existingDraft) {
    console.log(`Found existing draft: ID ${existingDraft.id} for customer ${customerId}`);
  } else {
    console.log(`No open chatbot draft found for customer ${customerId}`);
  }
  
  return existingDraft || null;

} catch (error) {
  console.warn('Error finding draft by customer ID:', error);
  return null;
}
}



//REMOVE FROM THE CART



// Main function to handle remove from cart
private async handleRemoveFromCart(req: RemoveFromCartRequest): Promise<CreateDraftOrderResult> {
  const { items, storeId, customerEmail, note } = req;

  // Validate input
  if (!Array.isArray(items) || items.length === 0) {
    return {
      success: false,
      error: 'NO_ITEMS',
      message: 'Please provide at least one item with a variantId to remove.'
    };
  }

  if (!customerEmail) {
    return {
      success: false,
      error: 'NO_CUSTOMER_EMAIL',
      message: 'Customer email is required to remove items from cart.'
    };
  }

  try {
    // Load store credentials
    const storeConfig = await this.getStoreConfig(storeId);
    const { shopify_domain: shopDomain, access_token: accessToken } = storeConfig || {};
    
    if (!shopDomain || !accessToken) {
      throw new Error('Missing store configuration: shopify_domain or access_token.');
    }

    // Parse and validate line items to remove
    const lineItemsToRemove = this.parseLineItems(items);
    if ('error' in lineItemsToRemove) {
      return lineItemsToRemove;
    }

    // Build API URLs
    const baseUrl = `https://${shopDomain}/admin/api/2024-01`;
    const headers = {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    };

    // Find customer and their draft order
    const customerId = await this.getCustomerIdByEmail(shopDomain, accessToken, customerEmail);
    if (!customerId) {
      return {
        success: false,
        error: 'CUSTOMER_NOT_FOUND',
        message: `No customer found with email: ${customerEmail}`
      };
    }

    const existingDraft = await this.findDraftByCustomerId(baseUrl, headers, customerId);
    
    if (!existingDraft) {
      return {
        success: false,
        error: 'NO_DRAFT_ORDER',
        message: 'No open draft order found for this customer.'
      };
    }

    console.log("existingDraft for removal: ", existingDraft);

    // Remove items from draft order
    return await this.removeFromDraftOrder(
      existingDraft,
      lineItemsToRemove as any[],
      note,
      baseUrl,
      headers
    );

  } catch (err) {
    console.error('handleRemoveFromCart failed:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'UNKNOWN_ERROR',
      message: 'Failed to remove items from draft order. Please try again.'
    };
  }
}

// Function to remove items from draft order
private async removeFromDraftOrder(
  existingDraft: any,
  itemsToRemove: any[],
  note: string | undefined,
  baseUrl: string,
  headers: Record<string, string>
): Promise<CreateDraftOrderResult> {
  // Reduce quantities or remove items completely
  const updatedItems = this.reduceLineItems(existingDraft.line_items || [], itemsToRemove);

  // Check if cart is now empty
  if (updatedItems.length === 0) {
    // Delete the draft order if all items are removed
    return await this.deleteDraftOrder(existingDraft.id, baseUrl, headers);
  }

  // Build update payload
  const payload: any = {
    draft_order: {
      line_items: updatedItems
    }
  };

  if (note) {
    payload.draft_order.note = note;
  }

  // Send update request
  const response = await fetch(`${baseUrl}/draft_orders/${existingDraft.id}.json`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update draft order: ${errorText}`);
  }

  const { draft_order: updatedDraft } = await response.json();
  
  return this.formatDraftOrderResult(
    updatedDraft,
    `Removed ${itemsToRemove.length} item(s) from draft order (id: ${updatedDraft.id}).`
  );
}

// Function to reduce line items by quantity or remove them completely
private reduceLineItems(existingItems: any[], itemsToRemove: any[]): any[] {
  const itemsByVariant: Record<string, any> = {};

  // Index existing items with their line item IDs
  for (const item of existingItems) {
    const variantId = String(item.variant_id);
    itemsByVariant[variantId] = { 
      id: item.id,  // Keep the line item ID
      variant_id: item.variant_id,
      quantity: item.quantity,
      ...(item.properties ? { properties: item.properties } : {}),
      ...(item.title ? { title: item.title } : {}),
      ...(item.price ? { price: item.price } : {})
    };
  }

  // Reduce quantities for items to remove
  for (const removeItem of itemsToRemove) {
    const variantId = String(removeItem.variant_id);
    
    if (itemsByVariant[variantId]) {
      // Reduce quantity
      itemsByVariant[variantId].quantity -= removeItem.quantity;
      
      // If quantity is 0 or negative, remove the item completely
      if (itemsByVariant[variantId].quantity <= 0) {
        delete itemsByVariant[variantId];
      }
    }
    // If item doesn't exist, just ignore (can't remove what's not there)
  }

  // Return remaining items with their IDs
  return Object.values(itemsByVariant).map(item => {
    const lineItem: any = {
      id: item.id,  // MUST include ID for existing items
      variant_id: Number(item.variant_id),
      quantity: item.quantity
    };
    
    // Include optional fields
    if (item.properties) {
      lineItem.properties = item.properties;
    }
    if (item.title) {
      lineItem.title = item.title;
    }
    if (item.price) {
      lineItem.price = item.price;
    }
    
    return lineItem;
  });
}

// Function to delete a draft order when cart becomes empty
private async deleteDraftOrder(
  draftOrderId: number,
  baseUrl: string,
  headers: Record<string, string>
): Promise<CreateDraftOrderResult> {
  const response = await fetch(`${baseUrl}/draft_orders/${draftOrderId}.json`, {
    method: 'DELETE',
    headers
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to delete empty draft order: ${errorText}`);
  }

  return {
    success: true,
    draftOrderId,
    itemsAdded: [],
    totalQuantity: 0,
    totalPrice: '0.00',
    message: 'All items removed. Draft order has been deleted.'
  };
}


private async handleGreetUser({
  customerEmail,
  storeId,
  customerName
}: {
  customerEmail: string;
  storeId: string;
  customerName: string;
}): Promise<GreetUserToolResponse> {
  try {
    // Get store config
    const storeConfig = await this.getStoreConfig(storeId);
    const { shopify_domain: shopDomain, access_token: accessToken } = storeConfig || {};
    
    if (!shopDomain || !accessToken) {
      throw new Error('Missing store configuration');
    }

    // Get customer ID by email
    const customerId = await this.getCustomerIdByEmail(shopDomain, accessToken, customerEmail);
    
    if (!customerId) {
      // No customer found - return minimal response
      return {
        has_cart: false,
        has_last_order: false
      };
    }

    // Check for existing draft order
    const baseUrl = `https://${shopDomain}/admin/api/2024-01`;
    const headers = {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    };

    const existingDraft = await this.findDraftByCustomerId(baseUrl, headers, customerId);

    // If draft order exists with items
    if (existingDraft && existingDraft.line_items?.length > 0) {
      const items = existingDraft.line_items.map((item: any) => ({
        title: item.title,
        variant_title: item.variant_title || '',
        quantity: item.quantity,
        price: item.price
      }));

      return {
        has_cart: true,
        has_last_order: false,
        customer_name: customerName,
        cart_data: {
          draft_order_id: existingDraft.id,
          items,
          total_price: existingDraft.total_price,
          total_items: items.reduce((sum : any , item :any ) => sum + item.quantity, 0),
          checkout_url: existingDraft.invoice_url
        }
      };
    }

    // No cart - check for last order
    const lastOrder = await this.getLastOrder(shopDomain, accessToken, customerId);

    if (lastOrder && lastOrder.financial_status === 'paid') {
      const purchasedDate = new Date(lastOrder.created_at);
      const today = new Date();
      const daysSince = Math.floor((today.getTime() - purchasedDate.getTime()) / (1000 * 60 * 60 * 24));

      const items = lastOrder.line_items.map((item: any) => ({
        title: item.title,
        quantity: item.quantity
      }));

      return {
        has_cart: false,
        has_last_order: true,
        customer_name: customerName,
        last_order_data: {
          order_id: lastOrder.id,
          purchased_date: purchasedDate.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          }),
          days_since_purchase: daysSince,
          items
        }
      };
    }

    // No cart, no recent order - just return customer name
    return {
      has_cart: false,
      has_last_order: false,
      customer_name: customerName
    };

  } catch (error) {
    console.error('handleGreetUser error:', error);
    // Return minimal response on error
    return {
      has_cart: false,
      has_last_order: false
    };
  }
}


private async getLastOrder(
  shopDomain: string,
  accessToken: string,
  customerId: number
): Promise<any | null> {
  try {
    const url = `https://${shopDomain}/admin/api/2024-01/customers/${customerId}/orders.json?limit=1&status=any`;

    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken
      }
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.orders?.[0] || null;
  } catch (err) {
    console.warn('Error fetching last order:', err);
    return null;
  }
}

}



