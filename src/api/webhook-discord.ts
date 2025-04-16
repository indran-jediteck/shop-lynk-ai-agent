import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { WebSocketHandler } from '../ws/handler';

const router = Router();

// Define the message schema
const messageSchema = new mongoose.Schema({
  email: String,
  threadId: String,
  message: String,
  from: String,
  timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

export function setupDiscordWebhook(wsHandler: WebSocketHandler) {
  router.post('/webhook/discord', async (req: Request, res: Response) => {
    try {
      const { email, message, from } = req.body;
      
      if (!email || !message || !from) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Find the threadId for this email
      const latestMessage = await Message.findOne({ email })
        .sort({ timestamp: -1 });

      if (!latestMessage?.threadId) {
        return res.status(404).json({ error: 'No active thread found for this email' });
      }

      // Store the message
      await Message.create({
        email,
        threadId: latestMessage.threadId,
        message,
        from
      });

      // Send message to WebSocket client if active
      wsHandler.broadcastToThread(
        latestMessage.threadId,
        JSON.stringify({
          type: 'new_message',
          sender: 'discord',
          message: `${from}: ${message}`
        })
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error processing Discord webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
} 