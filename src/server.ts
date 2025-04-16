import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import { setupWebSocket } from './ws/handler';
import { setupStylesRoute } from './api/styles';
import { setupDiscordWebhookRoute } from './api/webhook-discord';
import { connectToDatabase } from './lib/db';

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

// WebSocket setup
setupWebSocket(server);

// Start server
const PORT = process.env.PORT || 3000;
connectToDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
}); 