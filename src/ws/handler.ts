import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { activeConnections } from './clients';
import { WebSocketMessage, InitMessage, UserMessage } from './types';
import { processUserMessage, OpenAIService } from '../lib/openai';
import dotenv from 'dotenv';
import { getAssistantById, storeBrowserThread, BrowserThread } from '../lib/db';
import { ObjectId } from 'mongodb';
import { getCustomerLastPurchase } from '../lib/shopify';

dotenv.config();

async function sendToDiscord(
  message: string, 
  sender: string, 
  threadId: string, 
  userInfo?: { name: string; email: string; phone: string }, // Add phone
  discordWebhookUrl?: string
) {
  console.log('Sending message to Discord:', discordWebhookUrl);
  if (!discordWebhookUrl) return;
  const cleanedMessage = message.trim().replace(/^[-–—]\s*/, ''); 
  console.log('Cleaned message:', cleanedMessage);
  const finalMessage = `**${sender || "Unknown Sender"}** (Thread: ${threadId || "N/A"})${
    userInfo ? `\n**User:** ${userInfo.name} (${userInfo.email}) - ${userInfo.phone}` : ""
  }:\n${cleanedMessage || "(No message provided)"}`;
  // Fire and forget - don't await the Discord webhook
  const response = await fetch(discordWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      embeds: [
        {
          title: 'New Message',
          description: finalMessage,
        }
      ]
    }),
  }).catch(error => {
    console.error('Error sending message to Discord:', error);
  });
  console.log('Response from Discord:', response);
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server });
  console.log('WebSocket server initialized');

  wss.on('connection', (ws: WebSocket) => {
    console.log('New WebSocket connection established');

    ws.on('message', async (data: Buffer | string) => {
      try {
        // Convert Buffer to string if needed
        const messageStr = data instanceof Buffer ? data.toString('utf8') : data as string;
        console.log('Raw message received (as string):', messageStr);
        
        const message: WebSocketMessage = JSON.parse(messageStr);
        console.log('Parsed message object:', JSON.stringify(message, null, 2));
        
        switch (message.type) {
          case 'init':
            await handleInit(ws, message as InitMessage);
            break;  
          case 'user_message':
            console.log('Received user message, passing to handler');
            await handleUserMessage(ws, message);
            break;
            
          default:
            console.warn('Unknown message type:', message.type);
        }
      } catch (error) {
        console.error('Error processing message:', error);
        if (error instanceof Error) {
          console.error('Error details:', error.message);
          console.error('Error stack:', error.stack);
        }
        ws.send(JSON.stringify({
          type: 'system_message',
          message: 'Error processing message'
        }));
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      for (const [browserId, socket] of activeConnections.entries()) {
        if (socket === ws) {
          activeConnections.delete(browserId);
          console.log('Removed connection. BrowserId:', browserId);
          console.log('Remaining connections:', Array.from(activeConnections.keys()));
          break;
        }
      }
    });
  });
}

async function handleInit(ws: WebSocket, message: InitMessage) {
  console.log('Handling init message ---:', message);

  if (activeConnections.has(message.browserId)) {
    console.log('BrowserId already registered. Skipping duplicate init.');
    return;
  }

  if (!message.userInfo || !message.userInfo.name || !message.userInfo.email || !message.userInfo.phone) {
    console.warn('Init received without complete userInfo (name, email, phone required). Ignoring.');
    return;
  }

  // check if threadid from front end is not null
  if (message.threadId) {
    console.log('ThreadId already exists. Skipping duplicate init.');
  }else{
    //threadid is null then make openai call to create a thread
    console.log('ThreadId does not  exists. creating a new one ');
    const openaiService = new OpenAIService();
    message.threadId = await openaiService.createThreadWithContext(message.userInfo);
    console.log('ThreadId created:', message.threadId);
    //we need to store this in mongo for api/inject to look it up no?
    //store in mongo with email, name , browserid and threadid shopify_browser_thread collection  
    await storeBrowserThread(
      message.userInfo.email, 
      message.userInfo.name, 
      message.userInfo.phone, // Add this
      message.browserId, 
      message.threadId
    );
  }
  let assistantCollection: any;
  let assistantId: string | undefined; // Allow undefined initially
  try{
    const openaiService = new OpenAIService();
    assistantId = await openaiService.getStoreAssistant(message.storeId);
    assistantCollection = await getAssistantById(assistantId);
    console.log('Assistant ID retrieved:', assistantId); // Add debugging
  }catch(error){
    console.error('Error getting assistant by id:', error);
    // Handle the error - maybe return early or use a fallback
    ws.send(JSON.stringify({
      type: 'system_message',
      threadId: message.threadId,
      message: 'Error: Unable to get assistant. Please try again.'
    }));
    return;
  }

  // Add validation before using assistantId
  if (!assistantId) {
    console.error('assistantId is undefined');
    ws.send(JSON.stringify({
      type: 'system_message',
      threadId: message.threadId,
      message: 'Error: No assistant ID available. Please try again.'
    }));
    return;
  }

  activeConnections.set(message.browserId, ws);

  ws.send(JSON.stringify({
    type: 'init_ack',
    browserId: message.browserId,
    threadId: message.threadId,
    message: 'Connection established'
  }));


  const firstName = message.userInfo.name.split(' ')[0] || 'there';
  let welcomeMessage = assistantCollection?.settings?.welcome_message || "I'm your AI assistant. How can I help you today?";
  // try {
  //   const lastPurchase = await getCustomerLastPurchase(message.userInfo.email, message.storeId);
    
  //   console.log('Last purchase:', JSON.stringify(lastPurchase, null, 2)); // Debug log
    
  //   if (lastPurchase) {
  //     // Check if line_items exists and has items
  //     if (lastPurchase.line_items && Array.isArray(lastPurchase.line_items) && lastPurchase.line_items.length > 0) {
  //       const productName = lastPurchase.line_items[0].title;
  //       const orderDate = new Date(lastPurchase.created_at).toLocaleDateString('en-US', {
  //         month: 'long',
  //         day: 'numeric',
  //         year: 'numeric'
  //       });
        
  //       welcomeMessage = `Welcome back! I see your recently purchased "${productName}" on ${orderDate}. I hope you're enjoying it! How may I assist you today?`;
  //     } else {
  //       // Has order but no line items data
  //       console.log('Order found but no line_items:', lastPurchase);
  //       welcomeMessage = `Welcome back! Thank you for your recent purchase. How may I assist you today?`;
  //     }
  //   } else {
  //     welcomeMessage = `Hello! Welcome to our store. How may I assist you today?`;
  //   }
  // } catch (error) {
  //   console.error('Error fetching customer purchase:', error);
  //   // welcomeMessage = `Hello! How may I assist you today?`;
  // }


  const response = await processUserMessage(message.threadId, message.message,message.storeId,message.userInfo, assistantId);
  console.log(response,"openairesponseeeee")

  ws.send(JSON.stringify({
    type: 'init_message',
    message: response,
    sender: 'bot',
    browserId: message.browserId,
    threadId: message.threadId,
    followUpActions: assistantCollection?.settings?.followUpActions || [
      "Studio Hours?",
      "Customer Support?",
      "Product Returns?"
    ]
  }))

  console.log('Active connections after init:', Array.from(activeConnections.keys()));
}

async function handleUserMessage(ws: WebSocket, message: UserMessage) {
  console.log('Handling user message:', {
    type: message.type,
    threadId: message.threadId,
    userInfo: message.userInfo,
    messageLength: message.message.length,
    storeId: message.storeId
  });
  
  let threadId = message.threadId;

  if (!threadId) {
    // Try to get threadId from database using browserId or email
    const browserThread = await BrowserThread.findOne({ 
      $or: [
        { browserId: message.browserId },
        { email: message.userInfo?.email }
      ]
    });
    
    if (browserThread) {
      threadId = browserThread.threadId;
      console.log('Retrieved threadId from database:', threadId);
    } else {
      // Create new thread if none exists
      console.log('No threadId found, creating new thread');
      if (!message.userInfo) {
        console.error('No userInfo available for creating thread');
        return;
      }
      const openaiService = new OpenAIService();
      threadId = await openaiService.createThreadWithContext(message.userInfo);
      
      // Store the new thread in database
      await storeBrowserThread(
        message.userInfo.email,
        message.userInfo.name,
        message.userInfo.phone,
        message.browserId,
        threadId
      );
      console.log('Created and stored new threadId:', threadId);
    }
  }
  let assistantCollection: any;
  let assistantId: string | undefined; // DECLARE OUTSIDE THE TRY BLOCK
  try{
    const openaiService = new OpenAIService();
    assistantId = await openaiService.getStoreAssistant(message.storeId);
    assistantCollection = await getAssistantById(assistantId);
    console.log('Assistant ID retrieved:', assistantId); // Add debugging
  }catch(error){
    console.error('Error getting assistant by id:', error);
    // Handle the error - maybe return early or use a fallback
    ws.send(JSON.stringify({
      type: 'system_message',
      threadId: threadId,
      message: 'Error: Unable to get assistant. Please try again.'
    }));
    return;
  }
  // Add validation before using assistantId
  if (!assistantId) {
    console.error('assistantId is undefined');
    ws.send(JSON.stringify({
      type: 'system_message',
      threadId: threadId,
      message: 'Error: No assistant ID available. Please try again.'
    }));
    return;
  }
  fetch(`${process.env.HOST_URL}/api/agents/chats`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      assistantId,
      message : message.message,
      sender: 'user',
      userInfo : message.userInfo,
      browserId : message.browserId,
      threadId,
      storeId : message.storeId,
    }),
  })
  .then((response) => {
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    return response.json();
  })
  .then((data) => {
    console.log('Chat message upserted successfully:');
  })
  .catch((error) => {
    console.error('Error upserting chat:', error);
  });


  // console.log('Assistant collection:', assistantCollection);
  const discordWebhookUrl = assistantCollection?.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL;

  try {
    // Send user message to Discord without awaiting
    sendToDiscord(message.message, 'User', threadId, message.userInfo, discordWebhookUrl);

    // Send thinking message
    ws.send(JSON.stringify({
      type: 'system_message',
      threadId: threadId,
      message: 'Typing'
    }));

    // Ensure we have store_id
    // if (!message.store_id) {
    //   ws.send(JSON.stringify({
    //     type: 'system_message',
    //     threadId: threadId,
    //     message: 'Store ID is required for this operation'
    //   }));
    //   return;
    // }

    // Process the message
    console.log('About to call processUserMessage with:', {
      threadId,
      message: message.message,
      assistantId
    });
    const response = await processUserMessage(threadId, message.message,message.storeId,message.userInfo, assistantId);
    console.log('OpenAI response received:', {
      threadId,
      responseLength: response.length
    });
     console.log('Assistant response:', response);
    // Send assistant response to Discord without awaiting
    sendToDiscord(response, 'Assistant', threadId, message.userInfo, discordWebhookUrl);
    let message_id;
    await fetch(`${process.env.HOST_URL}/api/agents/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assistantId,
        message : response,
        sender: 'bot',
        userInfo : message.userInfo,
        browserId : message.browserId,
        threadId,
        storeId : message.storeId,
      }),
    })
    .then((response) => {
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      return response.json();
    }).then((data) => {
      message_id = data.message_id;
    })
    .catch((error) => {
      console.error('Error upserting chat:', error);
    });

    // Send response to user
    ws.send(JSON.stringify({
      type: 'new_message',
      message: response,
      sender: 'bot',
      threadId: threadId,
      assistantId : assistantId,
      userInfo : message.userInfo,
      message_id : message_id
    }));
    
  
  } catch (error) {
    console.error('Error in handleUserMessage:', error);
    
    // Send error message to user
    ws.send(JSON.stringify({
      type: 'system_message',
      threadId: threadId,
      message: error instanceof Error ? error.message : 'An error occurred while processing your message'
    }));
  }
} 