const express = require('express');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/authMiddleware');
const logger = require('../middleware/adminLogger');

const {
  createOrder,
  getMyOrders,
  getOrderById,
  markOrderAsPaid,
  cancelOrder,
  cancelOrderItem,
  markOrderAsDelivered,
  getAllOrders
} = require('../controllers/orderController');

// Log all protected routes
router.use(protect, logger);

router.post('/', createOrder);
router.get('/myorders', getMyOrders);
router.get('/:id', getOrderById);
router.put('/:id/pay', markOrderAsPaid);
router.put('/:id/cancel', cancelOrder);
router.put('/:orderId/items/:productId/cancel', cancelOrderItem);
router.put('/:id/deliver', adminOnly, markOrderAsDelivered);
router.get('/', adminOnly, getAllOrders);

module.exports = router;
