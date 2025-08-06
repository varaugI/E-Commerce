// config/index.js
const config = {
    development: {
        database: {
            host: process.env.MONGO_URI,
            options: { useNewUrlParser: true, useUnifiedTopology: true }
        },
        jwt: {
            secret: process.env.JWT_SECRET,
            expiresIn: '7d'
        },
        redis: {
            host: 'localhost',
            port: 6379
        }
    },
    production: {
        database: {
            host: process.env.MONGO_URI,
            options: { 
                useNewUrlParser: true, 
                useUnifiedTopology: true,
                maxPoolSize: 10
            }
        },
        jwt: {
            secret: process.env.JWT_SECRET,
            expiresIn: '1d'
        },
        redis: {
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT,
            password: process.env.REDIS_PASSWORD
        }
    }
};

module.exports = config[process.env.NODE_ENV || 'development'];