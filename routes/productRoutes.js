const express = require('express');
const router = express.Router();

const {
    getAllProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    getCategories,
    getBrands,
    toggleWishlist,
    askQuestion, getTrendingProducts, voteReview, reportReview, setFlashSale, answerQuestion, moderateReview
} = require('../controllers/productController');

const { protect, adminOnly } = require('../middleware/authMiddleware');

// Public
router.get('/', getAllProducts);
router.get('/:id', getProductById);
router.get('/categories/all', getCategories);
router.get('/brands/all', getBrands);
router.post('/:id/wishlist', protect, toggleWishlist);
router.post('/:id/questions', protect, askQuestion);
router.get('/trending', getTrendingProducts);
router.post('/:productId/reviews/:reviewId/vote', protect, voteReview);
router.put('/:productId/reviews/:reviewId/report', protect, reportReview);

// Admin only
router.post('/', protect, adminOnly, createProduct);
router.put('/:id', protect, adminOnly, updateProduct);
router.delete('/:id', protect, adminOnly, deleteProduct);
router.put('/:id/sale', protect, adminOnly, setFlashSale);
router.put('/:id/questions/:qid', protect, adminOnly, answerQuestion);
router.put('/:productId/reviews/:reviewId/moderate', protect, adminOnly, moderateReview);



module.exports = router;
