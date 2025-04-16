# Lynk Agent Chat

A real-time AI chat system with WebSocket support, designed for Shopify storefronts with Discord integration.

## Features

- Real-time chat using WebSocket
- OpenAI Assistant integration
- Discord webhook support
- MongoDB for data persistence
- Customizable chat styles per Shopify store

## Prerequisites

- Node.js 18+
- MongoDB
- OpenAI API key
- OpenAI Assistant ID

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your environment variables
4. Start the development server:
   ```bash
   npm run dev
   ```

## Environment Variables

- `MONGODB_URI`: MongoDB connection string
- `OPENAI_API_KEY`: Your OpenAI API key
- `OPENAI_ASSISTANT_ID`: Your OpenAI Assistant ID
- `PORT`: Server port (default: 3000)

## API Endpoints

### WebSocket
- Connect to `ws://localhost:3000`
- Send `{ type: 'init', threadId: 'your-thread-id' }` to initialize
- Send `{ type: 'user_message', message: 'your message' }` to chat

### REST API
- `GET /api/styles?shop=your-store.myshopify.com`: Get chat styles
- `POST /api/webhook/discord`: Discord webhook endpoint
  ```json
  {
    "email": "user@example.com",
    "message": "Hello from Discord",
    "from": "Discord User"
  }
  ```
- `GET /health`: Health check endpoint

## Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Deployment

The application is designed to be deployed on Render. Make sure to set up all environment variables in your Render dashboard.

## License

MIT 