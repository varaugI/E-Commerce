
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['ORDER', 'REVIEW', 'SYSTEM'], required: true },
  message: { type: String, required: true },
  read: { type: Boolean, default: false },
  link: { type: String }, // optional link to redirect
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', notificationSchema);
