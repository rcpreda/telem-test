FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY server/package.json ./

# Install dependencies
RUN npm install --production

# Copy source files
COPY server/ ./

# Create logs directory
RUN mkdir -p /app/logs

# Expose telemetry port
EXPOSE 5027

# Run server
CMD ["node", "server.js"]
