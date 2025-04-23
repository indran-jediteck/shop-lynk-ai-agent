import { Client, GatewayIntentBits } from 'discord.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // Required to read message content like "!push ..."
  ]
});

const TOKEN = process.env.DISCORD_BOT_TOKEN!;
const API_URL = process.env.CHAT_INJECT_API || 'http://localhost:3000/api/inject';

// TEMP: Hardcoded browser ID for now
const DEFAULT_BROWSER_ID = 'browser-87670001-a940-4de7-a919-0018924bbdd0'; // Replace this with an active browserId for testing

client.once('ready', () => {
  console.log(`🤖 Bot is online as ${client.user?.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Command: !push Your message here
  if (message.content.startsWith('!push ')) {
    const content = message.content.replace('!push', '').trim();

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          browserId: DEFAULT_BROWSER_ID,
          message: content,
          sender: 'agent'
        })
      });

      interface InjectResponse {
        success?: boolean;
        error?: string;
      }
      const result = await response.json() as InjectResponse;

      if (response.ok) {
        await message.reply('✅ Message sent to user.');
      } else {
        await message.reply(`❌ Failed: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error sending message:', err);
      await message.reply('❌ Failed to inject message.');
    }
  }
});

client.login(TOKEN);
