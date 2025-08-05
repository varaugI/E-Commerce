const AdminLog = require('../models/AdminLog');

/**
 * Logs admin actions to the database.
 * @param {Object} logData
 * @param {String} logData.adminId - The ID of the admin performing the action.
 * @param {String} logData.action - The action performed.
 * @param {String} [logData.targetType] - The type of target (e.g., USER, PRODUCT).
 * @param {ObjectId} [logData.targetId] - ID of the target object.
 * @param {Object} [logData.details] - Additional info (payload, change summary, etc.).
 * @param {String} [logData.filter] - Optional filter string.
 */
const createAdminLog = async ({
  adminId,
  action,
  targetType = 'NONE',
  targetId = null,
  details = {},
  filter = null
}) => {
  try {
    await AdminLog.create({
      admin: adminId,
      action,
      targetType,
      targetId,
      details,
      filter
    });
  } catch (err) {
    console.error(`[AdminLog] Failed to create log. Action: ${action}, Admin: ${adminId}`);
    console.error(err);
  }
};

module.exports = createAdminLog;
