const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware');
const {
    getAdminDashboardStats,
    getAdminStats,
    updateOrderStatus,
    bulkUpdateProductStock,
    exportOrdersCSV
} = require('../controllers/adminController');


router.get('/dashboard', protect, adminOnly, getAdminDashboardStats);
router.get('/stats', protect, adminOnly, getAdminStats);
router.put('/orders/:id/status', adminOnly, updateOrderStatus);
router.put('/products/stock', adminOnly, bulkUpdateProductStock);
router.get('/orders/export', adminOnly, exportOrdersCSV);

module.exports = router;
