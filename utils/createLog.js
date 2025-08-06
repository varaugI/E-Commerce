// utils/createLog.js
const Log = require('../models/Log');

/**
 * Creates a log entry for both ADMIN and USER actions.
 *
 * @param {Object} params
 * @param {'ADMIN'|'USER'} params.type - Actor type
 * @param {String} params.actorId - ID of the actor (user/admin)
 * @param {String} params.action - Description of action (e.g., "POST /api/products")
 * @param {String} [params.targetType='NONE'] - Target type (PRODUCT, ORDER, API_REQUEST, etc.)
 * @param {ObjectId} [params.targetId=null] - Target document ID
 * @param {Object} [params.details={}] - Request details (headers, body, params, etc.)
 * @param {Number} [params.statusCode=null] - HTTP status code
 * @param {Object} [params.response=null] - Response body
 * @param {Object} [params.error=null] - Error info
 * @param {String} [params.ip=null] - Request IP
 * @param {String} [params.filter=null] - Correlation ID for tracing
 */
const createLog = async ({
    type,
    actorId,
    action,
    targetType = 'NONE',
    targetId = null,
    details = {},
    statusCode = null,
    response = null,
    error = null,
    ip = null,
    filter = null
}) => {
    try {
        await Log.create({
            type,
            actor: actorId,
            action,
            targetType,
            targetId,
            details,
            statusCode,
            response,
            error,
            ip,
            filter
        });
    } catch (err) {
        console.error(`[${type}Log] Failed to create log:`, err);
    }
};

module.exports = createLog;
