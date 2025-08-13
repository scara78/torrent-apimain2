const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Import routes
const searchRoutes = require('./search');
const magnetRoutes = require('./magnet');

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: '*', // Allow all origins for API
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Torrent Search API',
    version: '1.0.0',
    description: 'Multi-source torrent search API with proxy support',
    endpoints: {
      search: '/api/search?query=<search_term>&source=<source>',
      magnet: '/api/magnet/<source>/<hash>',
      extract: '/api/magnet/extract (POST)',
      health: '/api/health',
      sources: '/api/sources'
    },
    sources: ['1337x', 'TPB', 'Apibay', 'YTS', 'RARBG'],
    documentation: 'Check the README.md for detailed usage instructions'
  });
});

// API routes
app.use('/api', searchRoutes);
app.use('/api/magnet', magnetRoutes);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  
  // Handle specific error types
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: error.message
    });
  }
  
  if (error.name === 'TimeoutError') {
    return res.status(408).json({
      error: 'Request Timeout',
      message: 'The request took too long to complete'
    });
  }
  
  // Default error
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong' 
      : error.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: 'The requested endpoint does not exist',
    availableEndpoints: [
      'GET /',
      'GET /api/search?query=<search_term>&source=<source>',
      'GET /api/magnet/<source>/<hash>',
      'POST /api/magnet/extract',
      'GET /api/health',
      'GET /api/sources'
    ],
    example: '/api/search?query=inception&source=all'
  });
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Torrent API server running on port ${PORT}`);
    console.log(`📖 API Documentation: http://localhost:${PORT}/`);
    console.log(`🔍 Search endpoint: http://localhost:${PORT}/api/search?query=test`);
    console.log(`🧲 Magnet endpoint: http://localhost:${PORT}/api/magnet/1337x/12345`);
  });
}

module.exports = app; 