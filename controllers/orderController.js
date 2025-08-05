const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');

/**
 * @desc    Create a new order
 * @route   POST /api/orders
 * @access  Private
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
            return res.status(400).json({ message: 'No order items' });
        }

        // Check and reduce product stock
        for (const item of orderItems) {
            const product = await Product.findById(item.product);
            if (!product) return res.status(404).json({ message: `Product not found: ${item.name}` });
            if (product.countInStock < item.qty)
                return res.status(400).json({ message: `Not enough stock for ${item.name}` });
            product.countInStock -= item.qty;
            await product.save();
        }

        // Create and save order
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
        await createUserLog({
            userId: req.user._id,
            action: 'createOrder',
            targetType: 'ORDER',
            targetId: createdOrder._id,
            details: {
                items: orderItems.map(i => ({ name: i.name, qty: i.qty })),
                total: totalPrice
            }
        });

        // Send confirmation email
        const user = await User.findById(req.user._id);
        await sendEmail(
            user.email,
            'Order Confirmation',
            `Hi ${user.name}, your order ${createdOrder._id} has been placed successfully.`
        );

        res.status(201).json(createdOrder);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to create order' });
    }
};

/**
 * @desc    Get logged-in user's orders
 * @route   GET /api/orders/myorders
 * @access  Private
 */
exports.getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user._id });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch orders' });
    }
};

/**
 * @desc    Get order by ID
 * @route   GET /api/orders/:id
 * @access  Private (owner or admin)
 */
exports.getOrderById = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('user', 'name email');
        if (!order) return res.status(404).json({ message: 'Order not found' });

        if (req.user._id.toString() !== order.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        res.json(order);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch order' });
    }
};

/**
 * @desc    Mark order as paid
 * @route   PUT /api/orders/:id/pay
 * @access  Private
 */
exports.markOrderAsPaid = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        order.isPaid = true;
        order.paidAt = Date.now();
        order.paymentResult = {
            id: req.body.id,
            status: req.body.status,
            update_time: req.body.update_time,
            email_address: req.body.email_address
        };

        const updatedOrder = await order.save();
        await createUserLog({
            userId: req.user._id,
            action: 'markOrderAsPaid',
            targetType: 'ORDER',
            targetId: order._id,
            details: { paymentResult: req.body }
        });

        await sendEmail(
            order.user.email,
            'Payment Confirmation',
            `Hi, your order ${order._id} has been marked as paid.`
        );

        res.json(updatedOrder);
    } catch (err) {
        res.status(500).json({ message: 'Failed to mark as paid' });
    }
};

/**
 * @desc    Mark order as delivered
 * @route   PUT /api/orders/:id/deliver
 * @access  Private/Admin
 */
exports.markOrderAsDelivered = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        order.isDelivered = true;
        order.deliveredAt = Date.now();

        const updatedOrder = await order.save();
        await createAdminLog({
            adminId: req.user._id,
            action: 'markOrderAsDelivered',
            targetType: 'ORDER',
            targetId: order._id,
            details: { deliveredAt: order.deliveredAt }
        });

        await sendEmail(
            order.user.email,
            'Delivery Notification',
            `Hi, your order ${order._id} has been delivered. Thank you!`
        );

        res.json(updatedOrder);
    } catch (err) {
        res.status(500).json({ message: 'Failed to mark as delivered' });
    }
};

/**
 * @desc    Get all orders
 * @route   GET /api/orders
 * @access  Private/Admin
 */
exports.getAllOrders = async (req, res) => {
    try {
        const orders = await Order.find({}).populate('user', 'name email');
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch orders' });
    }
};

/**
 * @desc    Cancel an entire order
 * @route   PUT /api/orders/:id/cancel
 * @access  Private (owner or admin)
 */
exports.cancelOrder = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('user');
        if (!order) return res.status(404).json({ message: 'Order not found' });
        if (order.isCanceled) return res.status(400).json({ message: 'Order already canceled' });

        // Restore stock for all non-canceled items
        for (const item of order.orderItems) {
            const product = await Product.findById(item.product);
            if (product && !item.isCanceled) {
                product.countInStock += item.qty;
                await product.save();
            }
        }

        order.isCanceled = true;
        order.canceledAt = new Date();
        await order.save();
        const logFn = req.user.isAdmin ? createAdminLog : createUserLog;
        await logFn({
            [req.user.isAdmin ? 'adminId' : 'userId']: req.user._id,
            action: 'cancelOrder',
            targetType: 'ORDER',
            targetId: order._id,
            details: { itemCount: order.orderItems.length }
        });

        await sendEmail(
            order.user.email,
            'Order Canceled',
            `Hi ${order.user.name}, your order ${order._id} has been canceled and the items restocked.`
        );

        res.json({ message: 'Order canceled and stock restored' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Order cancellation failed' });
    }
};

/**
 * @desc    Cancel one item in an order
 * @route   PUT /api/orders/:orderId/items/:productId/cancel
 * @access  Private (owner or admin)
 */
exports.cancelOrderItem = async (req, res) => {
    try {
        const { orderId, productId } = req.params;

        const order = await Order.findById(orderId).populate('user');
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const item = order.orderItems.find(
            (i) => i.product.toString() === productId && !i.isCanceled
        );

        if (!item) return res.status(404).json({ message: 'Item not found or already canceled' });

        const product = await Product.findById(productId);
        if (product) {
            product.countInStock += item.qty;
            await product.save();
        }

        item.isCanceled = true;
        await order.save();
        const logFn = req.user.isAdmin ? createAdminLog : createUserLog;
        await logFn({
            [req.user.isAdmin ? 'adminId' : 'userId']: req.user._id,
            action: 'cancelOrderItem',
            targetType: 'ORDER',
            targetId: order._id,
            details: { productId, productName: item.name, qty: item.qty }
        });

        await sendEmail(
            order.user.email,
            'Item Canceled from Your Order',
            `Hi ${order.user.name}, the item "${item.name}" has been canceled from your order ${order._id}.`
        );

        res.json({ message: 'Item canceled and stock restored' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Item cancellation failed' });
    }
};
