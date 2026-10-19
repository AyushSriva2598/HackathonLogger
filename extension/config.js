/**
 * Hackathon Logger - Core Configuration and Global Namespace
 * 
 * Defines global namespaces, platform definitions, category mappings,
 * and logging utility methods.
 */

var HackathonLogger = HackathonLogger || {};

HackathonLogger.config = {
  // Webhook Configuration
  APPS_SCRIPT_URL: 'YOUR_APPS_SCRIPT_WEB_APP_URL',
  APPS_SCRIPT_TOKEN: 'YOUR_SHARED_SECRET_TOKEN',

  // Debug Mode
  DEBUG: false,

  // Retry & Queue Settings
  RETRY_MAX_ATTEMPTS: 5,
  RETRY_BASE_DELAY_MS: 2000,
  RETRY_MAX_DELAY_MS: 300000, // 5 minutes

  // Timing Settings
  REGISTRATION_TIMEOUT_MS: 10000, // 10 seconds
  TOAST_DURATION_MS: 4000,        // 4 seconds

  // Supported Platforms
  platforms: {
    devpost: {
      name: 'Devpost',
      hostPatterns: ['devpost.com']
    },
    devfolio: {
      name: 'Devfolio',
      hostPatterns: ['devfolio.co']
    },
    unstop: {
      name: 'Unstop',
      hostPatterns: ['unstop.com']
    },
    hack2skill: {
      name: 'Hack2skill',
      hostPatterns: ['hack2skill.com']
    },
    dorahacks: {
      name: 'DoraHacks',
      hostPatterns: ['dorahacks.io']
    },
    mlh: {
      name: 'MLH',
      hostPatterns: ['mlh.io']
    }
  },

  // Category Tag Mapping: Lowercase tags mapped to standardized 'X & Y' style labels
  categoryMap: {
    // Artificial Intelligence & Machine Learning
    'artificial intelligence': 'AI & Machine Learning',
    'machine learning': 'AI & Machine Learning',
    'deep learning': 'AI & Machine Learning',
    'generative ai': 'AI & Machine Learning',
    'gen ai': 'AI & Machine Learning',
    'genai': 'AI & Machine Learning',
    'ai': 'AI & Machine Learning',
    'ml': 'AI & Machine Learning',
    'llm': 'AI & Machine Learning',
    'nlp': 'AI & Machine Learning',
    'natural language processing': 'AI & Machine Learning',
    'neural networks': 'AI & Machine Learning',
    'computer vision': 'AI & Computer Vision',
    'cv': 'AI & Computer Vision',

    // Blockchain & Web3
    'blockchain': 'Web3 & Blockchain',
    'web3': 'Web3 & Blockchain',
    'defi': 'Web3 & Blockchain',
    'nft': 'Web3 & Blockchain',
    'nfts': 'Web3 & Blockchain',
    'smart contracts': 'Web3 & Blockchain',
    'crypto': 'Web3 & Blockchain',
    'cryptocurrency': 'Web3 & Blockchain',
    'dao': 'Web3 & Blockchain',
    'solidity': 'Web3 & Blockchain',

    // Cybersecurity & CTF
    'cybersecurity': 'Cybersecurity & Infosec',
    'cyber security': 'Cybersecurity & Infosec',
    'security': 'Cybersecurity & Infosec',
    'infosec': 'Cybersecurity & Infosec',
    'ctf': 'Security & CTF',
    'cryptography': 'Cybersecurity & Infosec',
    'privacy': 'Cybersecurity & Infosec',

    // FinTech & Finance
    'fintech': 'FinTech & Finance',
    'finance': 'FinTech & Finance',
    'banking': 'FinTech & Finance',
    'payments': 'FinTech & Finance',

    // Cloud & DevOps
    'cloud': 'Cloud & DevOps',
    'aws': 'Cloud & DevOps',
    'azure': 'Cloud & DevOps',
    'gcp': 'Cloud & DevOps',
    'devops': 'Cloud & DevOps',
    'infrastructure': 'Cloud & DevOps',
    'docker': 'Cloud & DevOps',
    'kubernetes': 'Cloud & DevOps',

    // IoT & Hardware
    'iot': 'IoT & Hardware',
    'internet of things': 'IoT & Hardware',
    'hardware': 'IoT & Hardware',
    'embedded': 'IoT & Hardware',
    'robotics': 'Robotics & Hardware',

    // Health & Healthcare
    'health': 'Health & Healthcare',
    'healthcare': 'Health & Healthcare',
    'medtech': 'Health & Healthcare',
    'biotech': 'Health & Healthcare',

    // Education & EdTech
    'education': 'EdTech & Education',
    'edtech': 'EdTech & Education',
    'learning': 'EdTech & Education',

    // Sustainability & Climate
    'sustainability': 'Climate & Sustainability',
    'climate': 'Climate & Sustainability',
    'cleantech': 'Climate & Sustainability',
    'clean tech': 'Climate & Sustainability',
    'green': 'Climate & Sustainability',
    'environment': 'Climate & Sustainability',

    // Gaming & AR/VR
    'gaming': 'Gaming & AR/VR',
    'game dev': 'Gaming & AR/VR',
    'gamedev': 'Gaming & AR/VR',
    'game': 'Gaming & AR/VR',
    'ar/vr': 'Gaming & AR/VR',
    'ar': 'Gaming & AR/VR',
    'vr': 'Gaming & AR/VR',
    'xr': 'Gaming & AR/VR',
    'virtual reality': 'Gaming & AR/VR',
    'augmented reality': 'Gaming & AR/VR',
    'metaverse': 'Gaming & AR/VR',

    // Mobile & App Dev
    'mobile': 'Mobile & App Dev',
    'ios': 'Mobile & App Dev',
    'android': 'Mobile & App Dev',
    'app': 'Mobile & App Dev',

    // Open Source & Community
    'open source': 'Open Source & Community',
    'opensource': 'Open Source & Community',
    'oss': 'Open Source & Community',

    // Data Science & Analytics
    'data science': 'Data Science & Analytics',
    'data': 'Data Science & Analytics',
    'big data': 'Data Science & Analytics',
    'analytics': 'Data Science & Analytics',

    // Social Good & Impact
    'social good': 'Social Good & Impact',
    'social impact': 'Social Good & Impact',
    'civic': 'Social Good & Impact',
    'accessibility': 'Social Good & Impact'
  }
};

// Sub-namespaces
HackathonLogger.adapters = HackathonLogger.adapters || {};
HackathonLogger.utils = HackathonLogger.utils || {};

// Logging helpers
HackathonLogger.log = function() {
  if (HackathonLogger.config && HackathonLogger.config.DEBUG) {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[HackathonLogger]');
    console.log.apply(console, args);
  }
};

HackathonLogger.warn = function() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift('[HackathonLogger]');
  console.warn.apply(console, args);
};

HackathonLogger.error = function() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift('[HackathonLogger]');
  console.error.apply(console, args);
};
