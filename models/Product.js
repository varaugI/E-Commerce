const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: String,
    rating: { type: Number, required: true },
    comment: String,
    isReported: { type: Boolean, default: false },
    isHidden: { type: Boolean, default: false },
    helpfulVotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    notHelpfulVotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

const questionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    question: String,
    answer: String,
    answeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});



const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    brand: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true
    },
    description: {
        type: String
    },
    price: {
        type: Number,
        required: true,
        default: 0
    },
    image: {
        type: String,
        default: ''
    },
    reviews: [reviewSchema],
    rating: {
        type: Number,
        default: 0
    },
    numReviews: {
        type: Number,
        default: 0
    },
    countInStock: {
        type: Number,
        required: true,
        default: 0,
    },
    viewCount: { type: Number, default: 0 },
    salePrice: { type: Number },
    saleEndDate: { type: Date },
    questions: [questionSchema]

}, { timestamps: true });

productSchema.index({ name: 'text', description: 'text' }); // Text search
productSchema.index({ category: 1, brand: 1 }); // Filtering
productSchema.index({ price: 1 }); // Price range queries
productSchema.index({ rating: -1 }); // Top rated products
productSchema.index({ category: 1, price: 1, rating: -1 }); // Filter + sort
productSchema.index({ countInStock: 1 }); 
module.exports = mongoose.model('Product', productSchema);
