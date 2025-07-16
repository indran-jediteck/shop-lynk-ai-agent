#!/bin/bash

# Check if .env file exists
if [ ! -f .env ]; then
  echo "Creating .env file..."
  cat > .env << EOL
# MongoDB Connection
MONGODB_URI=mongodb://localhost:27017/lynk-agent

# OpenAI Configuration
OPENAI_API_KEY=
OPENAI_ASSISTANT_ID=

# Discord Integration
DISCORD_WEBHOOK_URL=
DISCORD_BOT_TOKEN=

# Pinecone Vector Database
PINECONE_API_KEY=
PINECONE_INDEX=

# Email Configuration
customer_email=store_owner@example.com
EOL
  echo ".env file created. Please edit it to add your API keys and configuration."
else
  echo ".env file already exists."
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Build the project
echo "Building the project..."
npm run build

echo "Setup complete! Before running the application, make sure to:"
echo "1. Edit the .env file with your API keys"
echo "2. Start MongoDB if you're using a local instance"
echo ""
echo "To start the application, run: npm start" 