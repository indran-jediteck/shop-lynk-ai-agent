import { Express } from 'express';
import { activeConnections } from '../ws/clients';
import { saveMessage } from '../lib/db';

export function setupDiscordWebhookRoute(app: Express) {
  app.post('/api/webhook-discord', async (req, res) => {
    try {
      const { email, message, from } = req.body;

      if (!email || !message || !from) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Save message to database
      const savedMessage = await saveMessage(email, message, from);

      // If there's an active WebSocket connection for this thread, send the message
      const ws = activeConnections.get(email);
      if (ws && ws.readyState === 1) { // 1 = OPEN
        ws.send(JSON.stringify({
          type: 'new_message',
          threadId: email,
          content: message,
          role: 'user'
        }));
      }

      res.json({ success: true, message: savedMessage });
    } catch (error) {
      console.error('Error processing Discord webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
} 