const express = require('express');
const router = express.Router();
const multer = require('multer');


const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image and video files are allowed'), false);
        }
    }
});

const {
    getAllProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    getCategories,
    getBrands,
    addProductReview,
    getRelatedProducts,
    getTrendingProducts,
    bulkImportProducts,
    toggleWishlist,
    askQuestion,
    answerQuestion,
    setFlashSale,
    reportReview,
    moderateReview,
    voteReview,
    compareProducts,
    getSearchSuggestions,
    trackUserBehavior,
    getPersonalizedRecommendations,
    addToRecentlyViewed,
    getRecentlyViewed,
    updateDynamicPricing,
    getInventoryAlerts,
    reserveStock,
    moveToSaveForLater,
    getAbandonedCart,
    getCartRecommendations,
    setPriceAlert,
    updateUserPreferences,
    getPersonalizedHomepage,
    getUserDashboard,
    followUser,
    getActivityFeed,
    getUserProfile,
    searchByImage,
    voiceSearch,
    getSmartFilters,
    addReviewWithMedia,
    interactWithReview,
    followReviewer,
    dailyCheckIn,
    getUserAchievements,
    generateReferralCode,
    subscribeToPushNotifications,
    syncOfflineCart,
    getNearbyStores,
    updateNotificationPreferences,
    getOptimalNotificationTimes,
    advancedProductSearch
} = require('../controllers/productController');

const { protect, adminOnly } = require('../middleware/authMiddleware');


router.get('/', getAllProducts);
router.get('/search/advanced', advancedProductSearch);
router.get('/search/suggestions', getSearchSuggestions);
router.get('/trending', getTrendingProducts);
router.get('/compare', compareProducts);
router.get('/categories', getCategories);
router.get('/brands', getBrands);
router.get('/:id', getProductById);
router.get('/:id/related', getRelatedProducts);


router.post('/search/image', upload.single('image'), searchByImage);
router.post('/search/voice', voiceSearch);


router.get('/users/:userId/profile', getUserProfile);

router.post('/track-behavior', protect, trackUserBehavior);
router.post('/:productId/view', protect, addToRecentlyViewed);
router.get('/user/recently-viewed', protect, getRecentlyViewed);


router.post('/:id/reviews', protect, addProductReview);
router.post('/:id/reviews/media', protect, upload.array('media', 5), addReviewWithMedia);
router.post('/:productId/reviews/:reviewId/interact', protect, interactWithReview);
router.put('/:productId/reviews/:reviewId/report', protect, reportReview);
router.post('/:productId/reviews/:reviewId/vote', protect, voteReview);

router.post('/:id/questions', protect, askQuestion);
router.post('/:id/wishlist', protect, toggleWishlist);
router.post('/:productId/save-later', protect, moveToSaveForLater);
router.get('/cart/abandoned', protect, getAbandonedCart);
router.get('/cart/recommendations', protect, getCartRecommendations);
router.get('/recommendations/personalized', protect, getPersonalizedRecommendations);
router.get('/filters/smart', protect, getSmartFilters);
router.get('/homepage/personalized', protect, getPersonalizedHomepage);
router.get('/user/dashboard', protect, getUserDashboard);
router.put('/user/preferences', protect, updateUserPreferences);
router.put('/user/notifications', protect, updateNotificationPreferences);
router.get('/user/notification-times', protect, getOptimalNotificationTimes);

router.post('/price-alerts', protect, setPriceAlert);
router.post('/stock/reserve', protect, reserveStock);

router.post('/users/:userIdToFollow/follow', protect, followUser);
router.post('/reviewers/:reviewerId/follow', protect, followReviewer);
router.get('/activity/feed', protect, getActivityFeed);

router.post('/check-in', protect, dailyCheckIn);
router.get('/achievements', protect, getUserAchievements);
router.get('/referral/generate', protect, generateReferralCode);


router.post('/notifications/subscribe', protect, subscribeToPushNotifications);
router.post('/cart/sync', protect, syncOfflineCart);

router.get('/stores/nearby', protect, getNearbyStores);

router.post('/', protect, adminOnly, createProduct);
router.put('/:id', protect, adminOnly, updateProduct);
router.delete('/:id', protect, adminOnly, deleteProduct);
router.post('/bulk-import', protect, adminOnly, bulkImportProducts);

router.put('/:id/sale', protect, adminOnly, setFlashSale);
router.put('/pricing/dynamic', protect, adminOnly, updateDynamicPricing);


router.put('/:id/questions/:qid/answer', protect, adminOnly, answerQuestion);
router.put('/:productId/reviews/:reviewId/moderate', protect, adminOnly, moderateReview);


router.get('/inventory/alerts', protect, adminOnly, getInventoryAlerts);



// Handle multer errors
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File size too large. Maximum size is 5MB.'
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                message: 'Too many files. Maximum is 5 files.'
            });
        }
    }
    
    if (error.message === 'Only image and video files are allowed') {
        return res.status(400).json({
            success: false,
            message: 'Only image and video files are allowed'
        });
    }
    
    next(error);
});

module.exports = router;