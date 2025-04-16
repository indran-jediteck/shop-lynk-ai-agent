import { Express } from 'express';
import { getStoreConfig } from '../lib/db';

export function setupStylesRoute(app: Express) {
  app.get('/api/styles', async (req, res) => {
    try {
      const { shop } = req.query;
      
      if (!shop || typeof shop !== 'string') {
        return res.status(400).json({ error: 'Shop parameter is required' });
      }

      const config = await getStoreConfig(shop);
      
      if (!config) {
        return res.status(404).json({ error: 'Store configuration not found' });
      }

      res.json(config.styles);
    } catch (error) {
      console.error('Error fetching store styles:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
} 