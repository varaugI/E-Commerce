const User = require('../models/User');
const generateToken = require('../utils/generateToken');

const Joi = require('joi');

const validateRegistration = (req, res, next) => {
    const schema = Joi.object({
        name: Joi.string().min(2).max(50).required(),
        email: Joi.string().email().required(),
        password: Joi.string().min(6).required()
    });

    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });
    next();
};



const validatePassword = (password) => {
    const schema = Joi.string()
        .min(8)
        .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-z])(?=.*[0-9])(?=.*[!@#\$%\^&\*])'))
        .required()
        .messages({
            'string.pattern.base': 'Password must contain uppercase, lowercase, number and special character'
        });
    return schema.validate(password);
};

// Register
exports.registerUser = async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
        return res.status(400).json({ message: 'All fields are required' });

    try {

        const userExists = await User.findOne({ email });
        if (userExists)
            return res.status(400).json({ message: 'User already exists' });
        const passwordSchema = Joi.string()
            .min(8)
            .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\$%\^&\*])'))
            .required()
            .messages({
                'string.pattern.base': 'Password must contain uppercase, lowercase, number and special character'
            });

        const user = await User.create({ name, email, password });


        res.status(201).json({
            ...user.toJSON(),
            token: generateToken(user._id),
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Login
exports.loginUser = async (req, res) => {
    const { email, password } = req.body;
    const { error } = validatePassword(password);
    if (error) return res.status(400).json({ message: error.details[0].message });
    if (!email || !password)
        return res.status(400).json({ message: 'Email and password are required' });

    try {
        const user = await User.findOne({ email }).select('+password');
        const isMatch = user && await user.matchPassword(password);

        if (!user || !isMatch)
            return res.status(401).json({ message: 'Invalid email or password' });

        res.json({
            ...user.toJSON(),
            token: generateToken(user._id),
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
