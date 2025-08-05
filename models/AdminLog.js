const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
    admin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    action: {
        type: String,
        required: true,
        enum: [
            'CREATE_USER',
            'UPDATE_USER',
            'DELETE_USER',
            'CREATE_PRODUCT',
            'UPDATE_PRODUCT',
            'DELETE_PRODUCT',
            'LOGIN',
            'LOGOUT',
            'OTHER'
        ],
        default: 'OTHER'
    },
    targetType: {
        type: String,
        enum: ['USER', 'PRODUCT', 'ORDER', 'NONE'],
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
    filter: {
        type: String,
        default: null
    }
}, { timestamps: true });

module.exports = mongoose.model('AdminLog', adminLogSchema);
