# Lynk Agent Chat

A real-time AI chat application with WebSocket support, built with Node.js, TypeScript, Express, and OpenAI.

## Features

- Real-time chat using WebSockets
- OpenAI Assistant API integration
- MongoDB for data persistence
- Discord webhook support
- Store-specific styling configuration

## Prerequisites

- Node.js (v14 or higher)
- MongoDB
- OpenAI API key
- OpenAI Assistant ID

## Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/lynk-agent-chat.git
cd lynk-agent-chat
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Update the `.env` file with your configuration:
- Set your MongoDB connection string
- Add your OpenAI API key
- Add your OpenAI Assistant ID

5. Start the development server:
```bash
npm run dev
```

## Project Structure

```
src/
├── api/
│   ├── styles.ts         # Store style configuration API
│   └── webhook-discord.ts # Discord webhook handler
├── lib/
│   ├── db.ts            # MongoDB connection and models
│   └── openai.ts        # OpenAI API integration
├── ws/
│   ├── clients.ts       # WebSocket client tracking
│   ├── handler.ts       # WebSocket message handling
│   └── types.ts         # WebSocket message types
└── server.ts            # Main application entry point
```

## API Endpoints

- `GET /health` - Health check endpoint
- `GET /api/styles?shop={shop}` - Get store-specific styles
- `POST /api/webhook-discord` - Handle Discord webhook messages

## WebSocket Messages

### Client to Server
- `init` - Initialize a new chat session
- `user_message` - Send a message to the AI assistant

### Server to Client
- `new_message` - New message from AI or user
- `system_message` - System notifications

## Deployment

The application is designed to be deployed on Render.com. Make sure to set up the following environment variables in your Render dashboard:

- `MONGODB_URI`
- `OPENAI_API_KEY`
- `OPENAI_ASSISTANT_ID`
- `PORT` (optional, defaults to 3000)

## License

MIT 