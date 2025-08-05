const UserLog = require('../models/UserLog');

/**
 * Logs user-side actions to the database.
 * @param {Object} logData
 * @param {String} logData.userId - The user performing the action.
 * @param {String} logData.action - Action type.
 * @param {String} [logData.targetType] - Type of target (e.g., PRODUCT, ORDER).
 * @param {ObjectId} [logData.targetId] - ID of the target object.
 * @param {Object} [logData.details] - Extra info such as request payload or context.
 */
const createUserLog = async ({
    userId,
    action,
    targetType = 'NONE',
    targetId = null,
    details = {}
}) => {
    try {
        await UserLog.create({
            user: userId,
            action,
            targetType,
            targetId,
            details
        });
    } catch (err) {
        console.error(`[UserLog] Failed to create log. Action: ${action}, User: ${userId}`);
        console.error(err);
    }
};

module.exports = createUserLog;
