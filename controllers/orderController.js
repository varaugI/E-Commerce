const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');

const isOwnerOrAdmin = (orderUserId, currentUser) => {
    return orderUserId.toString() === currentUser._id.toString() || currentUser.isAdmin;
};

/**
 * @desc Create a new order
 * @route POST /api/orders
 * @access Private
 */
exports.createOrder = async (req, res) => {
    try {
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
            return res.status(400).json({ success: false, message: 'No order items' });
        }

        const bulkOps = orderItems.map(item => ({
            updateOne: {
                filter: { _id: item.product, countInStock: { $gte: item.qty } },
                update: { $inc: { countInStock: -item.qty } }
            }
        }));

        const bulkResult = await Product.bulkWrite(bulkOps);
        if (bulkResult.modifiedCount !== orderItems.length) {
            return res.status(400).json({ success: false, message: 'One or more items are out of stock.' });
        }

        const order = new Order({
            user: req.user._id,
            orderItems,
            shippingAddress,
            paymentMethod,
            itemsPrice,
            shippingPrice,
            taxPrice,
            totalPrice
        });

        const createdOrder = await order.save();

        const user = await User.findById(req.user._id);
        sendEmail(
            user.email,
            'Order Confirmation',
            `Hi ${user.name}, your order ${createdOrder._id} has been placed successfully.`
        ).catch(console.error);

        res.status(201).json({ success: true, message: 'Order created successfully', data: createdOrder });
    } catch (err) {
        console.error('Order creation error:', err);
        res.status(500).json({ success: false, message: 'Failed to create order' });
    }
};

/**
 * @desc Get logged-in user's orders with pagination
 * @route GET /api/orders/myorders?page=&limit=
 * @access Private
 */
exports.getMyOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const orders = await Order.find({ user: req.user._id })
            .skip(skip)
            .limit(limit)
            .sort({ createdAt: -1 });

        res.json({ success: true, page, limit, data: orders });
    } catch (err) {
        console.error('Fetching my orders failed:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
};

/**
 * @desc Get order by ID
 * @route GET /api/orders/:id
 * @access Private (owner or admin)
 */
exports.getOrderById = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('user', 'name email');
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

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
 * @desc Mark order as paid
 * @route PUT /api/orders/:id/pay
 * @access Private
 */
exports.markOrderAsPaid = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('user');
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        order.isPaid = true;
        order.paidAt = Date.now();
        order.paymentResult = {
            id: req.body.id,
            status: req.body.status,
            update_time: req.body.update_time,
            email_address: req.body.email_address
        };

        const updatedOrder = await order.save();

        sendEmail(
            order.user.email,
            'Payment Confirmation',
            `Hi ${order.user.name}, your order ${order._id} has been marked as paid.`
        ).catch(console.error);

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
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        order.isDelivered = true;
        order.deliveredAt = Date.now();

        const updatedOrder = await order.save();

        sendEmail(
            order.user.email,
            'Delivery Notification',
            `Hi ${order.user.name}, your order ${order._id} has been delivered. Thank you!`
        ).catch(console.error);

        res.json({ success: true, message: 'Order marked as delivered', data: updatedOrder });
    } catch (err) {
        console.error('Delivery update failed:', err);
        res.status(500).json({ success: false, message: 'Failed to mark as delivered' });
    }
};

/**
 * @desc Get all orders (admin only)
 * @route GET /api/orders
 * @access Private/Admin
 */
exports.getAllOrders = async (req, res) => {
    try {
        const orders = await Order.find({}).populate('user', 'name email').sort({ createdAt: -1 });
        res.json({ success: true, data: orders });
    } catch (err) {
        console.error('Fetching all orders failed:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
};

/**
 * @desc Cancel an entire order
 * @route PUT /api/orders/:id/cancel
 * @access Private (owner or admin)
 */
exports.cancelOrder = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('user');
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        if (!isOwnerOrAdmin(order.user._id, req.user)) {
            return res.status(403).json({ success: false, message: 'Not authorized to cancel this order' });
        }
        if (order.isCanceled) return res.status(400).json({ success: false, message: 'Order already canceled' });

        for (const item of order.orderItems) {
            const product = await Product.findById(item.product);
            if (product && !item.isCanceled) {
                product.countInStock += item.qty;
                await product.save();
            }
        }

        order.isCanceled = true;
        order.canceledAt = Date.now();
        await order.save();


        sendEmail(
            order.user.email,
            'Order Canceled',
            `Hi ${order.user.name}, your order ${order._id} has been canceled and stock restored.`
        ).catch(console.error);

        res.json({ success: true, message: 'Order canceled and stock restored' });
    } catch (err) {
        console.error('Cancel order failed:', err);
        res.status(500).json({ success: false, message: 'Order cancellation failed' });
    }
};

/**
 * @desc Cancel one item in an order
 * @route PUT /api/orders/:orderId/items/:productId/cancel
 * @access Private (owner or admin)
 */
exports.cancelOrderItem = async (req, res) => {
    try {
        const { orderId, productId } = req.params;

        const order = await Order.findById(orderId).populate('user');
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        if (!isOwnerOrAdmin(order.user._id, req.user)) {
            return res.status(403).json({ success: false, message: 'Not authorized to cancel item' });
        }

        const item = order.orderItems.find(i => i.product.toString() === productId && !i.isCanceled);
        if (!item) return res.status(404).json({ success: false, message: 'Item not found or already canceled' });

        const product = await Product.findById(productId);
        if (product) {
            product.countInStock += item.qty;
            await product.save();
        }

        item.isCanceled = true;
        await order.save();

        sendEmail(
            order.user.email,
            'Item Canceled',
            `Hi ${order.user.name}, the item "${item.name}" has been canceled from your order ${order._id}.`
        ).catch(console.error);

        res.json({ success: true, message: 'Item canceled and stock restored' });
    } catch (err) {
        console.error('Cancel order item failed:', err);
        res.status(500).json({ success: false, message: 'Item cancellation failed' });
    }
};



/**
 * @desc Update shipping address (before shipping)
 * @route PUT /api/orders/:id/address
 * @access Private (owner or admin)
 */
exports.updateShippingAddress = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        if (!isOwnerOrAdmin(order.user, req.user)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        if (order.isDelivered) {
            return res.status(400).json({ success: false, message: 'Cannot update address after delivery' });
        }

        order.shippingAddress = req.body.shippingAddress || order.shippingAddress;
        await order.save();

        res.json({ success: true, order });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @desc Change payment method (before payment)
 * @route PUT /api/orders/:id/payment
 * @access Private (owner or admin)
 */
exports.changePaymentMethod = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        if (!isOwnerOrAdmin(order.user, req.user)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        if (order.isPaid) {
            return res.status(400).json({ success: false, message: 'Cannot change payment method after payment' });
        }

        order.paymentMethod = req.body.paymentMethod || order.paymentMethod;
        await order.save();

        res.json({ success: true, order });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @desc Get order status timeline
 * @route GET /api/orders/:id/timeline
 * @access Private (owner or admin)
 */
exports.getOrderStatusTimeline = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        if (!isOwnerOrAdmin(order.user, req.user)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const timeline = [
            { status: 'Order Placed', date: order.createdAt },
            { status: 'Paid', date: order.isPaid ? order.paidAt : null },
            { status: 'Delivered', date: order.isDelivered ? order.deliveredAt : null },
            order.statusHistory.map(s => ({ status: s.status, date: s.changedAt, by: s.changedBy?.name }))
        ];

        res.json({ success: true, timeline });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @desc Reorder (create new order from an old one)
 * @route POST /api/orders/:id/reorder
 * @access Private (owner only)
 */
exports.reorder = async (req, res) => {
    try {
        const oldOrder = await Order.findById(req.params.id).populate('orderItems.product');
        if (!oldOrder) return res.status(404).json({ success: false, message: 'Order not found' });

        if (oldOrder.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const newOrder = await Order.create({
            user: req.user._id,
            orderItems: oldOrder.orderItems.map(item => ({
                product: item.product._id,
                qty: item.qty,
                price: item.price
            })),
            shippingAddress: oldOrder.shippingAddress,
            paymentMethod: oldOrder.paymentMethod,
            itemsPrice: oldOrder.itemsPrice,
            shippingPrice: oldOrder.shippingPrice,
            taxPrice: oldOrder.taxPrice,
            totalPrice: oldOrder.totalPrice
        });

        res.status(201).json({ success: true, order: newOrder });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ message: 'Status is required' });
        }

        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        order.customStatus = status;
        order.statusHistory.push({ status, changedBy: req.user._id });

        await order.save();
        res.json({ message: `Order status updated to ${status}`, order });
    } catch (err) {
        res.status(500).json({ message: 'Failed to update order status' });
    }
};


