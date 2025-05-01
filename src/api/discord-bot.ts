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
//const DEFAULT_BROWSER_ID = process.env.BROWSERID || 'browser-7483984b-dd38-47a3-bf04-a0a3ebd2e573'; // Replace this with an active browserId for testing

client.once('ready', () => {
  console.log(`🤖 Bot is online as ${client.user?.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Command: !push Your message here
  if (message.content.startsWith('!push ')) {
    const content = message.content.replace('!push', '').trim();
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const emailMatch = content.match(emailRegex);
    const email = emailMatch ? emailMatch[0] : null;
    if (!email) {
      await message.reply('❌ Failed: Missing email address. Usage: `!push user@example.com Your message here`');
      return;
    }


    // Remove the email address from the content
    const messageBody = content.replace(emailRegex, '').trim();

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          message: messageBody,
          sender: 'agent'
        })
      });

      interface InjectResponse {
        success?: boolean;
        error?: string;
        message?: string;
      }
      const result = await response.json() as InjectResponse;
      console.log('Inject response:', result);  
      let replyMessage = 'default';
      if (result.success) {
        console.log('Message sent to user:', result);
        replyMessage = `✅ Message sent to user: "${result.message}"`;
      }else{
        replyMessage = `❌ Failed: ${result.error || 'Unknown error'}`;
      }

      if (response.ok) {
        await message.reply(`✅ Message sent to user. ${replyMessage}`);
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
