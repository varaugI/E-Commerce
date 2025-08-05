// middleware/adminLogger.js
const createAdminLog = require('../utils/createAdminLog');

const adminLogger = (targetType) => {
    return async (req, res, next) => {
        const method = req.method;
        const adminId = req.user?._id; // Assumes auth middleware runs before this
        let actionType;

        if (!adminId) return next(); // Skip if not authenticated

        if (method === 'POST') actionType = 'Created';
        else if (method === 'PUT' || method === 'PATCH') actionType = 'Updated';
        else if (method === 'DELETE') actionType = 'Deleted';
        else return next(); // Ignore other methods

        // Let the request complete first
        res.on('finish', async () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                await createAdminLog({
                    adminId,
                    action: `${actionType} ${targetType}`,
                    targetType,
                    targetId: req.params.id || null,
                    details: {
                        method,
                        url: req.originalUrl,
                        body: req.body
                    }
                });
            }
        });

        next();
    };
};

module.exports = adminLogger;
