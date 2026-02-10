const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(__dirname, 'backups');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

// Middleware
const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    
    // Allow all localhost origins and tunnel services
    if (origin.match(/^http:\/\/localhost(:[0-9]+)?$/) || 
        origin.match(/^https?:\/\/[a-z0-9]+\.lhr\.life$/) ||
        origin.match(/^https?:\/\/[a-z0-9-]+\.localhost\.run$/)) {
      return callback(null, true);
    }
    
    // Allow specific domains
    const allowedDomains = [
      'https://demo.colaps.team'
    ];
    
    if (allowedDomains.some(domain => origin.startsWith(domain))) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Ensure data and backup directories exist
const ensureDirectories = async () => {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
  
  try {
    await fs.access(BACKUP_DIR);
  } catch {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
  }
};

const ensureDataFiles = async () => {
  try {
    await fs.access(EVENTS_FILE);
  } catch {
    await fs.writeFile(EVENTS_FILE, '[]');
  }
};

// Helper function to create automatic backups
const createBackup = async () => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(BACKUP_DIR, `backup_${timestamp}`);
    
    await fs.mkdir(backupDir, { recursive: true });
    
    // Copy all data files to backup
    const files = await fs.readdir(DATA_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const sourcePath = path.join(DATA_DIR, file);
        const backupPath = path.join(backupDir, file);
        await fs.copyFile(sourcePath, backupPath);
      }
    }
    
    console.log(`✅ Backup created: ${backupDir}`);
    return backupDir;
  } catch (error) {
    console.error('❌ Failed to create backup:', error);
    throw error;
  }
};

// Helper function to append data to JSON file
const appendToJSONFile = async (filename, data) => {
  const filePath = path.join(DATA_DIR, filename);
  
  try {
    // Try to read existing file
    const existingData = await fs.readFile(filePath, 'utf8');
    const jsonData = JSON.parse(existingData);
    
    // Append new data
    if (Array.isArray(data)) {
      jsonData.push(...data);
    } else {
      jsonData.push(data);
    }
    
    // Write back to file
    await fs.writeFile(filePath, JSON.stringify(jsonData, null, 2));
  } catch (error) {
    // File doesn't exist, create new one
    const newData = Array.isArray(data) ? data : [data];
    await fs.writeFile(filePath, JSON.stringify(newData, null, 2));
  }
};

// Helper function to convert JSON to CSV
const jsonToCSV = (jsonArray) => {
  if (!jsonArray || jsonArray.length === 0) return '';
  
  // Get all unique keys from all objects
  const allKeys = new Set();
  jsonArray.forEach(obj => {
    Object.keys(obj).forEach(key => allKeys.add(key));
    // Handle nested eventData
    if (obj.eventData && typeof obj.eventData === 'object') {
      Object.keys(obj.eventData).forEach(key => allKeys.add(`eventData_${key}`));
    }
  });
  
  const keys = Array.from(allKeys);
  
  // Create CSV header
  const csvRows = [keys.join(',')];
    
  // Create CSV rows
  jsonArray.forEach(obj => {
    const row = keys.map(key => {
      let value;
      
      if (key.startsWith('eventData_')) {
        const eventDataKey = key.replace('eventData_', '');
        value = obj.eventData && obj.eventData[eventDataKey];
      } else {
        value = obj[key];
      }
      
      // Handle different data types
      if (value === null || value === undefined) {
        return '';
      } else if (typeof value === 'object') {
        return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
      } else if (typeof value === 'string' && value.includes(',')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      
      return value;
    });
    
    csvRows.push(row.join(','));
  });
  
  return csvRows.join('\n');
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    dataDir: DATA_DIR,
    backupDir: BACKUP_DIR
  });
});

// POST /api/analytics/events/bulk - Store multiple events
app.post('/api/analytics/events/bulk', async (req, res) => {
  try {
    const events = req.body;
    
    if (!Array.isArray(events)) {
      return res.status(400).json({ success: false, error: 'Events must be an array' });
    }
    
    // Add server timestamp to all events
    const timestampedEvents = events.map(event => ({
      ...event,
      serverTimestamp: Date.now()
    }));
    
    // Store in general events file
    await appendToJSONFile('events.json', timestampedEvents);
    
    // Group by user and store in user-specific files
    const userGroups = {};
    timestampedEvents.forEach(event => {
      if (!userGroups[event.userId]) {
        userGroups[event.userId] = [];
      }
      userGroups[event.userId].push(event);
    });
    
    // Store each user's events
    for (const [userId, userEvents] of Object.entries(userGroups)) {
      const userFile = `user_${userId}.json`;
      await appendToJSONFile(userFile, userEvents);
    }
    
    console.log(`📊 Stored ${timestampedEvents.length} events for ${Object.keys(userGroups).length} users`);
    
    res.status(200).json({ 
      success: true, 
      message: `${timestampedEvents.length} events stored successfully`,
      usersAffected: Object.keys(userGroups).length
    });
  } catch (error) {
    console.error('Error storing bulk events:', error);
    res.status(500).json({ success: false, error: 'Failed to store events' });
  }
});

// GET /api/analytics/users - Get list of all users
app.get('/api/analytics/users', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const userFiles = files.filter(file => file.startsWith('user_') && file.endsWith('.json'));
    
    const users = await Promise.all(
      userFiles.map(async (file) => {
        const userId = file.replace('user_', '').replace('.json', '');
        const filePath = path.join(DATA_DIR, file);
        const data = await fs.readFile(filePath, 'utf8');
        const events = JSON.parse(data);
        
        return {
          userId,
          eventCount: events.length,
          firstEvent: events[0]?.timestamp || null,
          lastEvent: events[events.length - 1]?.timestamp || null,
          sessions: [...new Set(events.map(e => e.sessionId))].length,
          lastActivity: new Date(events[events.length - 1]?.timestamp || 0).toISOString()
        };
      })
    );
    
    // Sort by last activity
    users.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
    
    res.json({ success: true, users, totalUsers: users.length });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

// GET /api/analytics/users/:userId - Get specific user data
app.get('/api/analytics/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const userFile = `user_${userId}.json`;
    const filePath = path.join(DATA_DIR, userFile);
    
      const data = await fs.readFile(filePath, 'utf8');
      const events = JSON.parse(data);
      
    // Calculate user statistics
    const stats = {
      totalEvents: events.length,
      firstEvent: events[0]?.timestamp || null,
      lastEvent: events[events.length - 1]?.timestamp || null,
      sessions: [...new Set(events.map(e => e.sessionId))].length,
      eventTypes: [...new Set(events.map(e => e.eventName))],
      timeSpent: events[events.length - 1]?.timeFromStart || 0,
      slidesVisited: new Set(events.filter(e => e.eventName === 'slide_change').map(e => e.eventData?.slideNumber)).size
    };
    
    res.json({ 
      success: true, 
      user: {
        userId,
        events: events.slice(-100), // Last 100 events for performance
        stats,
        totalEvents: events.length
      }
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    console.error('Error fetching user data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch user data' });
  }
});

// GET /api/analytics/stats - Get aggregated statistics
app.get('/api/analytics/stats', async (req, res) => {
  try {
    const eventsPath = path.join(DATA_DIR, 'events.json');
    const eventsData = await fs.readFile(eventsPath, 'utf8');
    const events = JSON.parse(eventsData);
      
      const stats = {
        totalEvents: events.length,
      totalUsers: new Set(events.map(e => e.userId)).size,
      totalSessions: new Set(events.map(e => e.sessionId)).size,
      eventTypes: {},
      dailyStats: {},
        dateRange: {
        start: events[0]?.timestamp ? new Date(events[0].timestamp).toISOString() : null,
        end: events[events.length - 1]?.timestamp ? new Date(events[events.length - 1].timestamp).toISOString() : null
        }
      };
      
    // Count event types
    events.forEach(event => {
      const eventType = event.eventName || 'unknown';
      stats.eventTypes[eventType] = (stats.eventTypes[eventType] || 0) + 1;
      
      // Daily stats
      const date = new Date(event.timestamp).toISOString().split('T')[0];
      if (!stats.dailyStats[date]) {
        stats.dailyStats[date] = { events: 0, users: new Set() };
      }
      stats.dailyStats[date].events++;
      stats.dailyStats[date].users.add(event.userId);
    });
    
    // Convert Sets to counts
    Object.keys(stats.dailyStats).forEach(date => {
      stats.dailyStats[date].users = stats.dailyStats[date].users.size;
    });
    
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
});

// GET /api/export/json - Export all data as JSON
app.get('/api/export/json', async (req, res) => {
  try {
    const eventsPath = path.join(DATA_DIR, 'events.json');
    const eventsData = await fs.readFile(eventsPath, 'utf8');
    const events = JSON.parse(eventsData);
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="afm_analytics_${new Date().toISOString().split('T')[0]}.json"`);
    res.json({
      exportDate: new Date().toISOString(),
      totalEvents: events.length,
      events: events
    });
  } catch (error) {
    console.error('Error exporting JSON:', error);
    res.status(500).json({ success: false, error: 'Failed to export JSON' });
  }
});

// GET /api/export/csv - Export all data as CSV
app.get('/api/export/csv', async (req, res) => {
  try {
    const eventsPath = path.join(DATA_DIR, 'events.json');
    const eventsData = await fs.readFile(eventsPath, 'utf8');
    const events = JSON.parse(eventsData);
    
    const csv = jsonToCSV(events);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="afm_analytics_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting CSV:', error);
    res.status(500).json({ success: false, error: 'Failed to export CSV' });
  }
});

// GET /api/export/user/:userId/json - Export specific user data as JSON
app.get('/api/export/user/:userId/json', async (req, res) => {
  try {
    const { userId } = req.params;
    const userFile = `user_${userId}.json`;
    const filePath = path.join(DATA_DIR, userFile);
    
    const data = await fs.readFile(filePath, 'utf8');
    const events = JSON.parse(data);
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="user_${userId}_${new Date().toISOString().split('T')[0]}.json"`);
    res.json({
      exportDate: new Date().toISOString(),
      userId: userId,
      totalEvents: events.length,
      events: events
    });
  } catch (error) {
    console.error('Error exporting user JSON:', error);
    res.status(500).json({ success: false, error: 'Failed to export user JSON' });
  }
});

// GET /api/export/user/:userId/csv - Export specific user data as CSV
app.get('/api/export/user/:userId/csv', async (req, res) => {
  try {
    const { userId } = req.params;
    const userFile = `user_${userId}.json`;
    const filePath = path.join(DATA_DIR, userFile);
    
    const data = await fs.readFile(filePath, 'utf8');
    const events = JSON.parse(data);
    const csv = jsonToCSV(events);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="user_${userId}_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting user CSV:', error);
    res.status(500).json({ success: false, error: 'Failed to export user CSV' });
  }
});

// POST /api/backup - Create manual backup
app.post('/api/backup', async (req, res) => {
  try {
    const backupDir = await createBackup();
    res.json({ 
      success: true, 
      message: 'Backup created successfully',
      backupPath: backupDir,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ success: false, error: 'Failed to create backup' });
  }
});

// GET /api/backups - List all backups
app.get('/api/backups', async (req, res) => {
  try {
    const backups = await fs.readdir(BACKUP_DIR);
    const backupDetails = await Promise.all(
      backups.map(async (backup) => {
        const backupPath = path.join(BACKUP_DIR, backup);
        const stats = await fs.stat(backupPath);
        const files = await fs.readdir(backupPath);
        
        return {
          name: backup,
          created: stats.birthtime.toISOString(),
          files: files.length,
          size: stats.size
        };
      })
    );
    
    // Sort by creation date (newest first)
    backupDetails.sort((a, b) => new Date(b.created) - new Date(a.created));
    
    res.json({ success: true, backups: backupDetails });
  } catch (error) {
    console.error('Error listing backups:', error);
    res.status(500).json({ success: false, error: 'Failed to list backups' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Initialize directories and start server
ensureDirectories().then(ensureDataFiles).then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 AFM Analytics Server running on port ${PORT}`);
    console.log(`📊 API endpoints:`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Analytics: http://localhost:${PORT}/api/analytics`);
    console.log(`   Export JSON: http://localhost:${PORT}/api/export/json`);
    console.log(`   Export CSV: http://localhost:${PORT}/api/export/csv`);
    console.log(`📁 Data directory: ${DATA_DIR}`);
    console.log(`💾 Backup directory: ${BACKUP_DIR}`);
  });
}); 
