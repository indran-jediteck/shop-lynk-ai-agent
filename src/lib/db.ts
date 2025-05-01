import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI environment variable is not set');
}

// Store Config Schema
const storeConfigSchema = new mongoose.Schema({
  shop: { type: String, required: true, unique: true },
  styles: {
    primaryColor: String,
    secondaryColor: String,
    fontFamily: String,
    // Add other style properties as needed
  }
});

// Message Schema
const messageSchema = new mongoose.Schema({
  email: { type: String, required: true },
  threadId: { type: String, required: true },
  content: { type: String, required: true },
  from: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

// Add this schema for browser-thread mapping
const browserThreadSchema = new mongoose.Schema({
  email: { type: String, required: true },
  name: { type: String, required: true },
  browserId: { type: String, required: true },
  threadId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

export const StoreConfig = mongoose.model('StoreConfig', storeConfigSchema);
export const Message = mongoose.model('Message', messageSchema);
export const BrowserThread = mongoose.model('BrowserThread', browserThreadSchema);

export async function connectToDatabase() {
  try {
    await mongoose.connect(MONGODB_URI as string);
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

export async function getStoreConfig(shop: string) {
  return StoreConfig.findOne({ shop });
}

export async function saveMessage(email: string, content: string, from: string) {
  return Message.create({
    email,
    threadId: email, // Using email as threadId for simplicity
    content,
    from
  });
}

// Add this function to store thread info
export async function storeBrowserThread(email: string, name: string, browserId: string, threadId: string) {
  return BrowserThread.create({
    email,
    name,
    browserId,
    threadId
  });
} 