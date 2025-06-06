import { Router } from 'express';
import { z } from 'zod';
import dotenv from 'dotenv';
import { shopifyApi, LATEST_API_VERSION, Session, ApiVersion } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import fetch from 'node-fetch';
import { searchProductsGraphQL } from './searchProductsGraphQL';
import { MongoClient } from 'mongodb';
import { OpenAI } from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';

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


// insitiate product pull from shopofy and store in monggo db and potentially create vector embeddings
router.post('/initiate-store-products', async (req, res) => {
  const { store_id } = req.body;

  if (!store_id) {
    return res.status(400).json({ error: 'store_id is required' });
  }
  let mongoClient: MongoClient | null = null;
  try {
    // Connect to MongoDB
    mongoClient = await MongoClient.connect(process.env.MONGODB_URI as string);
    const db = mongoClient.db();
    const store = await db.collection('ShopifyStore').findOne({ store_id });
    
    if (!store) {
      return res.status(404).json({ error: 'Store config not found' });
    }
    console.log('Found Store:', store);
  
    const shopifyDomain = store.shopify_domain;
    const accessToken = store.access_token;
    console.log('Shopify Domain:', shopifyDomain);
    console.log('Access Token:', accessToken);
    console.log('Store ID:', store_id);

    // Replace the existing pagination logic with this new version
    let allProducts: any[] = [];
    let pageInfo: string | null = null;
    let hasNextPage = true;
    let totalProducts = 0;

    // Fetch product count
    const productCountResponse = await fetch(`https://${shopifyDomain}/admin/api/2023-10/products/count.json?status=active`, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });
    const productCountData = await productCountResponse.json() as { count: number };
    const total1Products = productCountData.count;
    console.log(`Total products to fetch: ${total1Products}`);


    while (hasNextPage) {
      const baseUrl = `https://${shopifyDomain}/admin/api/2023-10/products.json`;
      const url = pageInfo
        ? `${baseUrl}?limit=250&page_info=${encodeURIComponent(pageInfo)}`
        : `${baseUrl}?limit=250&status=active`;
    
      console.log(`Requesting: ${url}`);
    
      const shopifyResponse = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      });
    
      if (!shopifyResponse.ok) {
        throw new Error(`Shopify API error: ${shopifyResponse.statusText}`);
      }
    
      const data = await shopifyResponse.json() as { products: any[] };
      const products = data.products;
    
      if (products?.length) {
        allProducts.push(...products);
        totalProducts += products.length;
        console.log(`Fetched ${products.length} products. Total so far: ${totalProducts}`);
      } else {
        console.warn('No products found on this page.');
      }
    
      const linkHeader = shopifyResponse.headers.get('Link');
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        pageInfo = matches?.[1] ? new URL(matches[1]).searchParams.get('page_info') : null;
        hasNextPage = !!pageInfo;
      } else {
        hasNextPage = false;
      }
    }

    console.log(`Total products fetched: ${totalProducts}`);

    // Process all products in batches for MongoDB
    const batchSize = 100;
    for (let i = 0; i < allProducts.length; i += batchSize) {
      const batch = allProducts.slice(i, i + batchSize);
      const operations = batch.map(product => ({
        updateOne: {
          filter: {
            store_id,
            admin_graphql_api_id: product.admin_graphql_api_id
          },
          update: {
            $set: {
              ...product,
              store_id,
              updated_at: new Date()
            }
          },
          upsert: true
        }
      }));
      
      if (operations.length > 0) {
        await db.collection('Shopify_Products').bulkWrite(operations);
        console.log(`Upserted batch of ${operations.length} products to MongoDB`);
      }
    }

    // Process embeddings in batches to avoid OpenAI rate limits
    const embeddingBatchSize = 50;
    for (let i = 0; i < allProducts.length; i += embeddingBatchSize) {
      const batch = allProducts.slice(i, i + embeddingBatchSize);
      const texts = batch.map(p => [
        p.title,
        p.body_html?.replace(/<[^>]+>/g, ' ') || '',
        (p.tags || '').split(',').map((tag: string) => tag.trim()).join(', '),
        ...(p.variants || []).map((v: { title?: string }) => v.title || '').filter(Boolean)
      ].join(' ').slice(0, 8192));

      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
      
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts
      });

      const vectors = response.data.map((result, idx) => {
        const product = batch[idx];
        const mongoId = product._id?.toString?.();
      
        const metadata: Record<string, any> = {
          store_id,
          title: product.title,
          price: parseFloat(product.variants?.[0]?.price || '0'),
          tags: (product.tags || '').split(',').map((tag: string) => tag.trim())
        };
      
        if (mongoId) {
          metadata.mongo_id = mongoId;
        }
      
        return {
          id: product.admin_graphql_api_id,
          values: result.embedding,
          metadata
        };
      });

      const pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY!
      });

      const index = pinecone.Index(process.env.PINECONE_INDEX!);
      await index.upsert(vectors);
      console.log(`Upserted batch of ${vectors.length} vectors to Pinecone`);
    }

    return res.json({
      message: 'Product sync completed',
      store_id,
      total_products: totalProducts
    });

  } catch (error) {
    console.error('Error syncing products:', error);
    return res.status(500).json({
      error: 'Failed to fetch/store products',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    if (mongoClient) {
      await mongoClient.close();
    }
  }
});

router.post('/test-search-vector', async (req, res) => {
  const { query, store_id, topK = 5 } = req.body;

  if (!query || !store_id) {
    return res.status(400).json({ error: 'Both query and store_id are required' });
  }

  try {
    // 1. Generate embedding for the query
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query
    });

    const [embedding] = embeddingResponse.data.map(d => d.embedding);

    // 2. Query Pinecone for similar vectors
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const index = pinecone.Index(process.env.PINECONE_INDEX!);

    const pineconeResponse = await index.query({
      vector: embedding,
      topK,
      includeMetadata: true,
      filter: {
        store_id: { "$eq": store_id }
      }
    });

    return res.json({
      query,
      results: pineconeResponse.matches
    });

  } catch (error) {
    console.error('Error during vector search:', error);
    return res.status(500).json({
      error: 'Vector search failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});



export default router; 
