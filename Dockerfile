# Use the official Bun image as the base image
FROM oven/bun:1.2.2-alpine

# Set the working directory
WORKDIR /app

# Copy package.json and bun.lockb
COPY package.json bun.lock ./

# Install only production dependencies
RUN bun install --production

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["bun", "run", "start"]
