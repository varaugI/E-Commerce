const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware');
const {
    getAdminDashboardStats,
    getAdminStats
} = require('../controllers/adminController');

const adminLogger = require('../middleware/adminLogger');

router.get('/dashboard', protect, adminOnly, adminLogger('Dashboard'), getAdminDashboardStats);
router.get('/stats', protect, adminOnly, adminLogger('Stats'), getAdminStats);

module.exports = router;
