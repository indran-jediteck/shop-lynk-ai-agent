import fetch from 'node-fetch';

const SHOPIFY_STORE = process.env.cust_store_name; // e.g. 'your-store.myshopify.com'
const SHOPIFY_ADMIN_TOKEN = process.env.cust_access_token; // Admin API token

export async function searchProductsGraphQL(searchTerm: string) {
  const query = `
    {
      products(first: 10, query: "${searchTerm}") {
        edges {
          node {
            id
            title
            productType
            tags
            images(first: 1) {
              edges {
                node {
                  originalSrc
                  altText
                }
              }
            }
            variants(first: 1) {
              edges {
                node {
                  id
                  title
                  price
                  sku
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN!,
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    console.error('GraphQL Error:', await response.text());
    throw new Error('Failed to fetch products from Shopify GraphQL API');
  }

  const json = await response.json() as {
    data: {
      products: {
        edges: Array<{
          node: {
            id: string;
            title: string;
            productType: string;
            tags: string[];
            images: { edges: Array<{ node: { originalSrc: string } }> };
            variants: { edges: Array<{ node: { price: string; sku: string } }> };
          }
        }>
      }
    }
  };

  const products = json.data.products.edges.map((edge) => {
    const p = edge.node;
    return {
      id: p.id,
      title: p.title,
      type: p.productType,
      tags: p.tags,
      image: p.images.edges[0]?.node.originalSrc || null,
      price: p.variants.edges[0]?.node.price || null,
      sku: p.variants.edges[0]?.node.sku || null
    };
  });

  return products;
}