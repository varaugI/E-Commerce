
const { v4: uuidv4 } = require('uuid');
const createLog = require('../utils/createLog');

const logRequest = (targetType = 'API_REQUEST') => {
    return (req, res, next) => {
        const correlationId = uuidv4();
        req.correlationId = correlationId;
        const start = Date.now();

        const oldSend = res.send;
        let responseBody;
        res.send = function (body) {
            responseBody = body;
            return oldSend.apply(this, arguments);
        };

        res.on('finish', async () => {
            const duration = Date.now() - start;
            const type = req.user?.isAdmin ? 'ADMIN' : 'USER';

            await createLog({
                type,
                actorId: req.user?._id || null,
                action: `${req.method} ${req.originalUrl}`,
                targetType,
                targetId: req.params?.id || null,
                details: {
                    headers: req.headers,
                    body: req.body,
                    query: req.query,
                    params: req.params,
                    responseTime: `${duration}ms`
                },
                statusCode: res.statusCode,
                response: responseBody ? JSON.parse(JSON.stringify(responseBody)) : undefined,
                ip: req.ip,
                filter: correlationId,
                error: res.locals.error
                    ? { message: res.locals.error.message, stack: res.locals.error.stack }
                    : undefined
            });
        });

        next();
    };
};

module.exports = logRequest;
