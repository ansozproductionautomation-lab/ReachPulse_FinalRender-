const mongoose = require('mongoose');

const TONES = ['Friendly', 'Professional', 'Concise', 'Hinglish'];

// A single document (key: 'default') holds the bot settings for the whole workspace.
const botConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    enabled: { type: Boolean, default: false },
    // When true, every reply is double-checked against the knowledge base before it is sent.
    strictMode: { type: Boolean, default: true },
    instructions: {
      type: String,
      default:
        'You are the WhatsApp support assistant for our business. Reply in short, friendly messages. Answer only from the knowledge base. If you are not sure, or the customer asks for a person, hand the chat to the team.',
      maxlength: 4000,
    },
    tone: { type: String, enum: TONES, default: 'Friendly' },
    fallbackMessage: {
      type: String,
      default: 'Let me connect you with a team member.',
      maxlength: 1000,
    },
  },
  { timestamps: true }
);

botConfigSchema.statics.getSingleton = function getSingleton() {
  return this.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const BotConfig = mongoose.model('BotConfig', botConfigSchema);
BotConfig.TONES = TONES;
module.exports = BotConfig;