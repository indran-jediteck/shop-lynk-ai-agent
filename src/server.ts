import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import stylesRouter from './api/styles';
import { setupDiscordWebhook } from './api/webhook-discord';
import { WebSocketHandler } from './ws/handler';
import { Database } from './lib/db';
import { OpenAIService } from './lib/openai';

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);

// CORS configuration
const corsOptions = {
  origin: '*', // Be more restrictive in production
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "*.ngrok-free.app"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "*.ngrok-free.app"],
      connectSrc: ["'self'", "ws:", "wss:", "*.ngrok-free.app"],
      imgSrc: ["'self'", "data:", "blob:", "*.ngrok-free.app"],
      styleSrc: ["'self'", "'unsafe-inline'", "*.ngrok-free.app"],
      fontSrc: ["'self'", "data:", "*.ngrok-free.app"],
      frameSrc: ["'self'", "*.ngrok-free.app"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(express.json());

// Add headers for all responses
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, path) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }
}));

// Test route
app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/test.html'));
});

// Initialize services
const db = Database.getInstance();
const openai = new OpenAIService();
const wsHandler = new WebSocketHandler(server);

// Routes
app.use('/api', stylesRouter);
app.use('/api', setupDiscordWebhook(wsHandler));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// Start server
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await db.connect();
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Test page available at http://localhost:${PORT}/test`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  await db.disconnect();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

startServer(); 