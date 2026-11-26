const mongoose = require('mongoose');

// One row per Shopify customer / checkout / order, so the dashboard can show what
// arrived from Shopify and what happened to it. Later webhooks for the same
// object (for example checkouts/update) update the same row.
// The full phone number is NOT stored here, only a masked version.
const shopifyActivitySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // customer:<id> | checkout:<token> | order:<id>
    kind: { type: String, enum: ['customer', 'checkout', 'order'], required: true, index: true },
    topic: { type: String, default: '' },
    shop: { type: String, default: '' },
    name: { type: String, default: '' },
    phoneMasked: { type: String, default: '' },
    hasPhone: { type: Boolean, default: false },
    ref: { type: String, default: '' }, // order number, short checkout token, customer id
    amount: { type: String, default: '' },
    itemCount: { type: Number, default: 0 },
    // queued | added | exists | converted | skipped | error
    outcome: { type: String, default: 'skipped' },
    note: { type: String, default: '' },
    events: { type: Number, default: 0 }, // how many webhooks arrived for this object
  },
  { timestamps: true }
);

shopifyActivitySchema.index({ updatedAt: -1 });
shopifyActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // keep 30 days

module.exports = mongoose.model('ShopifyActivity', shopifyActivitySchema);