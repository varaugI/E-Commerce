const Product = require('../models/Product');
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 600 }); // 10 minutes

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

        const minPrice = req.query.minPrice ? Number(req.query.minPrice) : 0;
        const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : Infinity;
        const minRating = req.query.minRating ? Number(req.query.minRating) : 0;
        const inStock = req.query.inStock === 'true';

        const priceFilter = { price: { $gte: minPrice, $lte: maxPrice } };
        const ratingFilter = { rating: { $gte: minRating } };
        const stockFilter = inStock ? { countInStock: { $gt: 0 } } : {};

        const filter = {
            ...keyword,
            ...category,
            ...brand,
            ...priceFilter,
            ...ratingFilter,
            ...stockFilter
        };

        const total = await Product.countDocuments(filter);

        const products = await Product.find(filter)
            .skip(skip)
            .limit(limit);

        for (let product of products) {
            if (product.saleEndDate && product.saleEndDate < new Date()) {
                product.salePrice = undefined;
                product.saleEndDate = undefined;
                await product.save();
            }
        }

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
        if (product.saleEndDate && product.saleEndDate < new Date()) {
            product.salePrice = undefined;
            product.saleEndDate = undefined;
            await product.save();
        }
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
    const cacheKey = 'categories';
    let categories = cache.get(cacheKey);
    
    if (!categories) {
        categories = await Product.distinct('category');
        cache.set(cacheKey, categories);
    }
    
    res.json(categories);
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


// @desc    Add product review
// @route   POST /api/products/:id/reviews
// @access  Private
exports.addProductReview = async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const product = await Product.findById(req.params.id);

        if (!product) return res.status(404).json({ message: 'Product not found' });

        const alreadyReviewed = product.reviews.find(r => r.user.toString() === req.user._id.toString());
        if (alreadyReviewed) {
            return res.status(400).json({ message: 'Product already reviewed' });
        }

        const review = {
            user: req.user._id,
            name: req.user.name,
            rating: Number(rating),
            comment
        };

        product.reviews.push(review);
        product.numReviews = product.reviews.length;
        product.rating = product.reviews.reduce((acc, item) => item.rating + acc, 0) / product.reviews.length;

        await product.save();
        res.status(201).json({ message: 'Review added' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to add review' });
    }
};


// @desc    Bulk import products (CSV/JSON array in body)
// @route   POST /api/products/bulk
// @access  Private/Admin
exports.bulkImportProducts = async (req, res) => {
    try {
        const products = req.body.products; // [{ name, brand, category, price, countInStock }, ...]
        if (!Array.isArray(products) || products.length === 0) {
            return res.status(400).json({ message: 'No products provided' });
        }

        const inserted = await Product.insertMany(products);
        res.status(201).json({ message: `${inserted.length} products imported`, data: inserted });
    } catch (err) {
        res.status(500).json({ message: 'Bulk import failed' });
    }
};


// @desc    Get related products by category
// @route   GET /api/products/:id/related
// @access  Public
exports.getRelatedProducts = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ message: 'Product not found' });

        const related = await Product.find({
            category: product.category,
            _id: { $ne: product._id }
        }).limit(10);

        res.json(related);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch related products' });
    }
};

// @desc Add or remove product from wishlist
// @route POST /api/products/:id/wishlist
// @access Private
exports.toggleWishlist = async (req, res) => {
    const user = await User.findById(req.user._id);
    const productId = req.params.id;

    if (!user) return res.status(404).json({ message: 'User not found' });

    const index = user.wishlist.indexOf(productId);
    if (index === -1) {
        user.wishlist.push(productId);
        await user.save();
        return res.json({ message: 'Added to wishlist' });
    } else {
        user.wishlist.splice(index, 1);
        await user.save();
        return res.json({ message: 'Removed from wishlist' });
    }
};

// @desc Ask a question about a product
// @route POST /api/products/:id/questions
// @access Private
exports.askQuestion = async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    product.questions.push({
        user: req.user._id,
        question: req.body.question
    });

    await product.save();
    res.json({ message: 'Question added' });
};

// @desc Answer a product question
// @route PUT /api/products/:id/questions/:qid
// @access Private/Admin
exports.answerQuestion = async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const question = product.questions.id(req.params.qid);
    if (!question) return res.status(404).json({ message: 'Question not found' });

    question.answer = req.body.answer;
    question.answeredBy = req.user._id;

    await product.save();
    res.json({ message: 'Answer added' });
};

// @desc Get product by ID and increase view count
// @route GET /api/products/:id
exports.getProductById = async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    product.viewCount += 1;
    await product.save();

    res.json(product);
};

// @desc Get trending products (most viewed last 7 days)
// @route GET /api/products/trending
exports.getTrendingProducts = async (req, res) => {
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const products = await Product.find({ updatedAt: { $gte: since } })
        .sort({ viewCount: -1 })
        .limit(10);

    res.json(products);
};

// @desc Set flash sale on a product
// @route PUT /api/products/:id/sale
// @access Private/Admin
exports.setFlashSale = async (req, res) => {
    const { salePrice, saleEndDate } = req.body;
    const product = await Product.findByIdAndUpdate(req.params.id, { salePrice, saleEndDate }, { new: true });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Flash sale set', product });
};

// @desc Report a review
// @route PUT /api/products/:productId/reviews/:reviewId/report
// @access Private
exports.reportReview = async (req, res) => {
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const review = product.reviews.id(req.params.reviewId);
    if (!review) return res.status(404).json({ message: 'Review not found' });

    review.isReported = true;
    await product.save();
    res.json({ message: 'Review reported' });
};

// @desc Moderate review (hide or unhide)
// @route PUT /api/products/:productId/reviews/:reviewId/moderate
// @access Private/Admin
exports.moderateReview = async (req, res) => {
    const { hide } = req.body;
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const review = product.reviews.id(req.params.reviewId);
    if (!review) return res.status(404).json({ message: 'Review not found' });

    review.isHidden = hide;
    await product.save();
    res.json({ message: hide ? 'Review hidden' : 'Review unhidden' });
};

// @desc Vote on a review
// @route POST /api/products/:productId/reviews/:reviewId/vote
// @access Private
exports.voteReview = async (req, res) => {
    const { vote } = req.body; // 'helpful' or 'notHelpful'
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const review = product.reviews.id(req.params.reviewId);
    if (!review) return res.status(404).json({ message: 'Review not found' });

    const userId = req.user._id;
    const hasVotedHelpful = review.helpfulVotes.includes(userId);
    const hasVotedNotHelpful = review.notHelpfulVotes.includes(userId);

    if (vote === 'helpful') {
        if (!hasVotedHelpful) {
            review.helpfulVotes.push(userId);
            review.notHelpfulVotes.pull(userId);
        }
    } else if (vote === 'notHelpful') {
        if (!hasVotedNotHelpful) {
            review.notHelpfulVotes.push(userId);
            review.helpfulVotes.pull(userId);
        }
    } else {
        return res.status(400).json({ message: 'Invalid vote type' });
    }

    await product.save();
    res.json({ message: `Review voted as ${vote}` });
};
