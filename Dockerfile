FROM node:18-slim

# Set up working directory
WORKDIR /app

# Copy root package files
COPY package.json ./

# Copy services (for Gemini image identification)
COPY services ./services

# Copy backend (lightweight server)
COPY server ./server

# Copy frontend
COPY client ./client

# Install dependencies
RUN cd server && npm install
RUN cd client && npm install && npm run build

# Environment variables
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start command
CMD ["npm", "start"]
