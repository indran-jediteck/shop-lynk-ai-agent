import { Router } from 'express';
import { z } from 'zod';
import dotenv from 'dotenv';
import { shopifyApi, LATEST_API_VERSION, Session, ApiVersion } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import fetch from 'node-fetch';
import { searchProductsGraphQL } from './searchProductsGraphQL';

dotenv.config();
const router = Router();

const SHOPIFY_STORE = process.env.cust_store_name; // e.g. 'your-store.myshopify.com'
const SHOPIFY_ADMIN_TOKEN = process.env.cust_access_token; // Admin API token

// GraphQL search endpoint
router.post('/graphql-search', async (req, res) => {
  try {
    const { search_term } = req.body;
    if (!search_term) {
      return res.status(400).json({ error: 'search_term is required' });
    }

    console.log('GraphQL search query:', search_term);
    const products = await searchProductsGraphQL(search_term);
    
    return res.json({
      results: products,
      total_results: products.length
    });

  } catch (error) {
    console.error('Error in GraphQL search:', error);
    res.status(500).json({
      error: 'Failed to process GraphQL search',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/search', async (req, res) => {
  try {
    const { search_term, color, size, material, price_range } = req.body;
    console.log('Search params:', req.body);

    // Construct search query combining all parameters
    const searchTerms = [
      search_term,
      color && `color:${color}`,
      size && `size:${size}`,
      material && `material:${material}`
    ].filter(Boolean).join(' ');

    console.log('GraphQL search query:', searchTerms);
    const products = await searchProductsGraphQL(searchTerms);

    // Filter by price range if provided
    const filteredProducts = price_range 
      ? products.filter(p => {
          const price = p.price ? parseFloat(p.price) : 0;
          return price >= price_range.min && price <= price_range.max;
        })
      : products;

    return res.json({
      results: filteredProducts,
      total_results: filteredProducts.length,
      filters_applied: {
        search_term,
        color: color || 'any',
        size: size || 'any',
        material: material || 'any',
        price_range: price_range || { min: 0, max: Number.MAX_VALUE }
      }
    });

  } catch (error) {
    console.error('Error in product search:', error);
    res.status(500).json({
      error: 'Failed to process product search',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}); 

export default router; 
