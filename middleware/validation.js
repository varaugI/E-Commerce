const Joi = require('joi');

const validateOrder = (req, res, next) => {
    const schema = Joi.object({
        orderItems: Joi.array().items(
            Joi.object({
                product: Joi.string().required(),
                qty: Joi.number().min(1).required(),
                price: Joi.number().min(0).required()
            })
        ).min(1).required(),
        shippingAddress: Joi.object({
            address: Joi.string().required(),
            city: Joi.string().required(),
            postalCode: Joi.string().required(),
            country: Joi.string().required()
        }).required(),
        paymentMethod: Joi.string().valid('PayPal', 'Stripe', 'COD').required(),
        totalPrice: Joi.number().min(0).required()
    });

    const { error } = schema.validate(req.body);
    if (error) {
        return res.status(400).json({ 
            message: 'Validation error',
            details: error.details.map(d => d.message)
        });
    }
    next();
};

module.exports = { validateOrder };