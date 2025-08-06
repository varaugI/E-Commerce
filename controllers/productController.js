const Product = require('../models/Product');
const User = require('../models/User');
const NodeCache = require('node-cache');
const Joi = require('joi');
const mongoose = require('mongoose');
const createLog = require('../utils/createLog');
const cache = new NodeCache();
const CACHE_KEYS = {
    CATEGORIES: 'categories',
    BRANDS: 'brands',
    TRENDING: 'trending_products'
};

const CACHE_TTL = {
    CATEGORIES: 600, // 10 minutes
    BRANDS: 600,     // 10 minutes
    TRENDING: 300,   // 5 minutes
    PRODUCT: 180     // 3 minutes
};


const productValidationSchema = Joi.object({
    name: Joi.string().trim().min(2).max(200).required(),
    brand: Joi.string().trim().min(1).max(100).required(),
    category: Joi.string().trim().min(1).max(100).required(),
    description: Joi.string().trim().max(2000).allow(''),
    price: Joi.number().positive().precision(2).required(),
    countInStock: Joi.number().integer().min(0).required(),
    image: Joi.string().uri().allow(''),
    salePrice: Joi.number().positive().precision(2).optional(),
    saleEndDate: Joi.date().greater('now').optional()
});

const reviewValidationSchema = Joi.object({
    rating: Joi.number().integer().min(1).max(5).required(),
    comment: Joi.string().trim().min(5).max(1000).required()
});

const questionValidationSchema = Joi.object({
    question: Joi.string().trim().min(5).max(500).required()
});

const bulkImportValidationSchema = Joi.object({
    products: Joi.array().items(productValidationSchema).min(1).max(100).required()
});

const validateObjectId = (id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error('Invalid ID format');
    }
};

const buildProductFilter = (query) => {
    const filter = {};

    if (query.keyword) {
        filter.$or = [
            { name: { $regex: query.keyword, $options: 'i' } },
            { description: { $regex: query.keyword, $options: 'i' } }
        ];
    }
    if (query.category) {
        filter.category = { $regex: query.category, $options: 'i' };
    }
    if (query.brand) {
        filter.brand = { $regex: query.brand, $options: 'i' };
    }
    const minPrice = parseFloat(query.minPrice) || 0;
    const maxPrice = parseFloat(query.maxPrice);
    if (maxPrice) {
        filter.price = { $gte: minPrice, $lte: maxPrice };
    } else if (minPrice > 0) {
        filter.price = { $gte: minPrice };
    }
    const minRating = parseFloat(query.minRating);
    if (minRating && minRating > 0) {
        filter.rating = { $gte: minRating };
    }
    if (query.inStock === 'true') {
        filter.countInStock = { $gt: 0 };
    }
    if (query.onSale === 'true') {
        filter.salePrice = { $exists: true };
        filter.saleEndDate = { $gt: new Date() };
    }
    return filter;
};

const getSortOption = (sortBy) => {
    const sortOptions = {
        'price_asc': { price: 1 },
        'price_desc': { price: -1 },
        'rating_desc': { rating: -1 },
        'name_asc': { name: 1 },
        'newest': { createdAt: -1 },
        'oldest': { createdAt: 1 },
        'popular': { viewCount: -1 }
    };

    return sortOptions[sortBy] || { createdAt: -1 };
};

const updateExpiredSales = async (products) => {
    const now = new Date();
    const updates = [];
    for (const product of products) {
        if (product.saleEndDate && product.saleEndDate < now && product.salePrice) {
            updates.push({
                updateOne: {
                    filter: { _id: product._id },
                    update: {
                        $unset: { salePrice: "", saleEndDate: "" }
                    }
                }
            });
        }
    }

    if (updates.length > 0) {
        await Product.bulkWrite(updates);
        cache.del(CACHE_KEYS.CATEGORIES);
        cache.del(CACHE_KEYS.BRANDS);
    }
};

// @desc    Get all products (with pagination, search, filter)
// @route   GET /api/products
// @access  Public
exports.getAllProducts = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
        const skip = (page - 1) * limit;
        const filter = buildProductFilter(req.query);
        const sort = getSortOption(req.query.sortBy);
        const pipeline = [
            { $match: filter },
            { $sort: sort },
            { $skip: skip },
            { $limit: limit },
            {
                $project: {
                    name: 1,
                    brand: 1,
                    category: 1,
                    description: 1,
                    price: 1,
                    salePrice: 1,
                    saleEndDate: 1,
                    image: 1,
                    rating: 1,
                    numReviews: 1,
                    countInStock: 1,
                    viewCount: 1,
                    createdAt: 1,
                    effectivePrice: {
                        $cond: {
                            if: {
                                $and: [
                                    { $exists: ["$salePrice", true] },
                                    { $gt: ["$saleEndDate", new Date()] }
                                ]
                            },
                            then: "$salePrice",
                            else: "$price"
                        }
                    },
                    isOnSale: {
                        $and: [
                            { $exists: ["$salePrice", true] },
                            { $gt: ["$saleEndDate", new Date()] }
                        ]
                    }
                }
            }
        ];

        const [products, totalResult] = await Promise.all([
            Product.aggregate(pipeline),
            Product.aggregate([
                { $match: filter },
                { $count: "total" }
            ])
        ]);
        const total = totalResult[0]?.total || 0;
        setImmediate(() => updateExpiredSales(products));
        const response = {
            success: true,
            data: {
                products,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit),
                    hasNext: page < Math.ceil(total / limit),
                    hasPrev: page > 1
                }
            },
            filters: {
                keyword: req.query.keyword || '',
                category: req.query.category || '',
                brand: req.query.brand || '',
                minPrice: req.query.minPrice || 0,
                maxPrice: req.query.maxPrice || null,
                minRating: req.query.minRating || 0,
                inStock: req.query.inStock === 'true',
                onSale: req.query.onSale === 'true',
                sortBy: req.query.sortBy || 'newest'
            }
        };

        res.json(response);
        await createLog({
            type: req.user?.isAdmin ? 'ADMIN' : 'USER',
            actorId: req.user?._id || null,
            action: 'GET_ALL_PRODUCTS',
            targetType: 'PRODUCT_LIST',
            details: {
                filters: response.filters,
                resultCount: products.length,
                totalCount: total
            },
            statusCode: 200,
            ip: req.ip
        });

    } catch (err) {
        console.error('Get all products error:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch products',
            error: process.env.NODE_ENV !== 'production' ? err.message : undefined
        });
    }
};


// Enhanced search with faceted filtering
exports.advancedProductSearch = async (req, res) => {
    try {
        const {
            keyword,
            categories,
            brands,
            priceRange,
            ratings,
            features,
            sortBy,
            availability
        } = req.query;

        const pipeline = [
            {
                $match: buildAdvancedFilter({
                    keyword,
                    categories: categories?.split(','),
                    brands: brands?.split(','),
                    priceRange: priceRange ? JSON.parse(priceRange) : null,
                    minRating: ratings,
                    features: features?.split(','),
                    availability
                })
            },
            {
                $facet: {
                    products: [
                        { $sort: getSortOption(sortBy) },
                        { $skip: skip },
                        { $limit: limit }
                    ],
                    facets: [
                        {
                            $group: {
                                _id: null,
                                categories: { $addToSet: "$category" },
                                brands: { $addToSet: "$brand" },
                                priceRange: {
                                    $push: {
                                        min: { $min: "$price" },
                                        max: { $max: "$price" }
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        ];

        const [result] = await Product.aggregate(pipeline);
        res.json({
            success: true,
            data: result.products,
            facets: result.facets[0],
            filters: req.query
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Search failed' });
    }
};

// @desc    Get single product by ID
// @route   GET /api/products/:id
// @access  Public
exports.getProductById = async (req, res) => {
    try {
        validateObjectId(req.params.id);
        const cacheKey = `product_${req.params.id}`;
        let product = cache.get(cacheKey);
        if (!product) {
            product = await Product.findById(req.params.id)
                .populate({
                    path: 'reviews.user',
                    select: 'name',
                    match: { 'reviews.isHidden': { $ne: true } }
                })
                .populate({
                    path: 'questions.user questions.answeredBy',
                    select: 'name'
                });

            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: 'Product not found'
                });
            }
            cache.set(cacheKey, product, CACHE_TTL.PRODUCT);
        }
        if (product.saleEndDate && product.saleEndDate < new Date() && product.salePrice) {
            product.salePrice = undefined;
            product.saleEndDate = undefined;
            await product.save();
            cache.del(cacheKey);
        }
        setImmediate(async () => {
            try {
                await Product.findByIdAndUpdate(
                    req.params.id,
                    { $inc: { viewCount: 1 } },
                    { new: true }
                );
                cache.del(cacheKey);
            } catch (viewErr) {
                console.error('Failed to increment view count:', viewErr);
            }
        });
        if (!req.user?.isAdmin && product.reviews) {
            product.reviews = product.reviews.filter(review => !review.isHidden);
        }
        const response = {
            success: true,
            data: product
        };
        res.json(response);
        await createLog({
            type: req.user?.isAdmin ? 'ADMIN' : 'USER',
            actorId: req.user?._id || null,
            action: 'GET_PRODUCT_BY_ID',
            targetType: 'PRODUCT',
            targetId: product._id,
            details: {
                productName: product.name,
                category: product.category,
                viewCount: product.viewCount
            },
            statusCode: 200,
            ip: req.ip
        });
    } catch (err) {
        console.error('Get product by ID error:', err);
        if (err.message === 'Invalid ID format') {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID format'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Error fetching product',
            error: process.env.NODE_ENV !== 'production' ? err.message : undefined
        });
    }
};

// @desc    Create new product
// @route   POST /api/products
// @access  Private/Admin
exports.createProduct = async (req, res) => {
    try {
        const { error, value } = productValidationSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                details: error.details.map(d => d.message)
            });
        }
        const existingProduct = await Product.findOne({
            name: { $regex: new RegExp(`^${value.name}$`, 'i') }
        });
        if (existingProduct) {
            return res.status(409).json({
                success: false,
                message: 'Product with this name already exists'
            });
        }
        const product = new Product(value);
        const savedProduct = await product.save();
        cache.del(CACHE_KEYS.CATEGORIES);
        cache.del(CACHE_KEYS.BRANDS);
        const response = {
            success: true,
            message: 'Product created successfully',
            data: savedProduct
        };
        res.status(201).json(response);
        await createLog({
            type: 'ADMIN',
            actorId: req.user._id,
            action: 'CREATE_PRODUCT',
            targetType: 'PRODUCT',
            targetId: savedProduct._id,
            details: {
                productName: savedProduct.name,
                category: savedProduct.category,
                price: savedProduct.price
            },
            statusCode: 201,
            ip: req.ip
        });
    } catch (err) {
        console.error('Create product error:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to create product',
            error: process.env.NODE_ENV !== 'production' ? err.message : undefined
        });
    }
};

// @desc    Update existing product
// @route   PUT /api/products/:id
// @access  Private/Admin
exports.updateProduct = async (req, res) => {
    try {
        validateObjectId(req.params.id);
        const { error, value } = productValidationSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                details: error.details.map(d => d.message)
            });
        }
        const existingProduct = await Product.findById(req.params.id);
        if (!existingProduct) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        if (value.name !== existingProduct.name) {
            const duplicateProduct = await Product.findOne({
                name: { $regex: new RegExp(`^${value.name}$`, 'i') },
                _id: { $ne: req.params.id }
            });
            if (duplicateProduct) {
                return res.status(409).json({
                    success: false,
                    message: 'Product with this name already exists'
                });
            }
        }
        const updatedProduct = await Product.findByIdAndUpdate(
            req.params.id,
            value,
            { new: true, runValidators: true }
        );
        cache.del(`product_${req.params.id}`);
        cache.del(CACHE_KEYS.CATEGORIES);
        cache.del(CACHE_KEYS.BRANDS);
        const response = {
            success: true,
            message: 'Product updated successfully',
            data: updatedProduct
        };
        res.json(response);
        await createLog({
            type: 'ADMIN',
            actorId: req.user._id,
            action: 'UPDATE_PRODUCT',
            targetType: 'PRODUCT',
            targetId: updatedProduct._id,
            details: {
                productName: updatedProduct.name,
                changes: value
            },
            statusCode: 200,
            ip: req.ip
        });

    } catch (err) {
        console.error('Update product error:', err);
        if (err.message === 'Invalid ID format') {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID format'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Update failed',
            error: process.env.NODE_ENV !== 'production' ? err.message : undefined
        });
    }
};

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private/Admin
exports.deleteProduct = async (req, res) => {
    try {
        validateObjectId(req.params.id);
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        await Product.findByIdAndDelete(req.params.id);
        cache.del(`product_${req.params.id}`);
        cache.del(CACHE_KEYS.CATEGORIES);
        cache.del(CACHE_KEYS.BRANDS);
        const response = {
            success: true,
            message: 'Product deleted successfully'
        };
        res.json(response);
        await createLog({
            type: 'ADMIN',
            actorId: req.user._id,
            action: 'DELETE_PRODUCT',
            targetType: 'PRODUCT',
            targetId: product._id,
            details: {
                productName: product.name,
                category: product.category
            },
            statusCode: 200,
            ip: req.ip
        });
    } catch (err) {
        console.error('Delete product error:', err);
        if (err.message === 'Invalid ID format') {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID format'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Delete failed',
            error: process.env.NODE_ENV !== 'production' ? err.message : undefined
        });
    }
};

// @desc    Get all unique product categories
// @route   GET /api/products/categories
// @access  Public
exports.getCategories = async (req, res) => {
    try {
        let categories = cache.get(CACHE_KEYS.CATEGORIES);
        if (!categories) {
            categories = await Product.distinct('category');
            cache.set(CACHE_KEYS.CATEGORIES, categories, CACHE_TTL.CATEGORIES);
        }
        res.json({
            success: true,
            data: categories.sort()
        });
    } catch (err) {
        console.error('Get categories error:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch categories',
            error: process.env.NODE_ENV !== 'production' ? err.message : undefined
        });
    }
};

// @desc    Get all unique product brands
// @route   GET /api/products/brands
// @access  Public
exports.getBrands = async (req, res) => {
    try {
        let brands = cache.get(CACHE_KEYS.BRANDS);
        if (!brands) {
            brands = await Product.distinct('brand');
            cache.set(CACHE_KEYS.BRANDS, brands, CACHE_TTL.BRANDS);
        }
        res.json({
            success: true,
            data: brands.sort()
        });
    } catch (err) {
        console.error('Get brands error:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch brands',
            error: process.env.NODE_ENV !== 'production' ? err.message : undefined
        });
    }
};

// @desc    Add product review
// @route   POST /api/products/:id/reviews
// @access  Private
exports.addProductReview = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            validateObjectId(req.params.id);
            const { error, value } = reviewValidationSchema.validate(req.body);
            if (error) {
                const validationError = new Error('Validation error');
                validationError.statusCode = 400;
                validationError.details = error.details.map(d => d.message);
                throw validationError;
            }
            const product = await Product.findById(req.params.id).session(session);
            if (!product) {
                const notFoundError = new Error('Product not found');
                notFoundError.statusCode = 404;
                throw notFoundError;
            }
            const alreadyReviewed = product.reviews.find(
                r => r.user.toString() === req.user._id.toString()
            );
            if (alreadyReviewed) {
                const duplicateError = new Error('You have already reviewed this product');
                duplicateError.statusCode = 409;
                throw duplicateError;
            }
            const review = {
                user: req.user._id,
                name: req.user.name,
                rating: value.rating,
                comment: value.comment
            };
            product.reviews.push(review);
            product.numReviews = product.reviews.length;
            product.rating = product.reviews.reduce((acc, item) => item.rating + acc, 0) / product.reviews.length;
            await product.save({ session });
            cache.del(`product_${req.params.id}`);
        });
        const response = {
            success: true,
            message: 'Review added successfully'
        };
        res.status(201).json(response);
        await createLog({
            type: 'USER',
            actorId: req.user._id,
            action: 'ADD_PRODUCT_REVIEW',
            targetType: 'PRODUCT',
            targetId: req.params.id,
            details: {
                rating: req.body.rating,
                comment: req.body.comment?.substring(0, 100) + (req.body.comment?.length > 100 ? '...' : '')
            },
            statusCode: 201,
            ip: req.ip
        });

    } catch (err) {
        console.error('Add review error:', err);
        const statusCode = err.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: err.message || 'Failed to add review',
            details: err.details || undefined,
            error: process.env.NODE_ENV !== 'production' ? err.message : undefined
        });
    } finally {
        await session.endSession();
    }
};

// @desc    Get related products by category
// @route   GET /api/products/:id/related
// @access  Public
exports.getRelatedProducts = async (req, res) => {
    try {
        validateObjectId(req.params.id);
        const product = await Product.findById(req.params.id, 'category');
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        const related = await Product.find({
            category: product.category,
            _id: { $ne: product._id },
            countInStock: { $gt: 0 }
        })
            .select('name brand price salePrice saleEndDate image rating numReviews countInStock')
            .sort({ rating: -1, viewCount: -1 })
            .limit(8);

        res.json({
            success: true,
            data: related
        });

    } catch (err) {
        console.error('Get related products error:', err);

        if (err.message === 'Invalid ID format') {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID format'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Failed to fetch related products',
            error: process.env.NODE_ENV !== 'production' ? err.message : undefined
        });
    }
};

// @desc    Get trending products (most viewed in last 7 days)
// @route   GET /api/products/trending
// @access  Public
exports.getTrendingProducts = async (req, res) => {
    try {
        let products = cache.get(CACHE_KEYS.TRENDING);

        if (!products) {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            products = await Product.find({
                updatedAt: { $gte: sevenDaysAgo },
                countInStock: { $gt: 0 }
            })
                .select('name brand price salePrice saleEndDate image rating numReviews viewCount countInStock')
                .sort({ viewCount: -1 })
                .limit(10);

            cache.set(CACHE_KEYS.TRENDING, products, CACHE_TTL.TRENDING);
        }
        res.json({
            success: true,
            data: products
        });
    } catch (err) {
        console.error('Get trending products error:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch trending products',
            error: process.env.NODE_ENV !== 'production' ? err.message : undefined
        });
    }
};

// @desc    Bulk import products (CSV/JSON array in body)
// @route   POST /api/products/bulk
// @access  Private/Admin
exports.bulkImportProducts = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            // Validate input
            const { error, value } = bulkImportValidationSchema.validate(req.body);
            if (error) {
                const validationError = new Error('Validation error');
                validationError.statusCode = 400;
                validationError.details = error.details.map(d => d.message);
                throw validationError;
            }
            const products = value.products;
            const productNames = products.map(p => p.name.toLowerCase());
            const duplicatesInImport = productNames.filter((name, index) =>
                productNames.indexOf(name) !== index
            );
            if (duplicatesInImport.length > 0) {
                const duplicateError = new Error('Duplicate product names in import');
                duplicateError.statusCode = 400;
                duplicateError.details = duplicatesInImport;
                throw duplicateError;
            }
            const existingProducts = await Product.find({
                name: { $in: productNames }
            }, 'name').session(session);
            if (existingProducts.length > 0) {
                const existingError = new Error('Some products already exist');
                existingError.statusCode = 409;
                existingError.details = existingProducts.map(p => p.name);
                throw existingError;
            }
            const insertedProducts = await Product.insertMany(products, { session });
            cache.del(CACHE_KEYS.CATEGORIES);
            cache.del(CACHE_KEYS.BRANDS);
            return insertedProducts;
        });
        const response = {
            success: true,
            message: `${req.body.products.length} products imported successfully`
        };
        res.status(201).json(response);
        await createLog({
            type: 'ADMIN',
            actorId: req.user._id,
            action: 'BULK_IMPORT_PRODUCTS',
            targetType: 'PRODUCT_BULK',
            details: {
                importCount: req.body.products.length,
                categories: [...new Set(req.body.products.map(p => p.category))]
            },
            statusCode: 201,
            ip: req.ip
        });

    } catch (err) {
        console.error('Bulk import error:', err);
        const statusCode = err.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: err.message || 'Bulk import failed',
            details: err.details || undefined,
            error: process.env.NODE_ENV !== 'production' ? err.message : undefined
        });
    } finally {
        await session.endSession();
    }
};

// @desc Add or remove product from wishlist
// @route POST /api/products/:id/wishlist
// @access Private
exports.toggleWishlist = async (req, res) => {
    try {
        validateObjectId(req.params.id);
        const user = await User.findById(req.user._id);
        const productId = req.params.id;
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        const index = user.wishlist.indexOf(productId);
        if (index === -1) {
            user.wishlist.push(productId);
            await user.save();
            return res.json({ success: true, message: 'Added to wishlist' });
        } else {
            user.wishlist.splice(index, 1);
            await user.save();
            return res.json({ success: true, message: 'Removed from wishlist' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update wishlist' });
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




exports.compareProducts = async (req, res) => {
    try {
        const ids = (req.query.ids || '').split(',').filter(id => mongoose.Types.ObjectId.isValid(id));
        if (ids.length < 2) {
            return res.status(400).json({ success: false, message: 'At least two valid product IDs required' });
        }

        const products = await Product.find({ _id: { $in: ids } })
            .select('name brand category price salePrice image rating numReviews countInStock description');

        if (products.length < 2) {
            return res.status(404).json({ success: false, message: 'Not enough products found' });
        }

        res.json({ success: true, data: products });
    } catch (err) {
        console.error('Compare products error:', err);
        res.status(500).json({ success: false, message: 'Failed to compare products' });
    }
};


exports.getSearchSuggestions = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) {
            return res.json({ success: true, data: [] });
        }

        const suggestions = await Product.aggregate([
            {
                $match: {
                    $or: [
                        { name: { $regex: q, $options: 'i' } },
                        { brand: { $regex: q, $options: 'i' } },
                        { category: { $regex: q, $options: 'i' } }
                    ]
                }
            },
            {
                $group: {
                    _id: null,
                    names: { $addToSet: "$name" },
                    brands: { $addToSet: "$brand" },
                    categories: { $addToSet: "$category" }
                }
            },
            {
                $project: {
                    suggestions: {
                        $slice: [
                            { $setUnion: ["$names", "$brands", "$categories"] },
                            10
                        ]
                    }
                }
            }
        ]);

        res.json({
            success: true,
            data: suggestions[0]?.suggestions || []
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get suggestions' });
    }
};

exports.trackUserBehavior = async (req, res) => {
    try {
        const { action, productId, categoryId, searchQuery, duration } = req.body;
        
        const behaviorLog = new UserBehavior({
            user: req.user?._id,
            sessionId: req.sessionID,
            action,
            productId,
            categoryId,
            searchQuery,
            duration,
            timestamp: new Date(),
            userAgent: req.headers['user-agent'],
            ip: req.ip
        });

        await behaviorLog.save();
        res.json({ success: true, message: 'Behavior tracked' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Tracking failed' });
    }
};

exports.getPersonalizedRecommendations = async (req, res) => {
    try {
        const userId = req.user._id;
        
        // Get user's order history
        const userOrders = await Order.find({ user: userId })
            .populate('orderItems.product');
        
        // Extract categories and brands user has purchased
        const userPreferences = extractUserPreferences(userOrders);
        
        // Collaborative filtering - find similar users
        const similarUsers = await findSimilarUsers(userId, userPreferences);
        
        // Content-based recommendations
        const recommendations = await Product.aggregate([
            {
                $match: {
                    $or: [
                        { category: { $in: userPreferences.categories } },
                        { brand: { $in: userPreferences.brands } }
                    ],
                    countInStock: { $gt: 0 }
                }
            },
            {
                $addFields: {
                    score: calculateRecommendationScore(userPreferences)
                }
            },
            { $sort: { score: -1, rating: -1 } },
            { $limit: 20 }
        ]);

        res.json({ success: true, data: recommendations });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Recommendations failed' });
    }
};


exports.addToRecentlyViewed = async (req, res) => {
    try {
        const { productId } = req.params;
        const userId = req.user._id;

        await User.findByIdAndUpdate(userId, {
            $pull: { recentlyViewed: productId },
        });

        await User.findByIdAndUpdate(userId, {
            $push: {
                recentlyViewed: {
                    $each: [productId],
                    $position: 0,
                    $slice: 20 // Keep only last 20 items
                }
            }
        });

        res.json({ success: true, message: 'Added to recently viewed' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to track view' });
    }
};

exports.getRecentlyViewed = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate({
                path: 'recentlyViewed',
                select: 'name price salePrice image rating numReviews countInStock'
            });

        res.json({ success: true, data: user.recentlyViewed });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get recently viewed' });
    }
};


exports.updateDynamicPricing = async (req, res) => {
    try {
        const products = await Product.find({ isDynamicPricing: true });
        
        for (const product of products) {
            const newPrice = await calculateDynamicPrice(product);
            
            if (newPrice !== product.price) {
                product.priceHistory.push({
                    price: product.price,
                    changedAt: new Date(),
                    reason: 'Dynamic pricing adjustment'
                });
                
                product.price = newPrice;
                await product.save();
            }
        }

        res.json({ success: true, message: 'Dynamic pricing updated' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Pricing update failed' });
    }
};

exports.getInventoryAlerts = async (req, res) => {
    try {
        const alerts = await Product.aggregate([
            {
                $match: {
                    $or: [
                        { countInStock: { $lte: '$lowStockThreshold' } },
                        { countInStock: 0 },
                        { 
                            $expr: {
                                $gte: [
                                    { $subtract: [new Date(), '$lastRestocked'] },
                                    1000 * 60 * 60 * 24 * 30 // 30 days
                                ]
                            }
                        }
                    ]
                }
            },
            {
                $addFields: {
                    alertType: {
                        $cond: [
                            { $eq: ['$countInStock', 0] },
                            'OUT_OF_STOCK',
                            {
                                $cond: [
                                    { $lte: ['$countInStock', '$lowStockThreshold'] },
                                    'LOW_STOCK',
                                    'RESTOCK_NEEDED'
                                ]
                            }
                        ]
                    }
                }
            },
            { $sort: { alertType: 1, countInStock: 1 } }
        ]);

        res.json({ success: true, data: alerts });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get inventory alerts' });
    }
};

exports.reserveStock = async (req, res) => {
    const session = await mongoose.startSession();
    
    try {
        await session.withTransaction(async () => {
            const { items } = req.body; // [{ productId, quantity }]
            const reservationId = new mongoose.Types.ObjectId();
            
            for (const item of items) {
                const product = await Product.findById(item.productId).session(session);
                
                if (product.countInStock < item.quantity) {
                    throw new Error(`Insufficient stock for ${product.name}`);
                }
                
                // Create stock reservation
                await StockReservation.create([{
                    product: item.productId,
                    quantity: item.quantity,
                    user: req.user._id,
                    reservationId,
                    expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
                }], { session });
                
                // Reduce available stock
                await Product.findByIdAndUpdate(
                    item.productId,
                    { $inc: { reservedStock: item.quantity } },
                    { session }
                );
            }
            
            res.json({
                success: true,
                data: { reservationId, expiresAt: new Date(Date.now() + 15 * 60 * 1000) }
            });
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    } finally {
        await session.endSession();
    }
};

// Save for later functionality
exports.moveToSaveForLater = async (req, res) => {
    try {
        const { productId } = req.params;
        const user = await User.findById(req.user._id);
        
        // Remove from cart
        user.cart = user.cart.filter(item => 
            item.product.toString() !== productId
        );
        
        // Add to saved items
        const existingSaved = user.savedForLater.find(item => 
            item.product.toString() === productId
        );
        
        if (!existingSaved) {
            user.savedForLater.push({
                product: productId,
                savedAt: new Date()
            });
        }
        
        await user.save();
        res.json({ success: true, message: 'Item moved to saved for later' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to save item' });
    }
};

// Cart abandonment recovery
exports.getAbandonedCart = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate('cart.product', 'name price salePrice image countInStock');
        
        // Check if cart has items and hasn't been active for 24 hours
        const lastActivity = user.lastCartActivity || new Date(0);
        const hoursSinceActivity = (new Date() - lastActivity) / (1000 * 60 * 60);
        
        if (user.cart.length > 0 && hoursSinceActivity > 24) {
            // Send recovery email or notification
            await sendCartRecoveryEmail(user);
        }
        
        res.json({ success: true, data: user.cart });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get cart' });
    }
};

// Smart cart recommendations
exports.getCartRecommendations = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate('cart.product');
        const cartCategories = [...new Set(user.cart.map(item => item.product.category))];
        
        const recommendations = await Product.find({
            category: { $in: cartCategories },
            _id: { $nin: user.cart.map(item => item.product._id) },
            countInStock: { $gt: 0 }
        })
        .sort({ rating: -1, viewCount: -1 })
        .limit(6)
        .select('name price salePrice image rating numReviews');
        
        res.json({ success: true, data: recommendations });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get recommendations' });
    }
};

exports.setPriceAlert = async (req, res) => {
    try {
        const { productId, targetPrice } = req.body;
        
        const priceAlert = new PriceAlert({
            user: req.user._id,
            product: productId,
            targetPrice,
            isActive: true,
            createdAt: new Date()
        });
        
        await priceAlert.save();
        res.json({ success: true, message: 'Price alert set successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to set price alert' });
    }
};

// User preferences management
exports.updateUserPreferences = async (req, res) => {
    try {
        const {
            emailNotifications,
            pushNotifications,
            preferredCategories,
            priceRange,
            brands,
            currency,
            language
        } = req.body;
        
        await User.findByIdAndUpdate(req.user._id, {
            preferences: {
                emailNotifications,
                pushNotifications,
                preferredCategories,
                priceRange,
                brands,
                currency,
                language
            }
        });
        
        res.json({ success: true, message: 'Preferences updated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update preferences' });
    }
};

// Personalized homepage
exports.getPersonalizedHomepage = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const preferences = user.preferences || {};
        
        const sections = await Promise.all([
            // Recent orders continuation
            getReorderSuggestions(req.user._id),
            
            // Recommended for you
            getPersonalizedRecommendations(req.user._id, preferences),
            
            // Trending in your categories
            getTrendingInCategories(preferences.preferredCategories),
            
            // Price drops on wishlist items
            getWishlistPriceDrops(req.user._id),
            
            // New arrivals in preferred categories
            getNewArrivals(preferences.preferredCategories),
            
            // Recently viewed similar items
            getSimilarToRecentlyViewed(req.user._id)
        ]);
        
        res.json({
            success: true,
            data: {
                reorderSuggestions: sections[0],
                recommendations: sections[1],
                trending: sections[2],
                priceDrops: sections[3],
                newArrivals: sections[4],
                similarItems: sections[5]
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to load homepage' });
    }
};

// User dashboard with insights
exports.getUserDashboard = async (req, res) => {
    try {
        const userId = req.user._id;
        
        const [
            orderStats,
            wishlistStats,
            savingsStats,
            recentActivity
        ] = await Promise.all([
            getOrderStatistics(userId),
            getWishlistStatistics(userId),
            getSavingsStatistics(userId),
            getRecentUserActivity(userId)
        ]);
        
        res.json({
            success: true,
            data: {
                orderStats,
                wishlistStats,
                savingsStats,
                recentActivity
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to load dashboard' });
    }
};

// Follow other users
exports.followUser = async (req, res) => {
    try {
        const { userIdToFollow } = req.params;
        const currentUser = await User.findById(req.user._id);
        
        if (!currentUser.following.includes(userIdToFollow)) {
            currentUser.following.push(userIdToFollow);
            await currentUser.save();
            
            // Add to follower's followers list
            await User.findByIdAndUpdate(userIdToFollow, {
                $push: { followers: req.user._id }
            });
        }
        
        res.json({ success: true, message: 'User followed successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to follow user' });
    }
};

// Activity feed
exports.getActivityFeed = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate('following');
        
        const activities = await UserActivity.find({
            user: { $in: [...user.following, req.user._id] },
            type: { $in: ['purchase', 'review', 'wishlist_add'] }
        })
        .populate('user', 'name avatar')
        .populate('product', 'name image price')
        .sort({ createdAt: -1 })
        .limit(50);
        
        res.json({ success: true, data: activities });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get activity feed' });
    }
};

// Public user profile
exports.getUserProfile = async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId)
            .select('name avatar bio joinedAt')
            .populate({
                path: 'publicWishlists',
                populate: { path: 'products', select: 'name image price rating' }
            });
        
        const recentReviews = await Product.find({
            'reviews.user': userId,
            'reviews.isHidden': false
        })
        .select('name image reviews.$')
        .limit(10);
        
        res.json({
            success: true,
            data: {
                user,
                recentReviews,
                stats: {
                    totalReviews: recentReviews.length,
                    followers: user.followers?.length || 0,
                    following: user.following?.length || 0
                }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get user profile' });
    }
};


// Image search functionality
exports.searchByImage = async (req, res) => {
    try {
        const imageFile = req.file;
        if (!imageFile) {
            return res.status(400).json({ success: false, message: 'Image required' });
        }
        
        // Process image with AI service (Google Vision API, AWS Rekognition, etc.)
        const imageLabels = await analyzeImageForProducts(imageFile);
        
        // Search products based on image labels
        const products = await Product.find({
            $or: [
                { name: { $in: imageLabels.map(label => new RegExp(label, 'i')) } },
                { category: { $in: imageLabels } },
                { tags: { $in: imageLabels } }
            ]
        })
        .limit(20)
        .sort({ rating: -1 });
        
        res.json({ 
            success: true, 
            data: products,
            detectedLabels: imageLabels
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Image search failed' });
    }
};

// Voice search
exports.voiceSearch = async (req, res) => {
    try {
        const { transcript, confidence } = req.body;
        
        if (confidence < 0.7) {
            return res.status(400).json({
                success: false,
                message: 'Voice recognition confidence too low'
            });
        }
        
        // Process natural language query
        const searchIntent = await processNaturalLanguageQuery(transcript);
        
        const products = await Product.find(buildQueryFromIntent(searchIntent))
            .sort(getSortFromIntent(searchIntent))
            .limit(20);
            
        res.json({
            success: true,
            data: products,
            recognizedQuery: transcript,
            intent: searchIntent
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Voice search failed' });
    }
};

// Smart filters based on user behavior
exports.getSmartFilters = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const userBehavior = await getUserBehaviorData(req.user._id);
        
        const smartFilters = {
            recommendedPriceRange: calculateRecommendedPriceRange(userBehavior),
            preferredBrands: getTopBrandsFromHistory(userBehavior),
            suggestedCategories: getRecommendedCategories(userBehavior),
            popularFilters: await getPopularFiltersForUser(user)
        };
        
        res.json({ success: true, data: smartFilters });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get smart filters' });
    }
};

// Review with media uploads
exports.addReviewWithMedia = async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const files = req.files;
        
        const mediaUrls = [];
        if (files && files.length > 0) {
            for (const file of files) {
                const mediaUrl = await uploadMedia(file);
                mediaUrls.push(mediaUrl);
            }
        }
        
        const product = await Product.findById(req.params.id);
        
        const review = {
            user: req.user._id,
            name: req.user.name,
            rating,
            comment,
            media: mediaUrls,
            verifiedPurchase: await isVerifiedPurchase(req.user._id, req.params.id)
        };
        
        product.reviews.push(review);
        await product.save();
        
        res.status(201).json({ success: true, message: 'Review added successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to add review' });
    }
};

// Review interactions (like/dislike)
exports.interactWithReview = async (req, res) => {
    try {
        const { productId, reviewId } = req.params;
        const { action } = req.body; // 'like', 'dislike', 'report'
        
        const product = await Product.findById(productId);
        const review = product.reviews.id(reviewId);
        
        if (!review) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }
        
        switch (action) {
            case 'like':
                if (!review.likes.includes(req.user._id)) {
                    review.likes.push(req.user._id);
                    review.dislikes.pull(req.user._id);
                }
                break;
            case 'dislike':
                if (!review.dislikes.includes(req.user._id)) {
                    review.dislikes.push(req.user._id);
                    review.likes.pull(req.user._id);
                }
                break;
            case 'report':
                review.reports.push({
                    user: req.user._id,
                    reason: req.body.reason,
                    timestamp: new Date()
                });
                break;
        }
        
        await product.save();
        res.json({ success: true, message: `Review ${action}d successfully` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to interact with review' });
    }
};

// Follow reviewers
exports.followReviewer = async (req, res) => {
    try {
        const { reviewerId } = req.params;
        
        await User.findByIdAndUpdate(req.user._id, {
            $addToSet: { followingReviewers: reviewerId }
        });
        
        res.json({ success: true, message: 'Now following reviewer' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to follow reviewer' });
    }
};

exports.dailyCheckIn = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const today = new Date().toDateString();
        
        if (user.lastCheckIn === today) {
            return res.status(400).json({
                success: false,
                message: 'Already checked in today'
            });
        }
        
        const points = calculateCheckInPoints(user.consecutiveCheckIns);
        user.loyaltyPoints += points;
        user.lastCheckIn = today;
        user.consecutiveCheckIns += 1;
        
        await user.save();
        
        res.json({
            success: true,
            message: `Check-in successful! Earned ${points} points`,
            data: { pointsEarned: points, consecutiveDays: user.consecutiveCheckIns }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Check-in failed' });
    }
};


// User achievements
exports.getUserAchievements = async (req, res) => {
    try {
        const userAchievements = await UserAchievement.find({ user: req.user._id })
            .populate('achievement');
        
        const availableAchievements = await Achievement.find({
            _id: { $nin: userAchievements.map(ua => ua.achievement._id) }
        });
        
        res.json({
            success: true,
            data: {
                earned: userAchievements,
                available: availableAchievements,
                progress: await calculateAchievementProgress(req.user._id)
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get achievements' });
    }
};

// Referral system
exports.generateReferralCode = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        
        if (!user.referralCode) {
            user.referralCode = generateUniqueReferralCode();
            await user.save();
        }
        
        const referralStats = await getReferralStats(req.user._id);
        
        res.json({
            success: true,
            data: {
                referralCode: user.referralCode,
                referralLink: `${process.env.FRONTEND_URL}/register?ref=${user.referralCode}`,
                stats: referralStats
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to generate referral code' });
    }
};

// Push notifications
exports.subscribeToPushNotifications = async (req, res) => {
    try {
        const { subscription } = req.body;
        
        await User.findByIdAndUpdate(req.user._id, {
            pushSubscription: subscription,
            pushNotificationsEnabled: true
        });
        
        res.json({ success: true, message: 'Push notifications enabled' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to subscribe to notifications' });
    }
};

// Offline cart sync
exports.syncOfflineCart = async (req, res) => {
    try {
        const { offlineCart, timestamp } = req.body;
        const user = await User.findById(req.user._id);
        
        // Merge offline cart with server cart
        const mergedCart = mergeCartData(user.cart, offlineCart, timestamp);
        
        user.cart = mergedCart;
        user.lastCartSync = new Date();
        await user.save();
        
        res.json({ 
            success: true, 
            data: user.cart,
            message: 'Cart synchronized successfully'
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Cart sync failed' });
    }
};

// Location-based features
exports.getNearbyStores = async (req, res) => {
    try {
        const { latitude, longitude, radius = 10 } = req.query;
        
        const stores = await Store.find({
            location: {
                $near: {
                    $geometry: { type: "Point", coordinates: [longitude, latitude] },
                    $maxDistance: radius * 1000 // Convert km to meters
                }
            },
            isActive: true
        });
        
        res.json({ success: true, data: stores });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to find nearby stores' });
    }
};


// Personalized notification preferences
exports.updateNotificationPreferences = async (req, res) => {
    try {
        const preferences = req.body;
        
        await User.findByIdAndUpdate(req.user._id, {
            notificationPreferences: {
                priceDrops: preferences.priceDrops || false,
                backInStock: preferences.backInStock || false,
                orderUpdates: preferences.orderUpdates || true,
                promotions: preferences.promotions || false,
                reviews: preferences.reviews || false,
                socialActivity: preferences.socialActivity || false
            }
        });
        
        res.json({ success: true, message: 'Notification preferences updated' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update preferences' });
    }
};

// Smart notification timing
exports.getOptimalNotificationTimes = async (req, res) => {
    try {
        const userActivity = await analyzeUserActivityPatterns(req.user._id);
        const optimalTimes = calculateOptimalNotificationTimes(userActivity);
        
        res.json({ success: true, data: optimalTimes });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to calculate optimal times' });
    }
};