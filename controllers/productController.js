const Product = require('../models/Product');


// @desc    Get all products (with pagination, search, filter)
// @route   GET /api/products
// @access  Public
exports.getAllProducts = async (req, res) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const keyword = req.query.keyword
            ? {
                name: { $regex: req.query.keyword, $options: 'i' }
            }
            : {};

        const category = req.query.category ? { category: req.query.category } : {};
        const brand = req.query.brand ? { brand: req.query.brand } : {};

        const filter = {
            ...keyword,
            ...category,
            ...brand
        };

        const total = await Product.countDocuments(filter);

        const products = await Product.find(filter)
            .skip(skip)
            .limit(limit);

        res.json({
            products,
            total,
            page,
            pages: Math.ceil(total / limit)
        });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch products' });
    }
};


// @desc    Get single product by ID
// @route   GET /api/products/:id
// @access  Public
exports.getProductById = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ message: 'Product not found' });
        res.json(product);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching product' });
    }
};


// @desc    Create new product
// @route   POST /api/products
// @access  Private/Admin
exports.createProduct = async (req, res) => {
    try {
        const {
            name,
            brand,
            category,
            description,
            price,
            countInStock,
            image
        } = req.body;

        const product = new Product({
            name,
            brand,
            category,
            description,
            price,
            countInStock,
            image: image || '',
        });

        const saved = await product.save();
        res.status(201).json(saved);
    } catch (err) {
        console.error(err);
        res.status(400).json({ message: 'Failed to create product' });
    }
};


// @desc    Update existing product
// @route   PUT /api/products/:id
// @access  Private/Admin
exports.updateProduct = async (req, res) => {
    try {
        const updated = await Product.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        if (!updated) return res.status(404).json({ message: 'Product not found' });
        res.json(updated);
    } catch (err) {
        res.status(400).json({ message: 'Update failed' });
    }
};


// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private/Admin
exports.deleteProduct = async (req, res) => {
    try {
        const deleted = await Product.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: 'Product not found' });
        res.json({ message: 'Product deleted' });
    } catch (err) {
        res.status(500).json({ message: 'Delete failed' });
    }
};


// @desc    Get all unique product categories
// @route   GET /api/products/categories
// @access  Public
exports.getCategories = async (req, res) => {
    try {
        const categories = await Product.distinct('category');
        res.json(categories);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch categories' });
    }
};


// @desc    Get all unique product brands
// @route   GET /api/products/brands
// @access  Public
exports.getBrands = async (req, res) => {
    try {
        const brands = await Product.distinct('brand');
        res.json(brands);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch brands' });
    }
};
