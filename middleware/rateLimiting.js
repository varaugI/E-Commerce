
const rateLimit = require('express-rate-limit');

const createRateLimit = (windowMs, max, message) => rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false
});

const authLimiter = createRateLimit(
    15 * 60 * 1000, // 15 minutes
    5, // 5 attempts
    'Too many authentication attempts'
);

const apiLimiter = createRateLimit(
    15 * 60 * 1000, // 15 minutes
    100, // 100 requests
    'Too many API requests'
);

module.exports = { authLimiter, apiLimiter };