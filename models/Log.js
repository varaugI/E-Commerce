const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
    type: { type: String, enum: ['USER', 'ADMIN'], required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, refPath: 'type' },
    action: String,
    targetType: String,
    targetId: mongoose.Schema.Types.ObjectId,
    details: Object,
    statusCode: Number,
    response: Object,
    error: Object,
    ip: String,
    filter: String,
}, { timestamps: true });

module.exports = mongoose.model('Log', logSchema);
