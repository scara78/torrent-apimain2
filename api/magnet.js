const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const router = express.Router();

// Helper function to make proxy request (same as in search.js)
const makeProxyRequest = async (url, retries = 3) => {
  const proxies = [
    'https://api.allorigins.win/raw?url=',
    'https://cors-anywhere.herokuapp.com/',
    'https://thingproxy.freeboard.io/fetch/',
    'https://api.codetabs.com/v1/proxy?quest='
  ];

  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  ];

  for (let i = 0; i < retries; i++) {
    try {
      const proxy = proxies[Math.floor(Math.random() * proxies.length)];
      const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
      
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
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
};

// Get magnet link from 1337x torrent page
router.get('/1337x/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const url = `https://1337x.to/torrent/${hash}/`;
    
    const html = await makeProxyRequest(url);
    const $ = cheerio.load(html);
    
    const magnet = $('a[href^="magnet:?"]').attr('href');
    const title = $('.box-info-heading h1').text().trim();
    const size = $('.size').text().trim();
    const seeds = $('.seeds').text().trim();
    const leeches = $('.leeches').text().trim();
    
    if (!magnet) {
      return res.status(404).json({
        error: 'Magnet link not found',
        message: 'This torrent might not have a magnet link available'
      });
    }
    
    res.json({
      hash,
      title,
      size,
      seeds: parseInt(seeds) || 0,
      leeches: parseInt(leeches) || 0,
      magnet,
      source: '1337x',
      url
    });
    
  } catch (error) {
    console.error('1337x magnet error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch magnet link',
      message: error.message
    });
  }
});

// Get magnet link from RARBG torrent page
router.get('/rarbg/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const url = `https://rarbg.to/torrent/${hash}`;
    
    const html = await makeProxyRequest(url);
    const $ = cheerio.load(html);
    
    const magnet = $('a[href^="magnet:?"]').attr('href');
    const title = $('h1').text().trim();
    const size = $('td:contains("Size")').next().text().trim();
    const seeds = $('td:contains("Seeders")').next().text().trim();
    const leeches = $('td:contains("Leechers")').next().text().trim();
    
    if (!magnet) {
      return res.status(404).json({
        error: 'Magnet link not found',
        message: 'This torrent might not have a magnet link available'
      });
    }
    
    res.json({
      hash,
      title,
      size,
      seeds: parseInt(seeds) || 0,
      leeches: parseInt(leeches) || 0,
      magnet,
      source: 'RARBG',
      url
    });
    
  } catch (error) {
    console.error('RARBG magnet error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch magnet link',
      message: error.message
    });
  }
});

// Get magnet link from The Pirate Bay torrent page
router.get('/tpb/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const url = `https://thepiratebay.org/description.php?id=${hash}`;
    
    const html = await makeProxyRequest(url);
    const $ = cheerio.load(html);
    
    const magnet = $('a[href^="magnet:?"]').attr('href');
    const title = $('.detName').text().trim();
    const size = $('.detDesc').text().match(/Size\s+(.+?),/)?.[1] || 'Unknown';
    const seeds = $('td[align="right"]').first().text().trim();
    const leeches = $('td[align="right"]').last().text().trim();
    
    if (!magnet) {
      return res.status(404).json({
        error: 'Magnet link not found',
        message: 'This torrent might not have a magnet link available'
      });
    }
    
    res.json({
      hash,
      title,
      size,
      seeds: parseInt(seeds) || 0,
      leeches: parseInt(leeches) || 0,
      magnet,
      source: 'The Pirate Bay',
      url
    });
    
  } catch (error) {
    console.error('TPB magnet error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch magnet link',
      message: error.message
    });
  }
});

// Generic magnet link extractor
router.post('/extract', async (req, res) => {
  try {
    const { url, source } = req.body;
    
    if (!url || !source) {
      return res.status(400).json({
        error: 'URL and source are required',
        example: {
          url: 'https://1337x.to/torrent/12345/movie-name/',
          source: '1337x'
        }
      });
    }
    
    let magnet = null;
    let title = '';
    let size = '';
    let seeds = 0;
    let leeches = 0;
    
    const html = await makeProxyRequest(url);
    const $ = cheerio.load(html);
    
    switch (source.toLowerCase()) {
      case '1337x':
        magnet = $('a[href^="magnet:?"]').attr('href');
        title = $('.box-info-heading h1').text().trim();
        size = $('.size').text().trim();
        seeds = parseInt($('.seeds').text().trim()) || 0;
        leeches = parseInt($('.leeches').text().trim()) || 0;
        break;
        
      case 'rarbg':
        magnet = $('a[href^="magnet:?"]').attr('href');
        title = $('h1').text().trim();
        size = $('td:contains("Size")').next().text().trim();
        seeds = parseInt($('td:contains("Seeders")').next().text().trim()) || 0;
        leeches = parseInt($('td:contains("Leechers")').next().text().trim()) || 0;
        break;
        
      case 'tpb':
      case 'thepiratebay':
        magnet = $('a[href^="magnet:?"]').attr('href');
        title = $('.detName').text().trim();
        size = $('.detDesc').text().match(/Size\s+(.+?),/)?.[1] || 'Unknown';
        seeds = parseInt($('td[align="right"]').first().text().trim()) || 0;
        leeches = parseInt($('td[align="right"]').last().text().trim()) || 0;
        break;
        
      default:
        return res.status(400).json({
          error: 'Unsupported source',
          supportedSources: ['1337x', 'rarbg', 'tpb', 'thepiratebay']
        });
    }
    
    if (!magnet) {
      return res.status(404).json({
        error: 'Magnet link not found',
        message: 'This torrent might not have a magnet link available'
      });
    }
    
    res.json({
      url,
      source,
      title,
      size,
      seeds,
      leeches,
      magnet,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Magnet extraction error:', error.message);
    res.status(500).json({
      error: 'Failed to extract magnet link',
      message: error.message
    });
  }
});

module.exports = router; 