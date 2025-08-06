const errorHandler = (err, req, res, next) => {
  res.locals.error = err;
  console.error('Error:', err);

  res.status(err.statusCode || 500).json({
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
};
