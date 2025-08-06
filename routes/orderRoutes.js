const express = require('express');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/authMiddleware');


const {
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
    reorder
} = require('../controllers/orderController');



router.post('/', createOrder);
router.get('/myorders', getMyOrders);
router.get('/:id', getOrderById);
router.put('/:id/pay', markOrderAsPaid);
router.put('/:id/cancel', cancelOrder);
router.put('/:orderId/items/:productId/cancel', cancelOrderItem);
router.put('/:id/address', updateShippingAddress);
router.put('/:id/payment', changePaymentMethod);
router.get('/:id/timeline', getOrderStatusTimeline);
router.post('/:id/reorder', reorder);

/* const Notification = require('../models/Notification');
await Notification.create({
    user: order.user,
    type: 'ORDER',
    message: `Order #${order._id} status updated to ${order.status}`,
    link: `/orders/${order._id}`
}); */

router.put('/:id/deliver', adminOnly, markOrderAsDelivered);
router.get('/', adminOnly, getAllOrders);

module.exports = router;
