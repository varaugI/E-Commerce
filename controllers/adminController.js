const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');


// @desc    Get basic admin dashboard statistics
// @route   GET /api/admin/dashboard
// @access  Private/Admin
exports.getAdminDashboardStats = async (req, res) => {
    try {
        const totalOrders = await Order.countDocuments();
        const totalSales = await Order.aggregate([
            { $match: { isPaid: true } },
            { $group: { _id: null, total: { $sum: "$totalPrice" } } }
        ]);

        const totalUsers = await User.countDocuments();
        const totalProducts = await Product.countDocuments();

        res.json({
            totalOrders,
            totalSales: totalSales[0]?.total || 0,
            totalUsers,
            totalProducts
        });
    } catch (err) {
        res.status(500).json({ message: 'Failed to load dashboard stats' });
    }
};


// @desc    Get detailed admin stats including order statuses
// @route   GET /api/admin/stats
// @access  Private/Admin
exports.getAdminStats = async (req, res) => {
    try {
        const totalOrders = await Order.countDocuments();
        const totalUsers = await User.countDocuments();

        const totalSalesData = await Order.aggregate([
            { $match: { isPaid: true } },
            { $group: { _id: null, totalSales: { $sum: '$totalPrice' } } }
        ]);
        const totalSales = totalSalesData[0]?.totalSales || 0;

        const deliveredOrders = await Order.countDocuments({ isDelivered: true });
        const canceledOrders = await Order.countDocuments({ isCanceled: true });

        res.json({
            totalOrders,
            totalUsers,
            totalSales,
            deliveredOrders,
            canceledOrders
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch admin stats' });
    }
};

// @desc    Get top-selling products (by quantity sold)
// @route   GET /api/admin/top-products
// @access  Private/Admin
exports.getTopSellingProducts = async (req, res) => {
    try {
        const topProducts = await Order.aggregate([
            { $unwind: '$orderItems' },
            {
                $group: {
                    _id: '$orderItems.product',
                    totalSold: { $sum: '$orderItems.qty' },
                    name: { $first: '$orderItems.name' },
                    image: { $first: '$orderItems.image' }
                }
            },
            { $sort: { totalSold: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: 'products',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'productDetails'
                }
            },
            {
                $unwind: '$productDetails'
            },
            {
                $project: {
                    _id: 1,
                    name: 1,
                    image: 1,
                    totalSold: 1,
                    price: '$productDetails.price'
                }
            }
        ]);

        res.json(topProducts);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch top-selling products' });
    }
};


// @desc    Get monthly sales trend (last 12 months)
// @route   GET /api/admin/sales-trend
// @access  Private/Admin
exports.getMonthlySalesTrend = async (req, res) => {
    try {
        const salesData = await Order.aggregate([
            { $match: { isPaid: true } },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    totalSales: { $sum: '$totalPrice' },
                    orders: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': -1, '_id.month': -1 } },
            { $limit: 12 }
        ]);

        const formatted = salesData.map(item => ({
            month: `${item._id.year}-${String(item._id.month).padStart(2, '0')}`,
            totalSales: item.totalSales,
            orders: item.orders
        })).reverse();

        res.json(formatted);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch sales trend' });
    }
};


// @desc    Get number of new users in the current month
// @route   GET /api/admin/new-users
// @access  Private/Admin
exports.getNewUsersThisMonth = async (req, res) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const newUsers = await User.countDocuments({
            createdAt: { $gte: startOfMonth }
        });

        res.json({ newUsers });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch new users' });
    }
};



// @desc    Get recent admin logs
// @route   GET /api/admin/logs
// @access  Private/Admin
exports.getAdminLogs = async (req, res) => {
    try {
        const logs = await AdminLog.find()
            .populate('admin', 'name email')
            .sort({ createdAt: -1 })
            .limit(100);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch admin logs' });
    }
};


