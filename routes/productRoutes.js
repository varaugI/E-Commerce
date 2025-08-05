const express = require('express');
const router = express.Router();

const {
    getAllProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    getCategories,
    getBrands
} = require('../controllers/productController');

const { protect, adminOnly } = require('../middleware/authMiddleware');

// Public
router.get('/', getAllProducts);
router.get('/:id', getProductById);
router.get('/categories/all', getCategories);
router.get('/brands/all', getBrands);


// Admin only
router.post('/', protect, adminOnly, createProduct);
router.put('/:id', protect, adminOnly, updateProduct);
router.delete('/:id', protect, adminOnly, deleteProduct);

module.exports = router;
