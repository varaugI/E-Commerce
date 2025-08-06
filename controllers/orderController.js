const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');

const isOwnerOrAdmin = (orderUserId, currentUser) => {
    return orderUserId.toString() === currentUser._id.toString() || currentUser.isAdmin;
};

/**
 * @desc Create a new order with proper validation and error handling
 * @route POST /api/orders
 * @access Private
 */
exports.createOrder = async (req, res) => {
    const session = await mongoose.startSession();

    try {
        const result = await session.withTransaction(async () => {
            const {
                orderItems,
                shippingAddress,
                paymentMethod,
                itemsPrice,
                shippingPrice,
                taxPrice,
                totalPrice
            } = req.body;
            if (!orderItems || orderItems.length === 0) {
                throw new Error('No order items provided');
            }

            if (!shippingAddress || !shippingAddress.address || !shippingAddress.city) {
                throw new Error('Complete shipping address is required');
            }

            if (!paymentMethod) {
                throw new Error('Payment method is required');
            }
            const enrichedOrderItems = [];
            let calculatedItemsPrice = 0;

            for (const item of orderItems) {
                if (!item.product || !item.qty || item.qty <= 0) {
                    throw new Error('Invalid order item: product ID and quantity required');
                }

                const product = await Product.findById(item.product).session(session);
                if (!product) {
                    throw new Error(`Product with ID ${item.product} not found`);
                }

                if (product.countInStock < item.qty) {
                    throw new Error(`Insufficient stock for "${product.name}". Available: ${product.countInStock}, Requested: ${item.qty}`);
                }
                const currentPrice = product.salePrice && product.saleEndDate > new Date()
                    ? product.salePrice
                    : product.price;

                enrichedOrderItems.push({
                    product: product._id,
                    name: product.name,
                    qty: item.qty,
                    price: currentPrice,
                    image: product.image
                });

                calculatedItemsPrice += currentPrice * item.qty;
                await Product.findByIdAndUpdate(
                    item.product,
                    { $inc: { countInStock: -item.qty } },
                    { session }
                );
            }

            const tolerance = 0.01; 
            if (Math.abs(calculatedItemsPrice - itemsPrice) > tolerance) {
                throw new Error(`Price mismatch. Expected: ${calculatedItemsPrice.toFixed(2)}, Received: ${itemsPrice}`);
            }
            const order = new Order({
                user: req.user._id,
                orderItems: enrichedOrderItems,
                shippingAddress,
                paymentMethod,
                itemsPrice: calculatedItemsPrice,
                shippingPrice: shippingPrice || 0,
                taxPrice: taxPrice || 0,
                totalPrice: calculatedItemsPrice + (shippingPrice || 0) + (taxPrice || 0)
            });

            return await order.save({ session });
        });
        try {
            const user = await User.findById(req.user._id);
            if (user) {
                await sendEmail(
                    user.email,
                    'Order Confirmation',
                    `Hi ${user.name}, your order ${result._id} has been placed successfully. Total: $${result.totalPrice.toFixed(2)}`
                );
            }
        } catch (emailError) {
            console.error('Failed to send confirmation email:', emailError);
        }

        res.status(201).json({
            success: true,
            message: 'Order created successfully',
            data: result
        });

    } catch (err) {
        console.error('Order creation error:', err);
        if (err.message.includes('stock') || err.message.includes('not found') || err.message.includes('Price mismatch')) {
            return res.status(400).json({
                success: false,
                message: err.message
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to create order. Please try again.'
        });
    } finally {
        await session.endSession();
    }
};

/**
 * @desc Get logged-in user's orders with enhanced pagination and filtering
 * @route GET /api/orders/myorders
 * @access Private
 */
exports.getMyOrders = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50); // Max 50 per page
        const skip = (page - 1) * limit;

        const filter = { user: req.user._id };
        if (req.query.status) {
            if (req.query.status === 'paid') filter.isPaid = true;
            if (req.query.status === 'delivered') filter.isDelivered = true;
            if (req.query.status === 'canceled') filter.isCanceled = true;
        }

        const [orders, total] = await Promise.all([
            Order.find(filter)
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 })
                .populate('orderItems.product', 'name image'),
            Order.countDocuments(filter)
        ]);

        res.json({
            success: true,
            data: orders,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Fetching my orders failed:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
};

/**
 * @desc Get order by ID with enhanced population
 * @route GET /api/orders/:id
 * @access Private (owner or admin)
 */
exports.getOrderById = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid order ID format' });
        }

        const order = await Order.findById(req.params.id)
            .populate('user', 'name email')
            .populate('orderItems.product', 'name image countInStock')
            .populate('statusHistory.changedBy', 'name');

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (!isOwnerOrAdmin(order.user._id, req.user)) {
            return res.status(403).json({ success: false, message: 'Not authorized to view this order' });
        }

        res.json({ success: true, data: order });
    } catch (err) {
        console.error('Fetching order by ID failed:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch order' });
    }
};

/**
 * @desc Mark order as paid with validation
 * @route PUT /api/orders/:id/pay
 * @access Private
 */
exports.markOrderAsPaid = async (req, res) => {
    try {
        const { id, status, update_time, email_address } = req.body;

        if (!id || !status) {
            return res.status(400).json({
                success: false,
                message: 'Payment ID and status are required'
            });
        }

        const order = await Order.findById(req.params.id).populate('user');
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Prevent double payment
        if (order.isPaid) {
            return res.status(400).json({
                success: false,
                message: 'Order is already marked as paid'
            });
        }

        // Authorization check
        if (!isOwnerOrAdmin(order.user._id, req.user)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        order.isPaid = true;
        order.paidAt = new Date();
        order.paymentResult = {
            id,
            status,
            update_time: update_time || new Date().toISOString(),
            email_address: email_address || order.user.email
        };

        order.statusHistory.push({
            status: 'Payment Confirmed',
            changedBy: req.user._id
        });

        const updatedOrder = await order.save();
        try {
            await sendEmail(
                order.user.email,
                'Payment Confirmation',
                `Hi ${order.user.name}, your payment for order ${order._id} has been confirmed. Amount: $${order.totalPrice.toFixed(2)}`
            );
        } catch (emailError) {
            console.error('Failed to send payment confirmation email:', emailError);
        }

        res.json({ success: true, message: 'Order marked as paid', data: updatedOrder });
    } catch (err) {
        console.error('Payment update failed:', err);
        res.status(500).json({ success: false, message: 'Failed to mark as paid' });
    }
};

/**
 * @desc Mark order as delivered
 * @route PUT /api/orders/:id/deliver
 * @access Private/Admin
 */
exports.markOrderAsDelivered = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('user');
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (!order.isPaid) {
            return res.status(400).json({
                success: false,
                message: 'Cannot deliver unpaid order'
            });
        }

        if (order.isDelivered) {
            return res.status(400).json({
                success: false,
                message: 'Order is already delivered'
            });
        }

        order.isDelivered = true;
        order.deliveredAt = new Date();
        order.statusHistory.push({
            status: 'Delivered',
            changedBy: req.user._id
        });

        const updatedOrder = await order.save();

        try {
            await sendEmail(
                order.user.email,
                'Order Delivered',
                `Hi ${order.user.name}, your order ${order._id} has been delivered successfully. Thank you for shopping with us!`
            );
        } catch (emailError) {
            console.error('Failed to send delivery confirmation email:', emailError);
        }

        res.json({ success: true, message: 'Order marked as delivered', data: updatedOrder });
    } catch (err) {
        console.error('Delivery update failed:', err);
        res.status(500).json({ success: false, message: 'Failed to mark as delivered' });
    }
};

/**
 * @desc Get all orders with enhanced filtering and pagination (admin only)
 * @route GET /api/orders
 * @access Private/Admin
 */
exports.getAllOrders = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const skip = (page - 1) * limit;
        const filter = {};
        if (req.query.status === 'paid') filter.isPaid = true;
        if (req.query.status === 'unpaid') filter.isPaid = false;
        if (req.query.status === 'delivered') filter.isDelivered = true;
        if (req.query.status === 'canceled') filter.isCanceled = true;
        if (req.query.startDate) {
            filter.createdAt = { $gte: new Date(req.query.startDate) };
        }
        if (req.query.endDate) {
            filter.createdAt = { ...filter.createdAt, $lte: new Date(req.query.endDate) };
        }

        const [orders, total] = await Promise.all([
            Order.find(filter)
                .populate('user', 'name email')
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 }),
            Order.countDocuments(filter)
        ]);

        res.json({
            success: true,
            data: orders,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Fetching all orders failed:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
};

/**
 * @desc Cancel an entire order with transaction support
 * @route PUT /api/orders/:id/cancel
 * @access Private (owner or admin)
 */
exports.cancelOrder = async (req, res) => {
    const session = await mongoose.startSession();

    try {
        await session.withTransaction(async () => {
            const order = await Order.findById(req.params.id).populate('user').session(session);

            if (!order) {
                throw new Error('Order not found');
            }

            if (!isOwnerOrAdmin(order.user._id, req.user)) {
                const error = new Error('Not authorized to cancel this order');
                error.statusCode = 403;
                throw error;
            }

            if (order.isCanceled) {
                const error = new Error('Order already canceled');
                error.statusCode = 400;
                throw error;
            }

            if (order.isDelivered) {
                const error = new Error('Cannot cancel delivered order');
                error.statusCode = 400;
                throw error;
            }
            for (const item of order.orderItems) {
                if (!item.isCanceled) {
                    await Product.findByIdAndUpdate(
                        item.product,
                        { $inc: { countInStock: item.qty } },
                        { session }
                    );
                }
            }
            order.isCanceled = true;
            order.canceledAt = new Date();
            order.statusHistory.push({
                status: 'Canceled',
                changedBy: req.user._id
            });
            await order.save({ session });
            setImmediate(async () => {
                try {
                    await sendEmail(
                        order.user.email,
                        'Order Canceled',
                        `Hi ${order.user.name}, your order ${order._id} has been canceled and stock has been restored.`
                    );
                } catch (emailError) {
                    console.error('Failed to send cancellation email:', emailError);
                }
            });
        });

        res.json({ success: true, message: 'Order canceled and stock restored' });
    } catch (err) {
        console.error('Cancel order failed:', err);

        const statusCode = err.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: err.message || 'Order cancellation failed'
        });
    } finally {
        await session.endSession();
    }
};

/**
 * @desc Cancel one item in an order with transaction support
 * @route PUT /api/orders/:orderId/items/:productId/cancel
 * @access Private (owner or admin)
 */
exports.cancelOrderItem = async (req, res) => {
    const session = await mongoose.startSession();

    try {
        await session.withTransaction(async () => {
            const { orderId, productId } = req.params;

            if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(productId)) {
                throw new Error('Invalid ID format');
            }

            const order = await Order.findById(orderId).populate('user').session(session);
            if (!order) {
                throw new Error('Order not found');
            }

            if (!isOwnerOrAdmin(order.user._id, req.user)) {
                const error = new Error('Not authorized to cancel item');
                error.statusCode = 403;
                throw error;
            }

            if (order.isDelivered) {
                const error = new Error('Cannot cancel items from delivered order');
                error.statusCode = 400;
                throw error;
            }

            const item = order.orderItems.find(i =>
                i.product.toString() === productId && !i.isCanceled
            );

            if (!item) {
                const error = new Error('Item not found or already canceled');
                error.statusCode = 404;
                throw error;
            }

            // Restore stock
            await Product.findByIdAndUpdate(
                productId,
                { $inc: { countInStock: item.qty } },
                { session }
            );
            item.isCanceled = true;
            order.itemsPrice -= (item.price * item.qty);
            order.totalPrice = order.itemsPrice + order.shippingPrice + order.taxPrice;

            await order.save({ session });
            setImmediate(async () => {
                try {
                    await sendEmail(
                        order.user.email,
                        'Item Canceled',
                        `Hi ${order.user.name}, the item "${item.name}" has been canceled from your order ${order._id}. Updated total: $${order.totalPrice.toFixed(2)}`
                    );
                } catch (emailError) {
                    console.error('Failed to send item cancellation email:', emailError);
                }
            });
        });

        res.json({ success: true, message: 'Item canceled and stock restored' });
    } catch (err) {
        console.error('Cancel order item failed:', err);

        const statusCode = err.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: err.message || 'Item cancellation failed'
        });
    } finally {
        await session.endSession();
    }
};

/**
 * @desc Update shipping address (before shipping)
 * @route PUT /api/orders/:id/address
 * @access Private (owner or admin)
 */
exports.updateShippingAddress = async (req, res) => {
    try {
        const { shippingAddress } = req.body;

        if (!shippingAddress || !shippingAddress.address || !shippingAddress.city) {
            return res.status(400).json({
                success: false,
                message: 'Complete shipping address is required'
            });
        }

        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (!isOwnerOrAdmin(order.user, req.user)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        if (order.isDelivered) {
            return res.status(400).json({
                success: false,
                message: 'Cannot update address after delivery'
            });
        }

        order.shippingAddress = shippingAddress;
        order.statusHistory.push({
            status: 'Shipping Address Updated',
            changedBy: req.user._id
        });

        await order.save();

        res.json({ success: true, message: 'Shipping address updated', data: order });
    } catch (err) {
        console.error('Address update failed:', err);
        res.status(500).json({ success: false, message: 'Failed to update address' });
    }
};

/**
 * @desc Change payment method (before payment)
 * @route PUT /api/orders/:id/payment
 * @access Private (owner or admin)
 */
exports.changePaymentMethod = async (req, res) => {
    try {
        const { paymentMethod } = req.body;
        const validMethods = ['PayPal', 'Stripe', 'COD', 'Credit Card'];

        if (!paymentMethod || !validMethods.includes(paymentMethod)) {
            return res.status(400).json({
                success: false,
                message: `Payment method must be one of: ${validMethods.join(', ')}`
            });
        }

        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (!isOwnerOrAdmin(order.user, req.user)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        if (order.isPaid) {
            return res.status(400).json({
                success: false,
                message: 'Cannot change payment method after payment'
            });
        }

        order.paymentMethod = paymentMethod;
        order.statusHistory.push({
            status: `Payment Method Changed to ${paymentMethod}`,
            changedBy: req.user._id
        });

        await order.save();

        res.json({ success: true, message: 'Payment method updated', data: order });
    } catch (err) {
        console.error('Payment method update failed:', err);
        res.status(500).json({ success: false, message: 'Failed to update payment method' });
    }
};

/**
 * @desc Get order status timeline
 * @route GET /api/orders/:id/timeline
 * @access Private (owner or admin)
 */
exports.getOrderStatusTimeline = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('statusHistory.changedBy', 'name');

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (!isOwnerOrAdmin(order.user, req.user)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const timeline = [
            { status: 'Order Placed', date: order.createdAt, automated: true },
            order.isPaid && { status: 'Payment Confirmed', date: order.paidAt, automated: true },
            order.isDelivered && { status: 'Delivered', date: order.deliveredAt, automated: true },
            order.isCanceled && { status: 'Canceled', date: order.canceledAt, automated: true },
            ...order.statusHistory.map(s => ({
                status: s.status,
                date: s.changedAt,
                by: s.changedBy?.name || 'System',
                automated: false
            }))
        ].filter(Boolean).sort((a, b) => new Date(a.date) - new Date(b.date));

        res.json({ success: true, data: { timeline, order: order._id } });
    } catch (err) {
        console.error('Timeline fetch failed:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch timeline' });
    }
};

/**
 * @desc Reorder (create new order from an old one) with stock validation
 * @route POST /api/orders/:id/reorder
 * @access Private (owner only)
 */
exports.reorder = async (req, res) => {
    try {
        const oldOrder = await Order.findById(req.params.id)
            .populate('orderItems.product');

        if (!oldOrder) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (oldOrder.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        const unavailableItems = [];
        const availableItems = [];

        for (const item of oldOrder.orderItems) {
            if (!item.isCanceled && item.product) {
                if (item.product.countInStock >= item.qty) {
                    availableItems.push({
                        product: item.product._id,
                        name: item.product.name,
                        qty: item.qty,
                        price: item.product.salePrice && item.product.saleEndDate > new Date()
                            ? item.product.salePrice
                            : item.product.price,
                        image: item.product.image
                    });
                } else {
                    unavailableItems.push({
                        name: item.product.name,
                        requestedQty: item.qty,
                        availableQty: item.product.countInStock
                    });
                }
            }
        }

        if (availableItems.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No items available for reorder',
                unavailableItems
            });
        }

        // Calculate new totals
        const itemsPrice = availableItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
        const shippingPrice = oldOrder.shippingPrice;
        const taxPrice = itemsPrice * 0.1; // Recalculate tax
        const totalPrice = itemsPrice + shippingPrice + taxPrice;

        const newOrderData = {
            user: req.user._id,
            orderItems: availableItems,
            shippingAddress: oldOrder.shippingAddress,
            paymentMethod: oldOrder.paymentMethod,
            itemsPrice,
            shippingPrice,
            taxPrice,
            totalPrice
        };
        req.body = newOrderData;
        return this.createOrder(req, res);

    } catch (err) {
        console.error('Reorder failed:', err);
        res.status(500).json({ success: false, message: 'Failed to create reorder' });
    }
};

/**
 * @desc Update order status with validation
 * @route PUT /api/orders/:id/status
 * @access Private/Admin
 */
exports.updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Canceled'];

        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Status must be one of: ${validStatuses.join(', ')}`
            });
        }

        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        order.customStatus = status;
        order.statusHistory.push({
            status,
            changedBy: req.user._id
        });

        await order.save();

        res.json({
            success: true,
            message: `Order status updated to ${status}`,
            data: order
        });
    } catch (err) {
        console.error('Status update failed:', err);
        res.status(500).json({ success: false, message: 'Failed to update order status' });
    }
};





// Additional methods to add to your orderController.js

/**
 * @desc Get order analytics and statistics (admin only)
 * @route GET /api/orders/analytics/stats
 * @access Private/Admin
 */
exports.getOrderStats = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        const dateFilter = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);
        
        const matchStage = dateFilter.createdAt ? { createdAt: dateFilter } : {};

        const stats = await Order.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    totalRevenue: { $sum: '$totalPrice' },
                    avgOrderValue: { $avg: '$totalPrice' },
                    paidOrders: { $sum: { $cond: ['$isPaid', 1, 0] } },
                    deliveredOrders: { $sum: { $cond: ['$isDelivered', 1, 0] } },
                    canceledOrders: { $sum: { $cond: ['$isCanceled', 1, 0] } },
                    pendingOrders: { 
                        $sum: { 
                            $cond: [
                                { $and: [{ $eq: ['$isPaid', false] }, { $eq: ['$isCanceled', false] }] }, 
                                1, 
                                0
                            ] 
                        } 
                    }
                }
            }
        ]);

        // Monthly revenue trend
        const monthlyStats = await Order.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    revenue: { $sum: '$totalPrice' },
                    orderCount: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

        // Top selling products
        const topProducts = await Order.aggregate([
            { $match: matchStage },
            { $unwind: '$orderItems' },
            { $match: { 'orderItems.isCanceled': { $ne: true } } },
            {
                $group: {
                    _id: '$orderItems.product',
                    totalQuantity: { $sum: '$orderItems.qty' },
                    totalRevenue: { $sum: { $multiply: ['$orderItems.qty', '$orderItems.price'] } },
                    productName: { $first: '$orderItems.name' }
                }
            },
            { $sort: { totalQuantity: -1 } },
            { $limit: 10 }
        ]);

        res.json({
            success: true,
            data: {
                summary: stats[0] || {},
                monthlyTrends: monthlyStats,
                topProducts
            }
        });
    } catch (err) {
        console.error('Order stats failed:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch order statistics' });
    }
};

/**
 * @desc Get orders by date range with filtering
 * @route GET /api/orders/date-range
 * @access Private/Admin
 */
exports.getOrdersByDateRange = async (req, res) => {
    try {
        const { startDate, endDate, status, paymentMethod } = req.query;
        
        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Start date and end date are required'
            });
        }

        const filter = {
            createdAt: {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            }
        };

        if (status) {
            switch (status) {
                case 'paid': filter.isPaid = true; break;
                case 'unpaid': filter.isPaid = false; break;
                case 'delivered': filter.isDelivered = true; break;
                case 'canceled': filter.isCanceled = true; break;
            }
        }

        if (paymentMethod) {
            filter.paymentMethod = paymentMethod;
        }

        const orders = await Order.find(filter)
            .populate('user', 'name email')
            .populate('orderItems.product', 'name')
            .sort({ createdAt: -1 });

        const summary = {
            totalOrders: orders.length,
            totalRevenue: orders.reduce((sum, order) => sum + order.totalPrice, 0),
            avgOrderValue: orders.length > 0 ? orders.reduce((sum, order) => sum + order.totalPrice, 0) / orders.length : 0
        };

        res.json({
            success: true,
            data: {
                orders,
                summary,
                dateRange: { startDate, endDate }
            }
        });
    } catch (err) {
        console.error('Date range orders failed:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch orders by date range' });
    }
};

/**
 * @desc Export orders to CSV format
 * @route GET /api/orders/export/csv
 * @access Private/Admin
 */
exports.exportOrdersCSV = async (req, res) => {
    try {
        const { startDate, endDate, status } = req.query;
        
        const filter = {};
        if (startDate && endDate) {
            filter.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        if (status) {
            switch (status) {
                case 'paid': filter.isPaid = true; break;
                case 'unpaid': filter.isPaid = false; break;
                case 'delivered': filter.isDelivered = true; break;
                case 'canceled': filter.isCanceled = true; break;
            }
        }

        const orders = await Order.find(filter)
            .populate('user', 'name email')
            .populate('orderItems.product', 'name')
            .sort({ createdAt: -1 });

        // Convert to CSV format
        const csvHeaders = [
            'Order ID',
            'Customer Name',
            'Customer Email',
            'Order Date',
            'Total Price',
            'Payment Method',
            'Payment Status',
            'Delivery Status',
            'Items Count',
            'Shipping Address'
        ];

        const csvData = orders.map(order => [
            order._id,
            order.user?.name || 'N/A',
            order.user?.email || 'N/A',
            order.createdAt.toISOString().split('T')[0],
            order.totalPrice.toFixed(2),
            order.paymentMethod,
            order.isPaid ? 'Paid' : 'Unpaid',
            order.isDelivered ? 'Delivered' : order.isCanceled ? 'Canceled' : 'Pending',
            order.orderItems.filter(item => !item.isCanceled).length,
            `${order.shippingAddress.address}, ${order.shippingAddress.city}`
        ]);

        const csvContent = [csvHeaders, ...csvData]
            .map(row => row.map(field => `"${field}"`).join(','))
            .join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="orders_${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csvContent);

    } catch (err) {
        console.error('CSV export failed:', err);
        res.status(500).json({ success: false, message: 'Failed to export orders' });
    }
};

/**
 * @desc Process bulk order updates
 * @route PUT /api/orders/bulk-update
 * @access Private/Admin
 */
exports.bulkUpdateOrders = async (req, res) => {
    try {
        const { orderIds, updateData } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Order IDs array is required'
            });
        }

        if (!updateData || Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Update data is required'
            });
        }

        // Validate update fields
        const allowedFields = ['customStatus', 'paymentMethod', 'isDelivered', 'isPaid'];
        const updateFields = {};
        
        for (const [key, value] of Object.entries(updateData)) {
            if (allowedFields.includes(key)) {
                updateFields[key] = value;
            }
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({
                success: false,
                message: `Only these fields can be updated: ${allowedFields.join(', ')}`
            });
        }

        const result = await Order.updateMany(
            { _id: { $in: orderIds } },
            { 
                $set: updateFields,
                $push: {
                    statusHistory: {
                        status: `Bulk Update: ${Object.keys(updateFields).join(', ')}`,
                        changedBy: req.user._id
                    }
                }
            }
        );

        res.json({
            success: true,
            message: `Updated ${result.modifiedCount} orders`,
            data: {
                matchedCount: result.matchedCount,
                modifiedCount: result.modifiedCount
            }
        });

    } catch (err) {
        console.error('Bulk update failed:', err);
        res.status(500).json({ success: false, message: 'Bulk update failed' });
    }
};

/**
 * @desc Get low stock alerts based on orders
 * @route GET /api/orders/analytics/low-stock
 * @access Private/Admin
 */
exports.getLowStockAlerts = async (req, res) => {
    try {
        const threshold = parseInt(req.query.threshold) || 10;
        
        // Get products that are frequently ordered but have low stock
        const lowStockProducts = await Order.aggregate([
            { $unwind: '$orderItems' },
            { $match: { 'orderItems.isCanceled': { $ne: true } } },
            {
                $group: {
                    _id: '$orderItems.product',
                    totalOrdered: { $sum: '$orderItems.qty' },
                    productName: { $first: '$orderItems.name' },
                    lastOrderDate: { $max: '$createdAt' }
                }
            },
            {
                $lookup: {
                    from: 'products',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'product'
                }
            },
            { $unwind: '$product' },
            {
                $match: {
                    'product.countInStock': { $lte: threshold }
                }
            },
            {
                $project: {
                    productId: '$_id',
                    productName: '$product.name',
                    currentStock: '$product.countInStock',
                    totalOrdered: 1,
                    lastOrderDate: 1,
                    urgency: {
                        $cond: [
                            { $lte: ['$product.countInStock', 5] },
                            'Critical',
                            { $cond: [{ $lte: ['$product.countInStock', threshold / 2] }, 'High', 'Medium'] }
                        ]
                    }
                }
            },
            { $sort: { currentStock: 1, totalOrdered: -1 } }
        ]);

        res.json({
            success: true,
            data: {
                lowStockProducts,
                threshold,
                criticalCount: lowStockProducts.filter(p => p.urgency === 'Critical').length,
                totalAlerts: lowStockProducts.length
            }
        });

    } catch (err) {
        console.error('Low stock alerts failed:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch low stock alerts' });
    }
};

/**
 * @desc Get customer order history and insights
 * @route GET /api/orders/customer/:customerId/insights
 * @access Private/Admin
 */
exports.getCustomerInsights = async (req, res) => {
    try {
        const { customerId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(customerId)) {
            return res.status(400).json({ success: false, message: 'Invalid customer ID' });
        }

        const customerStats = await Order.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(customerId) } },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    totalSpent: { $sum: '$totalPrice' },
                    avgOrderValue: { $avg: '$totalPrice' },
                    firstOrder: { $min: '$createdAt' },
                    lastOrder: { $max: '$createdAt' },
                    canceledOrders: { $sum: { $cond: ['$isCanceled', 1, 0] } }
                }
            }
        ]);

        // Get favorite products
        const favoriteProducts = await Order.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(customerId) } },
            { $unwind: '$orderItems' },
            { $match: { 'orderItems.isCanceled': { $ne: true } } },
            {
                $group: {
                    _id: '$orderItems.product',
                    productName: { $first: '$orderItems.name' },
                    totalQuantity: { $sum: '$orderItems.qty' },
                    totalSpent: { $sum: { $multiply: ['$orderItems.qty', '$orderItems.price'] } }
                }
            },
            { $sort: { totalQuantity: -1 } },
            { $limit: 5 }
        ]);

        // Get order frequency pattern
        const orderPattern = await Order.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(customerId) } },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    orderCount: { $sum: 1 },
                    totalSpent: { $sum: '$totalPrice' }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

        const customer = await User.findById(customerId).select('name email createdAt');

        res.json({
            success: true,
            data: {
                customer,
                stats: customerStats[0] || {},
                favoriteProducts,
                orderPattern,
                insights: {
                    loyaltyLevel: customerStats[0]?.totalOrders >= 10 ? 'High' : 
                                  customerStats[0]?.totalOrders >= 5 ? 'Medium' : 'Low',
                    riskLevel: customerStats[0]?.canceledOrders / customerStats[0]?.totalOrders > 0.2 ? 'High' : 'Low'
                }
            }
        });

    } catch (err) {
        console.error('Customer insights failed:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch customer insights' });
    }
};

/**
 * @desc Search orders with advanced filters
 * @route GET /api/orders/search
 * @access Private/Admin
 */
exports.searchOrders = async (req, res) => {
    try {
        const {
            query,
            status,
            paymentMethod,
            startDate,
            endDate,
            minAmount,
            maxAmount,
            page = 1,
            limit = 20
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Build search filter
        const searchFilter = {};
        
        if (query) {
            searchFilter.$or = [
                { '_id': { $regex: query, $options: 'i' } },
                { 'user.name': { $regex: query, $options: 'i' } },
                { 'user.email': { $regex: query, $options: 'i' } },
                { 'shippingAddress.city': { $regex: query, $options: 'i' } }
            ];
        }

        if (status) {
            switch (status) {
                case 'paid': searchFilter.isPaid = true; break;
                case 'unpaid': searchFilter.isPaid = false; break;
                case 'delivered': searchFilter.isDelivered = true; break;
                case 'canceled': searchFilter.isCanceled = true; break;
            }
        }

        if (paymentMethod) {
            searchFilter.paymentMethod = paymentMethod;
        }

        if (startDate || endDate) {
            searchFilter.createdAt = {};
            if (startDate) searchFilter.createdAt.$gte = new Date(startDate);
            if (endDate) searchFilter.createdAt.$lte = new Date(endDate);
        }

        if (minAmount || maxAmount) {
            searchFilter.totalPrice = {};
            if (minAmount) searchFilter.totalPrice.$gte = parseFloat(minAmount);
            if (maxAmount) searchFilter.totalPrice.$lte = parseFloat(maxAmount);
        }

        const [orders, total] = await Promise.all([
            Order.find(searchFilter)
                .populate('user', 'name email')
                .populate('orderItems.product', 'name')
                .skip(skip)
                .limit(parseInt(limit))
                .sort({ createdAt: -1 }),
            Order.countDocuments(searchFilter)
        ]);

        res.json({
            success: true,
            data: orders,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            },
            searchCriteria: req.query
        });

    } catch (err) {
        console.error('Order search failed:', err);
        res.status(500).json({ success: false, message: 'Order search failed' });
    }
};

/**
 * @desc Generate order invoice data
 * @route GET /api/orders/:id/invoice
 * @access Private (owner or admin)
 */
exports.generateInvoice = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('user', 'name email phone')
            .populate('orderItems.product', 'name sku');

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (!isOwnerOrAdmin(order.user._id, req.user)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const invoiceData = {
            invoiceNumber: `INV-${order._id.toString().slice(-8).toUpperCase()}`,
            order: {
                id: order._id,
                date: order.createdAt,
                status: order.isDelivered ? 'Delivered' : order.isPaid ? 'Paid' : 'Pending'
            },
            customer: {
                name: order.user.name,
                email: order.user.email,
                phone: order.user.phone
            },
            billing: order.shippingAddress,
            items: order.orderItems.filter(item => !item.isCanceled).map(item => ({
                name: item.name,
                sku: item.product?.sku,
                quantity: item.qty,
                price: item.price,
                total: item.qty * item.price
            })),
            summary: {
                subtotal: order.itemsPrice,
                shipping: order.shippingPrice,
                tax: order.taxPrice,
                total: order.totalPrice
            },
            payment: {
                method: order.paymentMethod,
                status: order.isPaid ? 'Paid' : 'Pending',
                paidAt: order.paidAt
            }
        };

        res.json({
            success: true,
            data: invoiceData
        });

    } catch (err) {
        console.error('Invoice generation failed:', err);
        res.status(500).json({ success: false, message: 'Failed to generate invoice' });
    }
};

/**
 * @desc Add tracking information to order
 * @route PUT /api/orders/:id/tracking
 * @access Private/Admin
 */
exports.addTrackingInfo = async (req, res) => {
    try {
        const { trackingNumber, carrier, trackingUrl } = req.body;

        if (!trackingNumber || !carrier) {
            return res.status(400).json({
                success: false,
                message: 'Tracking number and carrier are required'
            });
        }

        const order = await Order.findById(req.params.id).populate('user');
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (!order.isPaid) {
            return res.status(400).json({
                success: false,
                message: 'Cannot add tracking to unpaid order'
            });
        }

        order.trackingInfo = {
            trackingNumber,
            carrier,
            trackingUrl: trackingUrl || `https://track.${carrier.toLowerCase()}.com/${trackingNumber}`,
            addedAt: new Date()
        };

        order.statusHistory.push({
            status: `Tracking Added - ${carrier}: ${trackingNumber}`,
            changedBy: req.user._id
        });

        await order.save();

        try {
            await sendEmail(
                order.user.email,
                'Order Shipped - Tracking Available',
                `Hi ${order.user.name}, your order ${order._id} has been shipped! Track it using: ${trackingNumber} on ${carrier}`
            );
        } catch (emailError) {
            console.error('Failed to send tracking email:', emailError);
        }

        res.json({
            success: true,
            message: 'Tracking information added',
            data: order
        });

    } catch (err) {
        console.error('Add tracking failed:', err);
        res.status(500).json({ success: false, message: 'Failed to add tracking information' });
    }
};