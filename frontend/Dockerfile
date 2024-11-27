FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with legacy peer deps flag
RUN npm install --legacy-peer-deps

# Copy app files
COPY . .

EXPOSE 3000

# Start the app
CMD ["npm", "start"]