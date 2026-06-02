# syntax = docker/dockerfile:1

FROM node:20-slim

WORKDIR /app

# Install build tools needed by native dependencies (pdf-parse, etc.)
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential && \
    rm -rf /var/lib/apt/lists/*

# Copy package files and install production dependencies
COPY package-lock.json package.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Ensure uploads directory exists
RUN mkdir -p uploads

# Expose the port Express listens on
EXPOSE 3000

# Start the backend server
CMD ["node", "server.js"]
