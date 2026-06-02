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

# Patch pdf-parse self-test bug (ESM crash when test PDF is missing)
RUN node -e "const fs=require('fs'); const f='node_modules/pdf-parse/index.js'; let c=fs.readFileSync(f,'utf8'); const m=c.match(/let\s+isDebugMode\s*=\s*([^;]+);/); if(!m){console.error('Pattern not found');process.exit(1)} console.log('Found isDebugMode =',m[1].trim()); c=c.replace(/let\s+isDebugMode\s*=\s*[^;]+;/,'let isDebugMode = false;'); fs.writeFileSync(f,c); console.log('Patched successfully');"

# Verify the patch was applied
RUN grep -q "let isDebugMode = false;" node_modules/pdf-parse/index.js || (echo "pdf-parse patch failed" && exit 1)

# Copy application code
COPY . .

# Ensure uploads directory exists
RUN mkdir -p uploads

# Expose the port Express listens on
EXPOSE 3000

# Start the backend server
CMD ["node", "server.js"]
