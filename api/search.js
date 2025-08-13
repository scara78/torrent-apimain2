const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const cheerio = require('cheerio');
const UserAgent = require('user-agents');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Proxy rotation and user agent rotation
const proxies = [
  'https://api.allorigins.win/raw?url=',
  'https://cors-anywhere.herokuapp.com/',
  'https://thingproxy.freeboard.io/fetch/',
  'https://api.codetabs.com/v1/proxy?quest='
];

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0'
];

// Helper function to get random proxy and user agent
const getRandomProxy = () => proxies[Math.floor(Math.random() * proxies.length)];
const getRandomUserAgent = () => userAgents[Math.floor(Math.random() * userAgents.length)];

// Helper function to make proxy request
const makeProxyRequest = async (url, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const proxy = getRandomProxy();
      const userAgent = getRandomUserAgent();
      
      const response = await axios.get(proxy + encodeURIComponent(url), {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 10000
      });
      
      return response.data;
    } catch (error) {
      console.error(`Proxy attempt ${i + 1} failed:`, error.message);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
    }
  }
};

// Torrent search sources
const searchSources = {
  // 1337x search
  async search1337x(query) {
    try {
      const searchUrl = `https://1337x.to/search/${encodeURIComponent(query)}/1/`;
      const html = await makeProxyRequest(searchUrl);
      const $ = cheerio.load(html);
      
      const results = [];
      $('.table-list tbody tr').each((i, element) => {
        if (i >= 10) return false; // Limit to 10 results
        
        const $el = $(element);
        const name = $el.find('.name a').text().trim();
        const size = $el.find('.size').text().trim();
        const seeds = $el.find('.seeds').text().trim();
        const leeches = $el.find('.leeches').text().trim();
        const link = $el.find('.name a').attr('href');
        
        if (name && link) {
          results.push({
            name,
            size,
            seeds: parseInt(seeds) || 0,
            leeches: parseInt(leeches) || 0,
            source: '1337x',
            link: `https://1337x.to${link}`,
            magnet: null // Would need to scrape individual page for magnet
          });
        }
      });
      
      return results;
    } catch (error) {
      console.error('1337x search error:', error.message);
      return [];
    }
  },

  // The Pirate Bay search
  async searchTPB(query) {
    try {
      const searchUrl = `https://thepiratebay.org/search/${encodeURIComponent(query)}/0/99/0`;
      const html = await makeProxyRequest(searchUrl);
      const $ = cheerio.load(html);
      
      const results = [];
      $('#searchResult tbody tr').each((i, element) => {
        if (i >= 10) return false; // Limit to 10 results
        
        const $el = $(element);
        const name = $el.find('.detName a').text().trim();
        const size = $el.find('.detDesc').text().match(/Size\s+(.+?),/)?.[1] || 'Unknown';
        const seeds = $el.find('td[align="right"]').first().text().trim();
        const leeches = $el.find('td[align="right"]').last().text().trim();
        const magnet = $el.find('a[title="Download this torrent using magnet"]').attr('href');
        
        if (name) {
          results.push({
            name,
            size,
            seeds: parseInt(seeds) || 0,
            leeches: parseInt(leeches) || 0,
            source: 'The Pirate Bay',
            link: null,
            magnet
          });
        }
      });
      
      return results;
    } catch (error) {
      console.error('TPB search error:', error.message);
      return [];
    }
  },

  // Apibay.org search (The Pirate Bay API)
  async searchApibay(query) {
    try {
      const searchUrl = `https://apibay.org/q.php?q=${encodeURIComponent(query)}&cat=0`;
      
      // Apibay provides a clean JSON API, no need for proxy or HTML parsing
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'application/json',
        },
        timeout: 10000
      });
      
      if (!response.data || response.data === 'No results') {
        return [];
      }
      
      const results = [];
      const torrents = Array.isArray(response.data) ? response.data : [response.data];
      
      torrents.slice(0, 10).forEach(torrent => {
        if (torrent.name) {
          results.push({
            name: torrent.name,
            size: this.formatBytes(torrent.size),
            seeds: parseInt(torrent.seeders) || 0,
            leeches: parseInt(torrent.leechers) || 0,
            source: 'Apibay',
            link: `https://thepiratebay.org/description.php?id=${torrent.id}`,
            magnet: `magnet:?xt=urn:btih:${torrent.info_hash}`,
            id: torrent.id,
            info_hash: torrent.info_hash
          });
        }
      });
      
      return results;
    } catch (error) {
      console.error('Apibay search error:', error.message);
      return [];
    }
  },

  // YTS search (for movies)
  async searchYTS(query) {
    try {
      const searchUrl = `https://yts.mx/browse-movies/${encodeURIComponent(query)}/all/all/0/latest`;
      const html = await makeProxyRequest(searchUrl);
      const $ = cheerio.load(html);
      
      const results = [];
      $('.browse-movie-titles a').each((i, element) => {
        if (i >= 10) return false; // Limit to 10 results
        
        const $el = $(element);
        const name = $el.text().trim();
        const link = $el.attr('href');
        
        if (name && link) {
          results.push({
            name,
            size: 'Unknown',
            seeds: 0,
            leeches: 0,
            source: 'YTS',
            link,
            magnet: null
          });
        }
      });
      
      return results;
    } catch (error) {
      console.error('YTS search error:', error.message);
      return [];
    }
  },

  // RARBG search
  async searchRARBG(query) {
    try {
      const searchUrl = `https://rarbg.to/torrents.php?search=${encodeURIComponent(query)}&order=seeders&by=DESC`;
      const html = await makeProxyRequest(searchUrl);
      const $ = cheerio.load(html);
      
      const results = [];
      $('.lista2t tr').each((i, element) => {
        if (i >= 10) return false; // Limit to 10 results
        
        const $el = $(element);
        const name = $el.find('td:nth-child(2) a').text().trim();
        const size = $el.find('td:nth-child(4)').text().trim();
        const seeds = $el.find('td:nth-child(5)').text().trim();
        const leeches = $el.find('td:nth-child(6)').text().trim();
        const link = $el.find('td:nth-child(2) a').attr('href');
        
        if (name && link) {
          results.push({
            name,
            size,
            seeds: parseInt(seeds) || 0,
            leeches: parseInt(leeches) || 0,
            source: 'RARBG',
            link: `https://rarbg.to${link}`,
            magnet: null
          });
        }
      });
      
      return results;
    } catch (error) {
      console.error('RARBG search error:', error.message);
      return [];
    }
  },

  // Helper function to format bytes
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
};

// Main search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { query, source = 'all' } = req.query;
    
    if (!query) {
      return res.status(400).json({
        error: 'Query parameter is required',
        example: '/api/search?query=movie+name&source=all'
      });
    }

    let results = [];
    
    if (source === 'all') {
      // Search all sources concurrently
      const searchPromises = Object.values(searchSources).map(searchFunc => 
        searchFunc(query).catch(error => {
          console.error('Search source error:', error.message);
          return [];
        })
      );
      
      const allResults = await Promise.allSettled(searchPromises);
      results = allResults
        .filter(result => result.status === 'fulfilled')
        .flatMap(result => result.value);
    } else if (searchSources[`search${source.charAt(0).toUpperCase() + source.slice(1)}`]) {
      // Search specific source
      const searchFunc = searchSources[`search${source.charAt(0).toUpperCase() + source.slice(1)}`];
      results = await searchFunc(query);
    } else {
      return res.status(400).json({
        error: 'Invalid source. Available sources: all, 1337x, TPB, Apibay, YTS, RARBG',
        example: '/api/search?query=movie+name&source=1337x'
      });
    }

    // Sort by seeds (descending)
    results.sort((a, b) => b.seeds - a.seeds);

    res.json({
      query,
      total: results.length,
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    sources: Object.keys(searchSources).map(key => key.replace('search', ''))
  });
});

  // Available sources endpoint
  app.get('/api/sources', (req, res) => {
    res.json({
      sources: [
        { id: 'all', name: 'All Sources', description: 'Search across all available sources' },
        { id: '1337x', name: '1337x', description: 'Popular torrent search engine' },
        { id: 'TPB', name: 'The Pirate Bay', description: 'Famous torrent index' },
        { id: 'Apibay', name: 'Apibay', description: 'The Pirate Bay API (clean JSON)' },
        { id: 'YTS', name: 'YTS', description: 'Movie torrents' },
        { id: 'RARBG', name: 'RARBG', description: 'High-quality torrents' }
      ]
    });
  });

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /api/search?query=<search_term>&source=<source>',
      'GET /api/health',
      'GET /api/sources'
    ]
  });
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Torrent API server running on port ${PORT}`);
    console.log(`Search endpoint: http://localhost:${PORT}/api/search?query=test`);
  });
}

module.exports = app; 