import express from 'express';
import http from 'http'; 
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import { setupWebSocket } from './ws/handler';
import { setupStylesRoute } from './api/styles';
import { setupDiscordWebhookRoute } from './api/webhook-discord';
import { connectToDatabase } from './lib/db';
import productsRouter from './routes/products';
import { activeConnections } from './ws/clients';
import { BrowserThread } from './lib/db';
import { emailService } from './lib/email';
import agentsRouter from './routes/agents';

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(express.json());
app.use('/api/agents', agentsRouter);

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Static files
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    
    // Set content type based on file extension
    if (filePath.endsWith('.js')) {
      res.set('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.html')) {
      res.set('Content-Type', 'text/html');
    } else if (filePath.endsWith('.css')) {
      res.set('Content-Type', 'text/css');
    }
  }
}));

// API routes
setupStylesRoute(app);
setupDiscordWebhookRoute(app);
app.use('/api/products', productsRouter);

// WebSocket setup
setupWebSocket(server);

// Add this route to your server.ts
app.post('/api/inject', express.json(), async (req, res) => {
    console.log('Inject request received ----  now:', req.body);
    const { email, message, sender = 'ai' } = req.body;

    // Debug: Log all active connections
    console.log('Active connections:', Array.from(activeConnections.keys()));
    console.log('Looking for email:', email);

    if (!email || !message) {
      return res.status(400).json({ error: 'Missing email or message' });
    }
    // now we need to find the browserid for this email
    const browserThread = await BrowserThread.findOne({ email });
    console.log('found browserThread:', browserThread);

    if (!browserThread) {
      return res.status(400).json({ error: 'No active connection found for this email' });
    }
    const browserId = browserThread.browserId;
    //check if browserid is in the browser_thread collection
    const ws = activeConnections.get(browserId);
    if (ws) {
      console.log('found ws:', ws);
    }
   
    if (ws && ws.readyState === 1) { // 1 = WebSocket.OPEN
      console.log(`📤 Sending via WebSocket to browserId: ${browserId}`);
      ws.send(JSON.stringify({
          type: 'new_message',
          message: message,
          sender: sender
      }));
      res.json({ success: true, message: `Delivered to ${email} via WebSocket.`});
    } else {
      //lets send email to this user with a copy to the storeowners email address also 
      // const storeOwnerEmail = process.env.customer_email;
      await emailService.sendEmail(email, 'lynk support', message, "demomihir3@gmail.com");
      res.json({ success: true, message: 'email sent to user. Email sent to store owner' });
    }
});

// Start server
const PORT = process.env.PORT || 4000;
connectToDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
}); 