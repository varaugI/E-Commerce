const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    name: String,
    qty: Number,
    price: Number,
    image: String,
    isCanceled: {
        type: Boolean,
        default: false
    }
});

const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    orderItems: [orderItemSchema],
    shippingAddress: {
        address: String,
        city: String,
        postalCode: String,
        country: String
    },
    paymentMethod: String,
    paymentResult: {
        id: String,
        status: String,
        update_time: String,
        email_address: String
    },
    itemsPrice: Number,
    shippingPrice: Number,
    taxPrice: Number,
    totalPrice: Number,
    isPaid: {
        type: Boolean,
        default: false
    },
    paidAt: Date,
    isDelivered: {
        type: Boolean,
        default: false
    },
    deliveredAt: Date,
    isCanceled: {
        type: Boolean,
        default: false
    },
    canceledAt: Date,
    customStatus: {
        type: String,
        default: 'Pending'
    },
    statusHistory: [
        {
            status: String,
            changedAt: { type: Date, default: Date.now },
            changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
        }
    ]
}, { timestamps: true });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ isPaid: 1, isDelivered: 1 });
orderSchema.index({ user: 1, createdAt: -1, isPaid: 1 });
orderSchema.index({ isPaid: 1, isDelivered: 1, isCanceled: 1 });

module.exports = mongoose.model('Order', orderSchema);
