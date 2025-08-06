const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');

const { Parser } = require('json2csv');

// @desc    Get basic admin dashboard statistics
// @route   GET /api/admin/dashboard
// @access  Private/Admin
exports.getAdminDashboardStats = async (req, res) => {
    try {
        const [stats] = await Order.aggregate([
            {
                $facet: {
                    totalOrders: [{ $count: "count" }],
                    totalSales: [
                        { $match: { isPaid: true } },
                        { $group: { _id: null, total: { $sum: "$totalPrice" } } }
                    ],
                    deliveredOrders: [
                        { $match: { isDelivered: true } },
                        { $count: "count" }
                    ],
                    canceledOrders: [
                        { $match: { isCanceled: true } },
                        { $count: "count" }
                    ]
                }
            }
        ]);

        const [userStats, productStats] = await Promise.all([
            User.countDocuments(),
            Product.countDocuments()
        ]);

        res.json({
            totalOrders: stats.totalOrders[0]?.count || 0,
            totalSales: stats.totalSales[0]?.total || 0,
            totalUsers: userStats,
            totalProducts: productStats,
            deliveredOrders: stats.deliveredOrders[0]?.count || 0,
            canceledOrders: stats.canceledOrders[0]?.count || 0
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



// @desc    Update order status (custom statuses)
// @route   PUT /api/admin/orders/:id/status
// @access  Private/Admin
exports.updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ message: 'Status is required' });
        }

        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        order.customStatus = status; // Add `customStatus` field in Order schema if not exists
        await order.save();

        res.json({ message: `Order status updated to ${status}`, order });
    } catch (err) {
        res.status(500).json({ message: 'Failed to update order status' });
    }
};

// @desc    Bulk update product stock
// @route   PUT /api/admin/products/stock
// @access  Private/Admin
exports.bulkUpdateProductStock = async (req, res) => {
    try {
        const { products } = req.body; // [{ productId, countInStock }, ...]
        if (!products || !Array.isArray(products)) {
            return res.status(400).json({ message: 'Products array is required' });
        }

        const bulkOps = products.map(item => ({
            updateOne: {
                filter: { _id: item.productId },
                update: { $set: { countInStock: item.countInStock } }
            }
        }));

        await Product.bulkWrite(bulkOps);
        res.json({ message: 'Stock updated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to update product stock' });
    }
};


// @desc    Export all orders as CSV
// @route   GET /api/admin/orders/export
// @access  Private/Admin
exports.exportOrdersCSV = async (req, res) => {
    try {
        const orders = await Order.find().populate('user', 'name email');
        const fields = [
            { label: 'Order ID', value: '_id' },
            { label: 'User', value: row => row.user?.name || 'N/A' },
            { label: 'Email', value: row => row.user?.email || 'N/A' },
            { label: 'Total Price', value: 'totalPrice' },
            { label: 'Is Paid', value: 'isPaid' },
            { label: 'Is Delivered', value: 'isDelivered' },
            { label: 'Created At', value: 'createdAt' }
        ];

        const json2csv = new Parser({ fields });
        const csv = json2csv.parse(orders);

        res.header('Content-Type', 'text/csv');
        res.attachment('orders.csv');
        res.send(csv);
    } catch (err) {
        res.status(500).json({ message: 'Failed to export orders' });
    }
};
