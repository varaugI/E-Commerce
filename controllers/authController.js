const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const createUserLog = require('../utils/createUserLog');

// Register
exports.registerUser = async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
        return res.status(400).json({ message: 'All fields are required' });

    try {
        const userExists = await User.findOne({ email });
        if (userExists)
            return res.status(400).json({ message: 'User already exists' });

        const user = await User.create({ name, email, password });
        await createUserLog({
            userId: user._id,
            action: 'registerUser',
            details: { name, email }
        });

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

    if (!email || !password)
        return res.status(400).json({ message: 'Email and password are required' });

    try {
        const user = await User.findOne({ email }).select('+password');
        const isMatch = user && await user.matchPassword(password);

        if (!user || !isMatch)
            return res.status(401).json({ message: 'Invalid email or password' });

        await createUserLog({
            userId: user._id,
            action: 'loginUser',
            details: { email }
        });

        res.json({
            ...user.toJSON(),
            token: generateToken(user._id),
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
