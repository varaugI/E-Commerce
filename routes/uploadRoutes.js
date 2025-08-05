const express = require('express');
const router = express.Router();
const path = require('path');
const upload = require('../middleware/uploadMiddleware');
const { protect, adminOnly } = require('../middleware/authMiddleware');

// Upload a single image file
router.post('/', protect, adminOnly, upload.single('image'), (req, res) => {
  res.status(201).json({
    message: 'File uploaded successfully',
    filePath: `/${req.file.path}`,
  });
});

module.exports = router;
