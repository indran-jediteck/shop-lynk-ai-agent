import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

// Define the store config schema
const storeConfigSchema = new mongoose.Schema({
  shop: String,
  styles: {
    primaryColor: String,
    secondaryColor: String,
    fontFamily: String,
    // Add other style properties as needed
  }
});

const StoreConfig = mongoose.model('StoreConfig', storeConfigSchema);

router.get('/styles', async (req, res) => {
  try {
    const { shop } = req.query;
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter is required' });
    }

    const config = await StoreConfig.findOne({ shop });
    
    if (!config) {
      return res.status(404).json({ error: 'Store configuration not found' });
    }

    res.json(config.styles);
  } catch (error) {
    console.error('Error fetching styles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 