# Use Node.js 18 Alpine as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create a non-root user
RUN addgroup -S modelingo
RUN adduser -S modelingo-backend

# Create data and backup directories and set permissions
RUN mkdir -p /app/data /app/backups && \
    chown -R modelingo-backend:modelingo /app
USER modelingo-backend

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Start the application
CMD ["node", "server.js"] 
