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
  phone: { type: String, required: true },
  browserId: { type: String, required: true },
  threadId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const assistantSchema = new mongoose.Schema({
  name: String,
  description: String,
  useCase: String,
  model: String,
  apiKey: String,
  userEmail: String,
  userId: String,
  organizationId: String,
  domain: String,
  assistantId: { type: String, required: true, unique: true },
  Q_A: String,
  vectorStoreId: String,
  fileIds: [String],
  lastAccessedAt: Date,
  createdAt: Date,
  updatedAt: Date,
  status: String,
  settings: mongoose.Schema.Types.Mixed,
  filesContent: mongoose.Schema.Types.Mixed,
  discordWebhookUrl: String
}, { timestamps: true });

export const Assistant = mongoose.model('Assistant', assistantSchema);

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

export async function getAssistantById(openaiAssistantId: string) {
  return Assistant.findOne({ assistantId: openaiAssistantId });
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
export async function storeBrowserThread(email: string, name: string, phone: string, browserId: string, threadId: string) {
  return BrowserThread.findOneAndUpdate(
    { email }, // find by email
    { 
      email,
      name,
      phone, // Add this
      browserId,
      threadId,
      timestamp: new Date() // update timestamp on each update
    },
    { 
      upsert: true, // create if doesn't exist
      new: true, // return the updated document
      setDefaultsOnInsert: true // apply schema defaults on insert
    }
  );
} 