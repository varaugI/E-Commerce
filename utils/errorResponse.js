
class ErrorResponse extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
    }
}

const errorCodes = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN'
};


const sendErrorResponse = (res, statusCode, message, details = null) => {
    res.status(statusCode).json({
        success: false,
        message,
        ...(details && { details }),
        timestamp: new Date().toISOString()
    });
};

const sendSuccessResponse = (res, statusCode = 200, message, data = null) => {
    res.status(statusCode).json({
        success: true,
        message,
        ...(data && { data }),
        timestamp: new Date().toISOString()
    });
};
module.exports = { ErrorResponse, errorCodes };