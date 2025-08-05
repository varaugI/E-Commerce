const mongoose = require('mongoose');

const userLogSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    action: {
        type: String,
        required: true,
        enum: [
            'LOGIN',
            'LOGOUT',
            'REGISTER',
            'UPDATE_PROFILE',
            'CHANGE_PASSWORD',
            'PLACE_ORDER',
            'VIEW_PRODUCT',
            'ADD_TO_CART',
            'OTHER'
        ],
        default: 'OTHER'
    },
    targetType: {
        type: String,
        enum: ['PRODUCT', 'ORDER', 'NONE'],
        default: 'NONE'
    },
    targetId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },
    details: {
        type: Object,
        default: {}
    },
}, { timestamps: true });

module.exports = mongoose.model('UserLog', userLogSchema);
