const express = require('express');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/authMiddleware');

const {
    // Original methods
    createOrder,
    getMyOrders,
    getOrderById,
    markOrderAsPaid,
    cancelOrder,
    cancelOrderItem,
    markOrderAsDelivered,
    getAllOrders,
    updateShippingAddress,
    changePaymentMethod,
    getOrderStatusTimeline,
    reorder,
    updateOrderStatus,
    
    // New extended methods
    getOrderStats,
    getOrdersByDateRange,
    exportOrdersCSV,
    bulkUpdateOrders,
    getLowStockAlerts,
    getCustomerInsights,
    searchOrders,
    generateInvoice,
    addTrackingInfo
} = require('../controllers/orderController');

// Apply protect middleware to all routes
router.use(protect);

// ============ USER ROUTES (Authenticated Users) ============

// Order management
router.post('/', createOrder);
router.get('/myorders', getMyOrders);
router.post('/:id/reorder', reorder);

// Order details and modifications
router.get('/:id', getOrderById);
router.get('/:id/timeline', getOrderStatusTimeline);
router.get('/:id/invoice', generateInvoice);

// Order updates (before delivery)
router.put('/:id/pay', markOrderAsPaid);
router.put('/:id/cancel', cancelOrder);
router.put('/:orderId/items/:productId/cancel', cancelOrderItem);
router.put('/:id/address', updateShippingAddress);
router.put('/:id/payment', changePaymentMethod);

// ============ ADMIN ROUTES ============

// Analytics and reporting
router.get('/analytics/stats', adminOnly, getOrderStats);
router.get('/analytics/low-stock', adminOnly, getLowStockAlerts);
router.get('/date-range', adminOnly, getOrdersByDateRange);

// Data export and search
router.get('/export/csv', adminOnly, exportOrdersCSV);
router.get('/search', adminOnly, searchOrders);

// Customer insights
router.get('/customer/:customerId/insights', adminOnly, getCustomerInsights);

// Order management
router.get('/', adminOnly, getAllOrders);
router.put('/bulk-update', adminOnly, bulkUpdateOrders);

// Order status updates
router.put('/:id/deliver', adminOnly, markOrderAsDelivered);
router.put('/:id/status', adminOnly, updateOrderStatus);
router.put('/:id/tracking', adminOnly, addTrackingInfo);

// ============ ROUTE MIDDLEWARE FOR LOGGING (Optional) ============

// Middleware to log important order actions
const logOrderAction = (action) => {
    return (req, res, next) => {
        req.orderAction = action;
        next();
    };
};

// Apply logging middleware to critical actions
router.put('/:id/pay', logOrderAction('PAYMENT'), markOrderAsPaid);
router.put('/:id/deliver', adminOnly, logOrderAction('DELIVERY'), markOrderAsDelivered);
router.put('/:id/cancel', logOrderAction('CANCELLATION'), cancelOrder);

// ============ ERROR HANDLING MIDDLEWARE ============

// Global error handler for order routes
router.use((error, req, res, next) => {
    console.error('Order route error:', {
        error: error.message,
        stack: error.stack,
        route: req.route?.path,
        method: req.method,
        params: req.params,
        user: req.user?._id
    });

    if (error.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            message: 'Validation Error',
            errors: Object.values(error.errors).map(e => e.message)
        });
    }

    if (error.name === 'CastError') {
        return res.status(400).json({
            success: false,
            message: 'Invalid ID format'
        });
    }

    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// ============ FUTURE NOTIFICATION SYSTEM ============

/* 
const Notification = require('../models/Notification');

// Enhanced notification middleware
const createOrderNotification = async (req, res, next) => {
    try {
        // Get the order from the response or fetch it
        let order = res.locals.order;
        
        if (!order && req.params.id) {
            order = await Order.findById(req.params.id).populate('user');
        }

        if (order && req.orderAction) {
            const notificationData = {
                user: order.user._id,
                type: 'ORDER',
                link: `/orders/${order._id}`,
                createdAt: new Date()
            };

            switch (req.orderAction) {
                case 'PAYMENT':
                    notificationData.message = `Payment confirmed for order #${order._id}`;
                    notificationData.priority = 'high';
                    break;
                case 'DELIVERY':
                    notificationData.message = `Order #${order._id} has been delivered`;
                    notificationData.priority = 'high';
                    break;
                case 'CANCELLATION':
                    notificationData.message = `Order #${order._id} has been cancelled`;
                    notificationData.priority = 'medium';
                    break;
                default:
                    notificationData.message = `Order #${order._id} status updated`;
                    notificationData.priority = 'low';
            }

            await Notification.create(notificationData);
        }
    } catch (error) {
        console.error('Failed to create notification:', error);
        // Don't fail the main request if notification fails
    }
    next();
};

// Real-time notifications with Socket.io (if implemented)
const sendRealTimeNotification = (req, res, next) => {
    if (req.app.get('io') && res.locals.order) {
        req.app.get('io').to(`user_${res.locals.order.user._id}`).emit('orderUpdate', {
            orderId: res.locals.order._id,
            action: req.orderAction,
            timestamp: new Date()
        });
    }
    next();
};
*/

module.exports = router;