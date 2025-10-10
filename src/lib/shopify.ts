import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

async function getShopifyStore(store_id: string) {
  let mongoClient: MongoClient | null = null;
  try {
    mongoClient = await MongoClient.connect(process.env.MONGODB_URI as string);
    const db = mongoClient.db();
    const store = await db.collection('ShopifyStore').findOne({ store_id });
    if (!store) {
      throw new Error(`Store config not found for store_id: ${store_id}`);
    }
    return {
      shopifyDomain: store.shopify_domain,
      accessToken: store.access_token
    };
  } finally {
    if (mongoClient) {
      await mongoClient.close();
    }
  }
}

export async function getCustomerByEmail(email: string, store_id: string) {
  const { shopifyDomain, accessToken } = await getShopifyStore(store_id);
  const url = `https://${shopifyDomain}/admin/api/2023-10/customers/search.json?query=email:${email}`;

  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': accessToken
    }
  });

  if (!response.ok) {
    const errorBody = await response.json();
    throw new Error(`Shopify API error: ${response.statusText} - ${JSON.stringify(errorBody)}`);
  }

  const data = await response.json() as { customers: any[] };
  console.log('Customer data:', data);
  return data.customers?.[0];
}

export async function findDraftByCustomerId(customerId: number, store_id: string) {
  const { shopifyDomain, accessToken } = await getShopifyStore(store_id);
  const url = `https://${shopifyDomain}/admin/api/2023-10/customers/${customerId}/draft_orders.json`;

  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': accessToken
    }
  });

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.statusText}`);
  }

  const data = await response.json() as { draft_orders: any[] };
  console.log('Draft orders data:', data);
  return data.draft_orders?.[0];
}

export async function getLastOrder(customerId: number, store_id: string) {
  const { shopifyDomain, accessToken } = await getShopifyStore(store_id);
  const url = `https://${shopifyDomain}/admin/api/2023-10/customers/${customerId}/orders.json?limit=1`;

  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': accessToken
    }
  });

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.statusText}`);
  }

  const data = await response.json() as { orders: any[] };
  
  // Use JSON.stringify to see full nested data
  console.log('Full Order data:', JSON.stringify(data, null, 2));
  
  // Or specifically log line_items
  if (data.orders?.[0]?.line_items) {
    console.log('Line items:', JSON.stringify(data.orders[0].line_items, null, 2));
  }
  
  return data.orders?.[0];
}

export async function getCustomerLastPurchase(email: string, store_id: string) {
  const customer = await getCustomerByEmail(email, store_id);
  if (!customer) {
    return null;
  }

  const lastOrder = await getLastOrder(customer.id, store_id);
  return lastOrder;
}
