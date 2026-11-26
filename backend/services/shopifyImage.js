// Finds the product picture of a Shopify order, so an order template with an
// IMAGE header can show the item the customer bought.
//
// .env (all optional, but you need the token OR a fallback image):
//   SHOPIFY_ADMIN_ACCESS_TOKEN   Admin API token (scope: read_products)
//   SHOPIFY_STORE_DOMAIN         e.g. my-store.myshopify.com (used if the webhook has no shop)
//   SHOPIFY_API_VERSION          default 2026-10
//   SHOPIFY_FALLBACK_IMAGE_URL   public https image used when the order has no picture

const apiVersion = () => process.env.SHOPIFY_API_VERSION || '2026-10';
const isHttps = (value) => /^https:\/\//i.test(String(value || ''));

function shopDomain(shop) {
  const fromWebhook = String(shop || '').trim();
  if (/\.myshopify\.com$/i.test(fromWebhook)) return fromWebhook;
  return String(process.env.SHOPIFY_STORE_DOMAIN || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
}

// lineItems: [{ productId, variantId, title, imageUrl }] saved from the order webhook.
// Returns a public https image link, or '' when none is found.
async function getOrderImageUrl(shop, lineItems) {
  const items = Array.isArray(lineItems) ? lineItems : [];

  const direct = items.find((item) => isHttps(item?.imageUrl));
  if (direct) return direct.imageUrl;

  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const domain = shopDomain(shop);
  if (!token || !domain) return '';

  for (const item of items) {
    if (!item?.productId) continue;

    try {
      const response = await fetch(
        `https://${domain}/admin/api/${apiVersion()}/products/${item.productId}.json?fields=id,image,images,variants`,
        {
          headers: { 'X-Shopify-Access-Token': token },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        console.error(`Shopify product ${item.productId} image lookup failed (${response.status})`);
        continue;
      }

      const { product } = await response.json();
      const images = product?.images || [];
      const variant = (product?.variants || []).find(
        (v) => String(v.id) === String(item.variantId)
      );
      const variantImage = variant?.image_id
        ? images.find((img) => String(img.id) === String(variant.image_id))
        : null;

      const src = variantImage?.src || product?.image?.src || images[0]?.src;
      if (isHttps(src)) return src;
    } catch (error) {
      console.error(`Shopify product ${item.productId} image lookup error:`, error.message);
    }
  }

  return '';
}

module.exports = { getOrderImageUrl, isHttps };